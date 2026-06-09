'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { PRODUCT_LINES, GRINDS, ROAST_LEVELS } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/products';
const CAP = 'manage:products' as const;

const schema = z.object({
  sku: z.string().min(3),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  productLine: z.enum(PRODUCT_LINES),
  variationType: z.string().optional(),
  sizeLabel: z.string().min(1),
  sizeGrams: z.coerce.number().int().positive().optional(),
  grind: z.enum(GRINDS),
  roastLevel: z.enum(ROAST_LEVELS).optional(),
  origin: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  groupId: z.string().optional(), // parent product group (variations module)
  sellingPrice: z.coerce.number().int().nonnegative(),
  cogsPerUnit: z.coerce.number().int().nonnegative(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    sku: reqField(fd, 'sku'),
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    productLine: reqField(fd, 'productLine'),
    variationType: optField(fd, 'variationType'),
    sizeLabel: reqField(fd, 'sizeLabel'),
    sizeGrams: optField(fd, 'sizeGrams'),
    grind: reqField(fd, 'grind'),
    roastLevel: optField(fd, 'roastLevel'),
    origin: optField(fd, 'origin'),
    imageUrl: optField(fd, 'imageUrl'),
    groupId: optField(fd, 'groupId'),
    sellingPrice: reqField(fd, 'sellingPrice'),
    cogsPerUnit: reqField(fd, 'cogsPerUnit'),
  });
}

// Normalize blank group/image to null (unassigned / standalone / no image).
const withGroup = <T extends { groupId?: string; imageUrl?: string }>(data: T) => ({
  ...data,
  groupId: data.groupId || null,
  imageUrl: data.imageUrl || null,
});

export async function createProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  if (await prisma.product.findUnique({ where: { sku: r.data.sku }, select: { id: true } }))
    return { error: 'exists' };
  const p = await prisma.product.create({ data: withGroup(r.data) });
  await audit(user.id, 'CREATE', 'Product', { sku: r.data.sku });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${p.id}`);
}

export async function updateProduct(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // SKU is the permanent key — immutable after creation (CR-5).
  const { sku, ...data } = r.data;
  // Record cost/price changes for the cost-history view (CR-3). Past orders keep
  // their own COGS snapshot, so this only affects future transactions.
  const before = await prisma.product.findUnique({ where: { id }, select: { cogsPerUnit: true, sellingPrice: true } });
  await prisma.product.update({ where: { id }, data: withGroup(data) });
  await audit(user.id, 'UPDATE', 'Product', { id });
  if (before && (before.cogsPerUnit !== data.cogsPerUnit || before.sellingPrice !== data.sellingPrice)) {
    await audit(user.id, 'COST_CHANGE', 'Product', {
      id,
      sku,
      cogsFrom: before.cogsPerUnit,
      cogsTo: data.cogsPerUnit,
      priceFrom: before.sellingPrice,
      priceTo: data.sellingPrice,
    });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${id}`);
}

export async function archiveProduct(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.product.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'Product', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${id}`);
}

export async function deleteProduct(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.product.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'Product', { id });
  } catch {
    // Referenced by orders/batches/inventory — archive instead of hard delete.
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'Product', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products`);
}

const componentSchema = z.array(
  z.object({
    inventoryItemId: z.string().optional(),
    name: z.string().min(1),
    quantity: z.coerce.number().int().nonnegative(),
    unitCost: z.coerce.number().int().nonnegative(),
  }),
);

/**
 * Save a variation's cost recipe (BOM, §6) and recompute its cogsPerUnit =
 * Σ(quantity × unitCost). Components may link to an InventoryItem — then the
 * live item cost is used (dynamic). Because COGS is snapshotted per order line,
 * this only affects future orders. An empty recipe clears components, leaving
 * the cost untouched.
 */
export async function saveProductComponents(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const locale = reqField(fd, 'locale') || 'ar';
  let raw: unknown;
  try {
    raw = JSON.parse(reqField(fd, 'components') || '[]');
  } catch {
    return { error: 'invalid' };
  }
  const parsed = componentSchema.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const components = parsed.data.filter((c) => c.name.trim());
  // Linked components take their cost from the live inventory item.
  const linkedIds = components.map((c) => c.inventoryItemId).filter((x): x is string => Boolean(x));
  const items = linkedIds.length
    ? await prisma.inventoryItem.findMany({ where: { id: { in: linkedIds } }, select: { id: true, unitCost: true } })
    : [];
  const costById = new Map(items.map((i) => [i.id, i.unitCost ?? 0]));
  const rows = components.map((c) => ({
    productId,
    inventoryItemId: c.inventoryItemId || null,
    name: c.name.trim(),
    quantity: c.quantity,
    unitCost: c.inventoryItemId ? (costById.get(c.inventoryItemId) ?? c.unitCost) : c.unitCost,
  }));
  const cost = rows.reduce((s, c) => s + c.quantity * c.unitCost, 0);
  await prisma.$transaction(async (tx) => {
    await tx.productComponent.deleteMany({ where: { productId } });
    if (rows.length) {
      await tx.productComponent.createMany({ data: rows });
      await tx.product.update({ where: { id: productId }, data: { cogsPerUnit: cost } });
    }
  });
  if (rows.length) {
    await audit(user.id, 'COST_CHANGE', 'Product', { id: productId, source: 'recipe', cogsTo: cost, components: rows.length });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${productId}`);
}

const orderUsageSchema = z.object({
  invoiceName: z.string().optional(),
  minSellingPrice: z.coerce.number().int().nonnegative().optional(),
  allowDiscount: z.coerce.boolean(),
  allowPriceOverride: z.coerce.boolean(),
  trackInventory: z.coerce.boolean(),
});

/**
 * Save how a variation behaves in orders/invoices (§6): invoice display name,
 * optional price floor, and the discount / price-override / stock-tracking
 * toggles. Checkboxes submit only when checked, so absent = false.
 */
export async function saveOrderUsage(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const locale = reqField(fd, 'locale') || 'ar';
  const r = orderUsageSchema.safeParse({
    invoiceName: optField(fd, 'invoiceName'),
    minSellingPrice: optField(fd, 'minSellingPrice'),
    allowDiscount: fd.get('allowDiscount') != null,
    allowPriceOverride: fd.get('allowPriceOverride') != null,
    trackInventory: fd.get('trackInventory') != null,
  });
  if (!r.success) return { error: 'invalid' };
  await prisma.product.update({
    where: { id: productId },
    data: {
      invoiceName: r.data.invoiceName || null,
      minSellingPrice: r.data.minSellingPrice ?? null,
      allowDiscount: r.data.allowDiscount,
      allowPriceOverride: r.data.allowPriceOverride,
      trackInventory: r.data.trackInventory,
    },
  });
  await audit(user.id, 'UPDATE', 'Product', { id: productId, source: 'orderUsage' });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${productId}?tab=usage`);
}

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { PRODUCT_LINES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';
import { nextGroupCode } from './product-groups';
import { generateProductBarcode } from './numbering';

const LIST = '/[locale]/(dashboard)/admin/records/products';
const CAP = 'manage:products' as const;

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002';

const schema = z.object({
  // Step 1 — main product
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  productLine: z.enum(PRODUCT_LINES),
  productType: z.string().optional(),
  description: z.string().optional(),
  // Step 2 — first variation
  sku: z.string().min(3),
  sizeLabel: z.string().min(1),
  grind: z.string().min(1), // list-managed code (§9)
  variationType: z.string().optional(),
  // Step 3 — pricing
  sellingPrice: z.coerce.number().int().nonnegative(),
  minSellingPrice: z.coerce.number().int().nonnegative().optional(),
  // Step 4 — cost
  cogsPerUnit: z.coerce.number().int().nonnegative(),
  // Step 5 — behaviour
  trackInventory: z.boolean(),
  allowDiscount: z.boolean(),
  allowPriceOverride: z.boolean(),
  // Step 6 — activate
  isActive: z.boolean(),
});

/**
 * Guided product setup (§7): create a main product, its first variation, and a
 * base price in one step. Further variations, the full cost recipe and
 * inventory links are added afterwards from the product's tabs.
 */
export async function createProductWizard(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const locale = reqField(fd, 'locale') || 'ar';
  const r = schema.safeParse({
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    productLine: reqField(fd, 'productLine'),
    productType: optField(fd, 'productType'),
    description: optField(fd, 'description'),
    sku: reqField(fd, 'sku'),
    sizeLabel: reqField(fd, 'sizeLabel'),
    grind: reqField(fd, 'grind'),
    variationType: optField(fd, 'variationType'),
    sellingPrice: reqField(fd, 'sellingPrice'),
    minSellingPrice: optField(fd, 'minSellingPrice'),
    cogsPerUnit: reqField(fd, 'cogsPerUnit'),
    trackInventory: fd.get('trackInventory') != null,
    allowDiscount: fd.get('allowDiscount') != null,
    allowPriceOverride: fd.get('allowPriceOverride') != null,
    isActive: (fd.get('status') ?? 'active') === 'active',
  });
  if (!r.success) return { error: 'invalid' };
  const d = r.data;
  if (await prisma.product.findUnique({ where: { sku: d.sku }, select: { id: true } })) return { error: 'exists' };

  let productId = '';
  for (let attempt = 0; ; attempt++) {
    const code = await nextGroupCode();
    try {
      productId = await prisma.$transaction(async (tx) => {
        const barcodeValue = await generateProductBarcode(tx);
        const group = await tx.productGroup.create({
          data: { code, nameEn: d.nameEn, nameAr: d.nameAr, productLine: d.productLine, productType: d.productType ?? null, description: d.description ?? null },
        });
        const product = await tx.product.create({
          data: {
            barcodeValue,
            sku: d.sku,
            nameEn: d.nameEn,
            nameAr: d.nameAr,
            productLine: d.productLine,
            groupId: group.id,
            variationType: d.variationType ?? null,
            sizeLabel: d.sizeLabel,
            grind: d.grind,
            sellingPrice: d.sellingPrice,
            minSellingPrice: d.minSellingPrice ?? null,
            cogsPerUnit: d.cogsPerUnit,
            trackInventory: d.trackInventory,
            allowDiscount: d.allowDiscount,
            allowPriceOverride: d.allowPriceOverride,
            isActive: d.isActive,
          },
        });
        await tx.productPrice.create({
          data: { productId: product.id, kind: 'BASE', price: d.sellingPrice, effectiveFrom: new Date(), createdById: user.id, note: 'wizard' },
        });
        return product.id;
      });
      break;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 5) continue; // group code race — regenerate
      throw e;
    }
  }
  await audit(user.id, 'CREATE', 'Product', { sku: d.sku, source: 'wizard' });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${productId}`);
}

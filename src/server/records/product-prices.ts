'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { CURRENCIES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/products';
const CAP = 'manage:products' as const;

const schema = z
  .object({
    kind: z.enum(['BASE', 'WHOLESALE', 'CHANNEL']),
    channel: z.string().optional(), // list-managed code (§9)
    price: z.coerce.number().int().nonnegative(),
    currency: z.enum(CURRENCIES).default('IQD'),
    effectiveFrom: z.coerce.date(),
    note: z.string().optional(),
  })
  .refine((d) => d.kind !== 'CHANNEL' || !!d.channel, { path: ['channel'] });

/**
 * Add a dated price entry for a variation (§6). A BASE entry effective now or
 * earlier becomes the current selling price immediately (and is audited as a
 * cost/price change); a future one is scheduled. Wholesale/channel entries are
 * informational — orders still allow a manual price.
 */
export async function addProductPrice(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const locale = reqField(fd, 'locale') || 'ar';
  const r = schema.safeParse({
    kind: reqField(fd, 'kind'),
    channel: optField(fd, 'channel'),
    price: reqField(fd, 'price'),
    currency: optField(fd, 'currency') ?? 'IQD',
    effectiveFrom: reqField(fd, 'effectiveFrom'),
    note: optField(fd, 'note'),
  });
  if (!r.success) return { error: 'invalid' };

  const isDueBase = r.data.kind === 'BASE' && r.data.effectiveFrom.getTime() <= Date.now();
  await prisma.$transaction(async (tx) => {
    await tx.productPrice.create({
      data: {
        productId,
        kind: r.data.kind,
        channel: r.data.kind === 'CHANNEL' ? (r.data.channel ?? null) : null,
        price: r.data.price,
        currency: r.data.currency,
        effectiveFrom: r.data.effectiveFrom,
        note: r.data.note ?? null,
        createdById: user.id,
      },
    });
    if (isDueBase) {
      const before = await tx.product.findUnique({ where: { id: productId }, select: { sellingPrice: true } });
      await tx.product.update({ where: { id: productId }, data: { sellingPrice: r.data.price, sellingCurrency: r.data.currency } });
      await audit(user.id, 'COST_CHANGE', 'Product', { id: productId, source: 'price', priceFrom: before?.sellingPrice, priceTo: r.data.price });
    } else {
      await audit(user.id, 'ADD_PRICE', 'Product', { id: productId, kind: r.data.kind, price: r.data.price, effectiveFrom: r.data.effectiveFrom.toISOString() });
    }
  });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${productId}?tab=pricing`);
}

/** Remove a scheduled (future) price entry; applied/past entries are immutable. */
export async function deleteProductPrice(id: string, productId: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  const entry = await prisma.productPrice.findUnique({ where: { id }, select: { effectiveFrom: true } });
  if (entry && entry.effectiveFrom.getTime() > Date.now()) {
    await prisma.productPrice.delete({ where: { id } });
    await audit(user.id, 'DELETE_PRICE', 'Product', { id: productId, priceId: id });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${productId}?tab=pricing`);
}

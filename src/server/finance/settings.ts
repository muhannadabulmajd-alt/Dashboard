'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/client';
import { requireCap, audit, reqField, type ActionState } from '@/server/records/shared';
import { USD_TO_IQD_KEY } from '@/server/settings';

/** Set the USD→IQD conversion rate (manage:finance). */
export async function setUsdToIqd(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap('manage:finance');
  if (!user) return { error: 'forbidden' };
  const rate = Number(reqField(fd, 'rate'));
  if (!Number.isFinite(rate) || rate <= 0) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.setting.upsert({
    where: { key: USD_TO_IQD_KEY },
    create: { key: USD_TO_IQD_KEY, value: String(rate) },
    update: { value: String(rate) },
  });
  await audit(user.id, 'SET_RATE', 'Setting', { usd_to_iqd: rate });
  revalidatePath('/[locale]/(dashboard)/finance', 'page');
  redirect(`/${locale}/finance`);
}

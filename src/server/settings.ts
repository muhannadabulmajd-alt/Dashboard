import 'server-only';
import { prisma } from '@/server/db/client';

export const DEFAULT_USD_TO_IQD = 1500;
export const USD_TO_IQD_KEY = 'usd_to_iqd';

/** Configured USD→IQD conversion rate (defaults to 1500 IQD per 1 USD). */
export async function getUsdToIqd(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: USD_TO_IQD_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_IQD;
}

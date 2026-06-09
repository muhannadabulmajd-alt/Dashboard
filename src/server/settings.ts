import 'server-only';
import type { RoastLevel } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { DEFAULT_ROAST_YIELDS, DEFAULT_ROASTING_COST_PER_KG } from '@/lib/roast';

export const DEFAULT_USD_TO_IQD = 1500;
export const USD_TO_IQD_KEY = 'usd_to_iqd';

/** Configured USD→IQD conversion rate (defaults to 1500 IQD per 1 USD). */
export async function getUsdToIqd(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: USD_TO_IQD_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_IQD;
}

/** Roast yields per type + roasting cost/kg (§5), defaults overridable via Settings. */
export async function getRoastConfig(): Promise<{ yields: Record<RoastLevel, number>; roastingCostPerKg: number }> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'roast_' } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const yields = { ...DEFAULT_ROAST_YIELDS };
  for (const lvl of Object.keys(yields) as RoastLevel[]) {
    const v = Number(map.get(`roast_yield_${lvl}`));
    if (Number.isFinite(v) && v > 0 && v <= 1) yields[lvl] = v;
  }
  const rc = Number(map.get('roasting_cost_per_kg'));
  return { yields, roastingCostPerKg: Number.isFinite(rc) && rc >= 0 ? rc : DEFAULT_ROASTING_COST_PER_KG };
}

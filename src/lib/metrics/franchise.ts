// Composite franchise/branch readiness score from available unit-economics
// signals (sales scale, margin health, order volume). Pure & testable.

export interface ReadinessInput {
  netSales: number;
  marginPct: number; // 0..1
  orders: number;
}

export interface ReadinessTargets {
  sales: number;
  margin: number;
  orders: number;
}

export interface ReadinessResult {
  score: number; // 0..100
  parts: { key: 'sales' | 'margin' | 'orders'; score: number }[];
}

export const DEFAULT_READINESS_TARGETS: ReadinessTargets = {
  sales: 20_000_000, // IQD over the period
  margin: 0.4,
  orders: 150,
};

const WEIGHTS = { sales: 0.35, margin: 0.35, orders: 0.3 } as const;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function franchiseReadinessScore(
  input: ReadinessInput,
  targets: ReadinessTargets = DEFAULT_READINESS_TARGETS,
): ReadinessResult {
  const sales = clamp01(input.netSales / targets.sales);
  const margin = clamp01(input.marginPct / targets.margin);
  const orders = clamp01(input.orders / targets.orders);
  const score = Math.round((WEIGHTS.sales * sales + WEIGHTS.margin * margin + WEIGHTS.orders * orders) * 100);
  return {
    score,
    parts: [
      { key: 'sales', score: Math.round(sales * 100) },
      { key: 'margin', score: Math.round(margin * 100) },
      { key: 'orders', score: Math.round(orders * 100) },
    ],
  };
}

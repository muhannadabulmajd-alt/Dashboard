export type DemandLine = {
  productId: string;
  sku: string;
  quantity: number;
  product: { nameEn: string; nameAr: string };
};

export type DemandForecastRow = {
  productId: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  previousUnits: number;
  recentUnits: number;
  previousDailyRate: number;
  recentDailyRate: number;
  trendPct: number | null;
  forecastUnits: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

function aggregate(lines: DemandLine[]) {
  const rows = new Map<string, { sku: string; nameEn: string; nameAr: string; units: number }>();
  for (const line of lines) {
    const current = rows.get(line.productId) ?? {
      sku: line.sku,
      nameEn: line.product.nameEn,
      nameAr: line.product.nameAr,
      units: 0,
    };
    current.units += line.quantity;
    rows.set(line.productId, current);
  }
  return rows;
}

/** Transparent weighted run-rate forecast. It is advisory and never mutates inventory. */
export function buildDemandForecast(input: {
  previous: DemandLine[];
  recent: DemandLine[];
  previousDays: number;
  recentDays: number;
  horizonDays: number;
}): DemandForecastRow[] {
  const previous = aggregate(input.previous);
  const recent = aggregate(input.recent);
  const productIds = new Set([...previous.keys(), ...recent.keys()]);
  const rows: DemandForecastRow[] = [];

  for (const productId of productIds) {
    const old = previous.get(productId);
    const current = recent.get(productId);
    const identity = current ?? old;
    if (!identity) continue;
    const previousUnits = old?.units ?? 0;
    const recentUnits = current?.units ?? 0;
    const previousDailyRate = previousUnits / Math.max(1, input.previousDays);
    const recentDailyRate = recentUnits / Math.max(1, input.recentDays);
    const trendPct = previousDailyRate > 0
      ? (recentDailyRate - previousDailyRate) / previousDailyRate
      : null;
    const boundedTrend = trendPct === null ? 0 : Math.max(-0.75, Math.min(1.5, trendPct));
    const baselineRate = old
      ? previousDailyRate * 0.35 + recentDailyRate * 0.65
      : recentDailyRate;
    const forecastUnits = Math.max(0, Math.ceil(baselineRate * (1 + boundedTrend * 0.25) * input.horizonDays));
    const sampleUnits = previousUnits + recentUnits;
    const confidence = sampleUnits >= 20 && previousUnits > 0 && recentUnits > 0
      ? 'HIGH'
      : sampleUnits >= 6
        ? 'MEDIUM'
        : 'LOW';
    rows.push({
      productId,
      sku: identity.sku,
      nameEn: identity.nameEn,
      nameAr: identity.nameAr,
      previousUnits,
      recentUnits,
      previousDailyRate,
      recentDailyRate,
      trendPct,
      forecastUnits,
      confidence,
    });
  }

  return rows.sort((a, b) => b.forecastUnits - a.forecastUnits || b.recentUnits - a.recentUnits || a.sku.localeCompare(b.sku));
}

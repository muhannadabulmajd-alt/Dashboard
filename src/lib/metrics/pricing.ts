/**
 * Variation pricing (§6). Prices are immutable, dated entries; the current base
 * price is the most recent BASE entry effective at/before now (else the
 * product's stored fallback). Future-dated entries are "scheduled".
 */
export interface PriceEntry {
  kind: string; // BASE | WHOLESALE | CHANNEL
  channel?: string | null;
  price: number;
  effectiveFrom: Date;
}

/** Current base price = latest BASE entry effective by `now`, else fallback. */
export function effectivePrice(entries: PriceEntry[], fallback: number, now: Date = new Date()): number {
  const due = entries
    .filter((e) => e.kind === 'BASE' && e.effectiveFrom.getTime() <= now.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return due.length ? due[0].price : fallback;
}

/** Future-dated entries (any kind), soonest first. */
export function scheduledPrices<T extends PriceEntry>(entries: T[], now: Date = new Date()): T[] {
  return entries
    .filter((e) => e.effectiveFrom.getTime() > now.getTime())
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
}

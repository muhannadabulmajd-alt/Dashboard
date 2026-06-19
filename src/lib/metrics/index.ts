// Single calculation layer reused by all dashboard pages and exports.
export * from './types';
export * from './sales';
export * from './margin';
export * from './inventory';
export * from './roasting';
export * from './runrate';
export * from './customers';
export * from './fulfillment';
export * from './offers';
export * from './franchise';
export * from './alerts';
export * from './pricing';
export * from './purchases';
export * from './status';
export * from './snapshot';

/** Period-over-period delta as a ratio (e.g. 0.12 == +12%). */
export function deltaPct(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

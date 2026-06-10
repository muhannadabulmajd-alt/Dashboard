// The four built-in roast levels carry yield defaults; list-managed additions
// fall back to MEDIUM's yield via `roastYieldFor`.
export type BuiltinRoastLevel = 'LIGHT' | 'MEDIUM' | 'MEDIUM_DARK' | 'DARK';

// Default roast yields (roasted ÷ green) per roast type — admin-overridable via
// Settings (roast_yield_<LEVEL>). Darker roasts lose more weight (§5.2).
export const DEFAULT_ROAST_YIELDS: Record<BuiltinRoastLevel, number> = {
  LIGHT: 0.88,
  MEDIUM: 0.85,
  MEDIUM_DARK: 0.83,
  DARK: 0.82,
};

export const DEFAULT_ROASTING_COST_PER_KG = 0; // IQD per kg, overridable via Settings

/** Yield for any roast-level code; unknown (user-added) levels use MEDIUM's. */
export function roastYieldFor(yields: Record<string, number>, level: string): number {
  return yields[level] ?? yields.MEDIUM ?? DEFAULT_ROAST_YIELDS.MEDIUM;
}

/** Grams represented by one unit of an inventory item's unit string. */
export function gramsPerUnit(unit: string): number {
  const u = unit.trim().toLowerCase();
  if (['g', 'gram', 'grams', 'غم', 'جم', 'غرام'].includes(u)) return 1;
  if (['kg', 'kilogram', 'kilo', 'كغ', 'كيلو', 'كجم'].includes(u)) return 1000;
  return 1000; // default: treat the item's unit cost as a per-kg cost
}

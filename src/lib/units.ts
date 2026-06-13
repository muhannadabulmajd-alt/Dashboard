export const MEASUREMENT_UNITS = [
  'g',
  'kg',
  'lb',
  'ml',
  'l',
  'unit',
  'piece',
  'sachet',
  'pack',
  'box',
  'bag',
  'carton',
] as const;

export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export function isMeasurementUnit(value: string): value is MeasurementUnit {
  return MEASUREMENT_UNITS.includes(value as MeasurementUnit);
}

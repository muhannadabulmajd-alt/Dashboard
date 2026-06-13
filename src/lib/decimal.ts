export type DecimalLike =
  | number
  | string
  | null
  | undefined
  | {
      toNumber?: () => number;
      toString?: () => string;
    };

export function decimalNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value.toString === 'function') {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function decimalString(value: DecimalLike, digits = 3): string {
  const number = decimalNumber(value);
  return Number.isFinite(number) ? number.toFixed(digits) : (0).toFixed(digits);
}

export function optionalDecimalString(value: DecimalLike, digits = 3): string {
  if (value === null || value === undefined || value === '') return '';
  return decimalString(value, digits);
}

export function parseDecimalInput(value: string, digits = 3): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!new RegExp(`^-?\\d+(?:\\.\\d{1,${digits}})?$`).test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundMoney(value: number): number {
  return Math.round(value);
}

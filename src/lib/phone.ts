/** Normalize Iraqi phone variants for reliable matching without enforcing uniqueness. */
export function normalizeIraqiPhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00964')) return `+${digits.slice(2)}`;
  if (digits.startsWith('964')) return `+${digits}`;
  if (digits.startsWith('0')) return `+964${digits.slice(1)}`;
  if (digits.length === 10) return `+964${digits}`;
  return `+${digits}`;
}

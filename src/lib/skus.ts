// Laheeb SKU structure: LH-<LINE>-<ORIGIN/BLEND>-<SIZE>-<GRIND>
// e.g. LH-ESP-SPRING-250-WB

export interface ParsedSku {
  prefix: string;
  line: string;
  origin: string;
  size: string;
  grind: string;
}

const SKU_RE = /^LH-[A-Z]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z]+$/;

export function isValidSku(sku: string): boolean {
  return SKU_RE.test(sku);
}

export function parseSku(sku: string): ParsedSku | null {
  if (!isValidSku(sku)) return null;
  const [prefix, line, origin, size, grind] = sku.split('-');
  return { prefix, line, origin, size, grind };
}

export function buildSku(parts: Omit<ParsedSku, 'prefix'>): string {
  const { line, origin, size, grind } = parts;
  return ['LH', line, origin, size, grind].join('-').toUpperCase();
}

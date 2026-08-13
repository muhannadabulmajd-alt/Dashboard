import { enumLabel } from '@/lib/enums';
import { normalizeAssistantText } from '@/lib/ai-assistant';

export type ProductMatchDocument = {
  id: string;
  sku: string;
  barcodeValue: string;
  retailBarcode: string;
  nameEn: string;
  nameAr: string;
  aliases: string[];
  sizeGrams: number | null;
  sizeLabel: string;
  grind: string;
  roastLevel: string | null;
  origin: string | null;
  productLine: string;
  variationType: string | null;
  sellUnit: string;
  group: { code?: string; nameEn: string; nameAr: string } | null;
};

export type RankedProduct<T extends ProductMatchDocument> = {
  product: T;
  score: number;
  coverage: number;
  matchedTokens: string[];
};

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'with', 'and', 'of', 'coffee', 'blend', 'product', 'item',
  'gram', 'grams', 'gm', 'gms', 'g', 'kg', 'kilogram', 'kilograms', 'unit',
  'قهوه', 'بن', 'خلطه', 'منتج', 'ماده', 'مع', 'من', 'غ', 'غم', 'غرام', 'جرام', 'كيلو', 'كغم', 'وحده',
]);

const TOKEN_ALIASES: Record<string, string> = {
  cardamon: 'cardamom',
  cardamonm: 'cardamom',
  بالهيل: 'هيل',
  بالهال: 'هيل',
  هال: 'هيل',
  متوسط: 'وسط',
  مطحونه: 'مطحون',
  beans: 'bean',
  حبوب: 'حب',
};

function canonicalToken(value: string): string {
  return TOKEN_ALIASES[value] ?? value;
}

function queryTokens(value: string): string[] {
  return normalizeAssistantText(value)
    .split(' ')
    .map(canonicalToken)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function textualValues(product: ProductMatchDocument): string[] {
  const enumValues = [product.grind, product.roastLevel, product.productLine]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, enumLabel(value, 'en'), enumLabel(value, 'ar')]);
  return [
    product.nameEn,
    product.nameAr,
    product.group?.nameEn,
    product.group?.nameAr,
    product.group?.code,
    product.sizeLabel,
    product.sizeGrams ? String(product.sizeGrams) : null,
    product.sellUnit,
    product.origin,
    product.variationType,
    ...enumValues,
    ...product.aliases,
  ].filter((value): value is string => Boolean(value));
}

function exactValues(product: ProductMatchDocument): string[] {
  return [
    product.sku,
    product.barcodeValue,
    product.retailBarcode,
    product.nameEn,
    product.nameAr,
    ...product.aliases,
  ].map(normalizeAssistantText);
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left))) return 0.82;
  const leftPairs = new Set(Array.from({ length: Math.max(0, left.length - 1) }, (_, index) => left.slice(index, index + 2)));
  const rightPairs = new Set(Array.from({ length: Math.max(0, right.length - 1) }, (_, index) => right.slice(index, index + 2)));
  if (!leftPairs.size || !rightPairs.size) return 0;
  const intersection = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return (2 * intersection) / (leftPairs.size + rightPairs.size);
}

function rankOne<T extends ProductMatchDocument>(product: T, tokens: string[]): RankedProduct<T> {
  const candidateTokens = new Set(textualValues(product).flatMap(queryTokens));
  const matchedTokens: string[] = [];
  let weightedMatches = 0;
  for (const token of tokens) {
    let best = 0;
    for (const candidate of candidateTokens) best = Math.max(best, tokenSimilarity(token, candidate));
    if (best >= 0.78) {
      matchedTokens.push(token);
      weightedMatches += best;
    }
  }
  const coverage = tokens.length ? weightedMatches / tokens.length : 0;
  const exactCount = tokens.filter((token) => candidateTokens.has(token)).length;
  return {
    product,
    score: coverage * 100 + exactCount * 4 + Math.min(candidateTokens.size, 20) / 100,
    coverage,
    matchedTokens,
  };
}

export function rankProductCandidates<T extends ProductMatchDocument>(
  products: T[],
  query: string,
): { kind: 'exact'; value: T } | { kind: 'ambiguous'; candidates: T[] } | { kind: 'none'; candidates: T[] } {
  const normalized = normalizeAssistantText(query);
  const identifierMatches = products.filter((product) => [product.sku, product.barcodeValue, product.retailBarcode]
    .map(normalizeAssistantText)
    .includes(normalized));
  if (identifierMatches.length === 1) return { kind: 'exact', value: identifierMatches[0] };
  if (identifierMatches.length > 1) return { kind: 'ambiguous', candidates: identifierMatches.slice(0, 8) };

  const textualExact = products.filter((product) => exactValues(product).includes(normalized));
  if (textualExact.length === 1) return { kind: 'exact', value: textualExact[0] };
  if (textualExact.length > 1) return { kind: 'ambiguous', candidates: textualExact.slice(0, 8) };

  const tokens = [...new Set(queryTokens(query))];
  if (!tokens.length) return { kind: 'none', candidates: [] };
  const ranked = products
    .map((product) => rankOne(product, tokens))
    .filter((result) => result.coverage >= 0.45)
    .sort((left, right) => right.score - left.score || left.product.sku.localeCompare(right.product.sku));
  if (!ranked.length) return { kind: 'none', candidates: [] };

  const top = ranked[0];
  const second = ranked[1];
  const fullCoverage = top.coverage >= 0.96;
  const clearLead = !second || top.score - second.score >= 10;
  const enoughEvidence = tokens.length >= 2 || fullCoverage;
  if (fullCoverage && clearLead && enoughEvidence) return { kind: 'exact', value: top.product };
  return { kind: 'ambiguous', candidates: ranked.slice(0, 8).map((result) => result.product) };
}

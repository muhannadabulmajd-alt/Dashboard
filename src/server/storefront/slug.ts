export function normalizeStorefrontSlug(value: string | null | undefined, fallback: string): string {
  const normalize = (input: string) =>
    input
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');

  return normalize(value ?? '') || normalize(fallback);
}

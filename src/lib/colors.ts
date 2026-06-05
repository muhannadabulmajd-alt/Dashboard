// Chart palette (coffee tones). Client-safe.
export const CHART_COLORS = [
  '#6f4e37', // coffee
  '#a9743f', // caramel
  '#c9a66b', // latte
  '#8c5a3b', // mocha
  '#d8b48a', // cream
  '#5c4033', // espresso
  '#b58463', // hazelnut
  '#e0c9a6', // foam
] as const;

export const POSITIVE = '#15803d';
export const NEGATIVE = '#b91c1c';
export const NEUTRAL = '#6b625a';

export function colorAt(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

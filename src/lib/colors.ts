// Chart palette (coffee tones). Client-safe.
export const CHART_COLORS = [
  '#ad6933', // roasted amber
  '#7f8b57', // highland sage
  '#532d1f', // dark roast
  '#963520', // red cherry
  '#3d421f', // deep grove
  '#c89155', // light amber
  '#a8b179', // soft sage
  '#d7caa6', // washed linen accent
] as const;

export const POSITIVE = '#60713d';
export const NEGATIVE = '#963520';
export const NEUTRAL = '#766b5f';

export function colorAt(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

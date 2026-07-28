export const PRODUCT_LABEL_DETAILS_PERCENT = 38;
export const PRODUCT_LABEL_SAFE_MARGIN_MM = 1.5;
export const PRODUCT_LABEL_COLUMN_GAP_MM = 1;

export interface ProductLabelTypography {
  titlePt: number;
  variationPt: number;
  specsPt: number;
}

function visibleLength(value: string) {
  return Array.from(value.replace(/\s+/g, ' ').trim()).length;
}

export function productLabelTypography({
  mainName,
  variationName,
  specItems,
}: {
  mainName: string;
  variationName: string;
  specItems: { label: string; value: string }[];
}): ProductLabelTypography {
  const titleLength = visibleLength(mainName);
  const variationLength = visibleLength(variationName);
  const specLength = specItems.reduce(
    (total, item) => total + visibleLength(item.label) + visibleLength(item.value),
    0,
  );

  return {
    titlePt: titleLength > 44 ? 6.1 : titleLength > 30 ? 6.9 : titleLength > 20 ? 7.8 : 8.8,
    variationPt: variationLength > 42 ? 4.7 : variationLength > 26 ? 5.2 : 5.8,
    specsPt: specItems.length > 4 || specLength > 80 ? 3.8 : specLength > 52 ? 4.15 : 4.5,
  };
}

export function softWrapLabelText(value: string, maxTokenLength = 14) {
  return value
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || Array.from(token).length <= maxTokenLength) return token;
      const characters = Array.from(token);
      const chunks: string[] = [];
      for (let index = 0; index < characters.length; index += maxTokenLength) {
        chunks.push(characters.slice(index, index + maxTokenLength).join(''));
      }
      return chunks.join('\u200B');
    })
    .join('');
}

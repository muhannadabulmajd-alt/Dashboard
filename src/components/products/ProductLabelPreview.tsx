import { ProductBarcode } from './ProductBarcode';
import {
  PRODUCT_LABEL_COLUMN_GAP_MM,
  PRODUCT_LABEL_DETAILS_PERCENT,
  PRODUCT_LABEL_SAFE_MARGIN_MM,
  productLabelTypography,
  softWrapLabelText,
} from '@/lib/product-label-layout';
import type { ProductLabelData } from '@/server/products/label-data';

export function ProductLabelPreview({ label, locale }: { label: ProductLabelData; locale: 'ar' | 'en' }) {
  const typography = productLabelTypography(label);
  const rtl = locale === 'ar';

  return (
    <section
      className="sku-label-printable bg-white text-black"
      dir={rtl ? 'rtl' : 'ltr'}
      aria-label="SKU sticker label"
      style={{ width: '60mm', height: '30mm' }}
    >
      <div
        className={`flex h-full w-full items-stretch ${rtl ? 'flex-row-reverse' : 'flex-row'}`}
        style={{
          gap: `${PRODUCT_LABEL_COLUMN_GAP_MM}mm`,
          padding: `${PRODUCT_LABEL_SAFE_MARGIN_MM}mm`,
        }}
      >
        <div
          className={`flex min-w-0 shrink-0 flex-col justify-center ${rtl ? 'text-right' : 'text-left'}`}
          style={{ width: `${PRODUCT_LABEL_DETAILS_PERCENT}%` }}
        >
          <h2
            className="w-full break-words font-black text-black"
            style={{
              fontSize: `${typography.titlePt}pt`,
              lineHeight: 1.05,
              overflowWrap: 'anywhere',
            }}
          >
            {softWrapLabelText(label.mainName)}
          </h2>
          {label.variationName ? (
            <p
              className="mt-[0.7mm] w-full break-words font-bold text-black"
              style={{
                fontSize: `${typography.variationPt}pt`,
                lineHeight: 1.08,
                overflowWrap: 'anywhere',
              }}
            >
              {softWrapLabelText(label.variationName)}
            </p>
          ) : null}
          <div className="mt-[0.9mm] flex w-full flex-col gap-[0.35mm]">
            {label.specItems.map((item) => (
              <p
                key={`${item.label}-${item.value}`}
                className="w-full break-words font-medium text-black"
                style={{
                  fontSize: `${typography.specsPt}pt`,
                  lineHeight: 1.08,
                  overflowWrap: 'anywhere',
                }}
              >
                <span className="font-bold">{softWrapLabelText(item.label)}:</span>{' '}
                {softWrapLabelText(item.value)}
              </p>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <ProductBarcode
            value={label.retailBarcode}
            className="h-[22mm] w-full max-w-full shrink-0"
          />
        </div>
      </div>
    </section>
  );
}

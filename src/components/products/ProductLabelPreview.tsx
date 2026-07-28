import { ProductBarcode } from './ProductBarcode';
import type { ProductLabelData } from '@/server/products/label-data';

export function ProductLabelPreview({ label, locale }: { label: ProductLabelData; locale: 'ar' | 'en' }) {
  return (
    <section
      className="sku-label-printable flex bg-white text-black"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label="SKU sticker label"
      style={{ width: '60mm', height: '30mm' }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden p-[1.8mm]">
        <div className="h-[12.4mm] min-h-0 overflow-hidden">
          <h2 className="line-clamp-2 break-words text-[12.5px] font-black leading-[1.02] text-black">
            {label.mainName}
          </h2>
          {label.variationName ? (
            <p className="mt-[0.55mm] truncate text-[8.5px] font-bold leading-tight text-black">{label.variationName}</p>
          ) : null}
          {label.specLines.map((line) => (
            <p key={line} className="mt-[0.4mm] truncate text-[6.5px] font-medium leading-[1.08] text-black">
              {line}
            </p>
          ))}
        </div>
        <ProductBarcode value={label.retailBarcode} className="mt-auto h-[13.5mm] w-full shrink-0" />
      </div>
    </section>
  );
}

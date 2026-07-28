import { ProductBarcode } from './ProductBarcode';
import type { ProductLabelData } from '@/server/products/label-data';

export function ProductLabelPreview({ label, locale }: { label: ProductLabelData; locale: 'ar' | 'en' }) {
  return (
    <section
      className="sku-label-printable flex bg-white text-black"
      dir="ltr"
      aria-label="SKU sticker label"
      style={{ width: '60mm', height: '30mm' }}
    >
      <div className="flex h-full w-full overflow-hidden p-[1.4mm]">
        <div className="flex h-full w-[34.2mm] shrink-0 items-center justify-center pe-[0.7mm]">
          <ProductBarcode value={label.retailBarcode} className="h-[20.2mm] w-[32.2mm] shrink-0" />
        </div>
        <div
          className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-black px-[1.1mm] py-[0.35mm]"
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
        >
          <h2 className="line-clamp-2 break-words text-[11.5px] font-black leading-[1.04] text-black">
            {label.mainName}
          </h2>
          {label.variationName ? (
            <p className="mt-[0.55mm] line-clamp-2 text-[8px] font-bold leading-[1.08] text-black">{label.variationName}</p>
          ) : null}
          <div className="mt-auto border-t border-black pt-[0.55mm]">
            {label.specItems.map((item) => (
              <p
                key={`${item.label}-${item.value}`}
                className="truncate text-[5.8px] font-medium leading-[1.15] text-black"
              >
                <span className="font-bold">{item.label}:</span> {item.value}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

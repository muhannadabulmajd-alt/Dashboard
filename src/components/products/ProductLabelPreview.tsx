import { ProductBarcode } from './ProductBarcode';
import type { ProductLabelData } from '@/server/products/label-data';

function titleClass(name: string) {
  if (name.length > 42) return 'text-[9px]';
  if (name.length > 28) return 'text-[10.5px]';
  return 'text-[12px]';
}

export function ProductLabelPreview({ label, locale }: { label: ProductLabelData; locale: 'ar' | 'en' }) {
  return (
    <section
      className="sku-label-printable bg-white text-black"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label="SKU sticker label"
      style={{ width: '60mm', height: '30mm' }}
    >
      <div className="flex h-full w-full flex-col items-center justify-between overflow-hidden p-[1.5mm]">
        <div className="flex w-full flex-1 flex-col items-center justify-center overflow-hidden text-center">
          <h2 className={`${titleClass(label.mainName)} line-clamp-2 break-words font-black leading-none text-black`}>
            {label.mainName}
          </h2>
          {label.variationName ? (
            <p className="mt-[0.3mm] line-clamp-1 text-[8px] font-bold leading-none text-black">
              {label.variationName}
            </p>
          ) : null}
          {label.specLines.map((line) => (
            <p
              key={line}
              className="mt-[0.25mm] line-clamp-1 w-full text-[5.6px] font-medium leading-none text-black"
            >
              {line}
            </p>
          ))}
        </div>
        <ProductBarcode
          value={label.retailBarcode}
          className="mt-[0.2mm] h-[10.9mm] w-[54mm] shrink-0"
        />
      </div>
    </section>
  );
}

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
      <div className="flex h-full w-full flex-col justify-between overflow-hidden p-[2.2mm]">
        <div className="min-h-0">
          <h2 className="line-clamp-2 break-words text-[13px] font-black leading-[1.05] text-black">
            {label.mainName}
          </h2>
          <p className="mt-[1mm] truncate text-[8px] font-bold leading-tight text-black">{label.variationName}</p>
          {label.specs ? <p className="mt-[0.6mm] truncate text-[6.5px] font-medium leading-tight text-black">{label.specs}</p> : null}
        </div>
        <ProductBarcode value={label.barcodeValue} className="h-[9mm] w-full shrink-0" />
      </div>
    </section>
  );
}

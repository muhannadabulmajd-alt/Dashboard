import { barcodeModuleCount, encodeCode128B } from '@/lib/barcode';

export function ProductBarcode({ value, className }: { value: string; className?: string }) {
  const units = encodeCode128B(value);
  const total = barcodeModuleCount(units);
  return (
    <div className={className} aria-label="Barcode" role="img">
      <div className="flex h-full w-full items-stretch overflow-hidden bg-white">
        {units.map((unit, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={unit.bar ? 'bg-black' : 'bg-white'}
            style={{ width: `${(unit.width / total) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

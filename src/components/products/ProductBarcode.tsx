import { barcodeModuleCount, encodeCode128B } from '@/lib/barcode';

export function ProductBarcode({ value, className }: { value: string; className?: string }) {
  const units = encodeCode128B(value);
  const total = barcodeModuleCount(units);
  const bars = units.reduce(
    (state, unit, index) => ({
      cursor: state.cursor + unit.width,
      bars: unit.bar ? [...state.bars, { index, x: state.cursor, width: unit.width }] : state.bars,
    }),
    { cursor: 0, bars: [] as Array<{ index: number; x: number; width: number }> },
  ).bars;

  return (
    <div className={className} aria-label="Barcode" role="img">
      <svg
        aria-hidden="true"
        className="block h-full w-full bg-white text-black"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${total} 1`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {bars.map((bar) => (
          <rect key={bar.index} fill="currentColor" height="1" width={bar.width} x={bar.x} y="0" />
        ))}
      </svg>
    </div>
  );
}

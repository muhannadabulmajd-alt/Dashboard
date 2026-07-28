import { encodeEan13 } from '@/lib/barcode';

export function ProductBarcode({ value, className }: { value: string; className?: string }) {
  const modules = encodeEan13(value);
  const quietLeft = 11;
  const quietRight = 7;
  const total = quietLeft + modules.length + quietRight;
  const firstDigit = value[0];
  const leftDigits = value.slice(1, 7);
  const rightDigits = value.slice(7);

  return (
    <div className={className} aria-label={`EAN-13 barcode ${value}`} role="img" dir="ltr">
      <svg
        aria-hidden="true"
        className="block h-full w-full bg-white text-black"
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${total} 62`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect fill="#fff" height="62" width={total} x="0" y="0" />
        {modules.filter((module) => module.bar).map((module) => (
          <rect
            key={module.index}
            fill="currentColor"
            height={module.guard ? 49 : 43}
            width="1"
            x={quietLeft + module.index}
            y="0"
          />
        ))}
        <g fill="currentColor" fontFamily="Arial, sans-serif" fontSize="8.2" textAnchor="middle">
          <text x="5.5" y="59">{firstDigit}</text>
          {[...leftDigits].map((digit, index) => (
            <text key={`l-${index}`} x={quietLeft + 6.5 + index * 7} y="59">{digit}</text>
          ))}
          {[...rightDigits].map((digit, index) => (
            <text key={`r-${index}`} x={quietLeft + 53.5 + index * 7} y="59">{digit}</text>
          ))}
        </g>
      </svg>
    </div>
  );
}

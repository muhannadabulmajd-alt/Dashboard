import { Document, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { encodeEan13 } from '@/lib/barcode';
import { registerLaheebPdfFonts } from '@/server/pdf/laheeb-pdf';
import type { ProductLabelData } from './label-data';

registerLaheebPdfFonts();

const MM = 72 / 25.4;
const PAGE_WIDTH = 60 * MM;
const PAGE_HEIGHT = 30 * MM;
const SAFE_MARGIN = 1.5 * MM;
const BARCODE_WIDTH = 54 * MM;
const BAR_HEIGHT = 25;
const GUARD_HEIGHT = 28.5;

const styles = StyleSheet.create({
  page: {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    padding: SAFE_MARGIN,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: 'Amiri',
  },
  label: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  copy: {
    width: '100%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  main: {
    width: '100%',
    color: '#000000',
    fontWeight: 700,
    lineHeight: 1.02,
    textAlign: 'center',
  },
  variation: {
    width: '100%',
    color: '#000000',
    fontWeight: 700,
    fontSize: 7,
    lineHeight: 1.02,
    textAlign: 'center',
    marginTop: 0.8,
  },
  specs: {
    width: '100%',
    color: '#000000',
    fontSize: 5.15,
    lineHeight: 1.05,
    textAlign: 'center',
    marginTop: 0.65,
  },
  barcodePanel: {
    width: BARCODE_WIDTH,
    marginTop: 0.6,
    alignItems: 'center',
  },
  digits: {
    width: '100%',
    color: '#000000',
    fontFamily: 'Helvetica',
    fontSize: 5.6,
    letterSpacing: 1.15,
    lineHeight: 1,
    textAlign: 'center',
    marginTop: 0.15,
  },
});

function clipped(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function titleSize(value: string) {
  if (value.length > 42) return 7.7;
  if (value.length > 28) return 8.8;
  return 10.2;
}

export function ProductLabelPdf({ label, copies = 1 }: { label: ProductLabelData; copies?: number }) {
  const safeCopies = Math.min(24, Math.max(1, Math.trunc(copies)));

  return (
    <Document title="Laheeb product label">
      {Array.from({ length: safeCopies }, (_, index) => (
        <Page key={index} size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page}>
          <View style={styles.label}>
            <View style={styles.copy}>
              <Text style={[styles.main, { fontSize: titleSize(label.mainName) }]}>
                {clipped(label.mainName, 58)}
              </Text>
              {label.variationName ? (
                <Text style={styles.variation}>{clipped(label.variationName, 58)}</Text>
              ) : null}
              {label.specLines.map((line) => (
                <Text key={line} style={styles.specs}>{clipped(line, 72)}</Text>
              ))}
            </View>
            <PdfBarcode value={label.retailBarcode} />
          </View>
        </Page>
      ))}
    </Document>
  );
}

function PdfBarcode({ value }: { value: string }) {
  const modules = encodeEan13(value);
  const quietLeft = 11;
  const quietRight = 7;
  const totalModules = quietLeft + modules.length + quietRight;
  const moduleWidth = BARCODE_WIDTH / totalModules;
  const groupedDigits = `${value[0]}  ${value.slice(1, 7)}  ${value.slice(7)}`;

  return (
    <View style={styles.barcodePanel}>
      <Svg
        width={BARCODE_WIDTH}
        height={GUARD_HEIGHT}
        viewBox={`0 0 ${BARCODE_WIDTH} ${GUARD_HEIGHT}`}
      >
        <Rect x="0" y="0" width={BARCODE_WIDTH} height={GUARD_HEIGHT} fill="#FFFFFF" />
        {modules.filter((module) => module.bar).map((module) => (
          <Rect
            key={module.index}
            x={(quietLeft + module.index) * moduleWidth}
            y="0"
            width={moduleWidth}
            height={module.guard ? GUARD_HEIGHT : BAR_HEIGHT}
            fill="#000000"
          />
        ))}
      </Svg>
      <Text style={styles.digits}>{groupedDigits}</Text>
    </View>
  );
}

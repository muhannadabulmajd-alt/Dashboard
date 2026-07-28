import { Document, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { encodeEan13 } from '@/lib/barcode';
import { registerLaheebPdfFonts } from '@/server/pdf/laheeb-pdf';
import type { ProductLabelData } from './label-data';

registerLaheebPdfFonts();

const MM = 72 / 25.4;
const PAGE_WIDTH = 60 * MM;
const PAGE_HEIGHT = 30 * MM;
const PAGE_PADDING = 1.4 * MM;
const BARCODE_WIDTH = 32.2 * MM;

const styles = StyleSheet.create({
  page: {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    padding: PAGE_PADDING,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: 'Amiri',
  },
  label: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    height: '100%',
    borderLeftWidth: 0.55,
    borderLeftColor: '#000000',
    paddingLeft: 4,
    paddingRight: 1,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  main: {
    color: '#000000',
    fontSize: 10.2,
    fontWeight: 700,
    lineHeight: 1.04,
    marginBottom: 2,
    maxHeight: 22,
  },
  variation: {
    color: '#000000',
    fontSize: 7.2,
    fontWeight: 700,
    lineHeight: 1.08,
    maxHeight: 16,
  },
  specsBlock: {
    marginTop: 'auto',
    borderTopWidth: 0.45,
    borderTopColor: '#000000',
    paddingTop: 2,
  },
  spec: {
    color: '#000000',
    fontSize: 5.15,
    lineHeight: 1.12,
    marginBottom: 0.35,
  },
  barcodePanel: {
    width: 34.2 * MM,
    height: '100%',
    paddingRight: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcode: {
    width: BARCODE_WIDTH,
    height: 57,
  },
  digits: {
    color: '#000000',
    fontFamily: 'Helvetica',
    fontSize: 6.7,
    letterSpacing: 1.25,
    lineHeight: 1,
    textAlign: 'center',
    marginTop: 0.4,
  },
});

function clipped(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function ProductLabelPdf({ label, copies = 1 }: { label: ProductLabelData; copies?: number }) {
  const safeCopies = Math.min(24, Math.max(1, Math.trunc(copies)));
  const textDirection = label.locale === 'ar' ? { textAlign: 'right' as const } : { textAlign: 'left' as const };

  return (
    <Document title="Laheeb product label">
      {Array.from({ length: safeCopies }, (_, index) => (
        <Page key={index} size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page}>
          <View style={styles.label}>
            <View style={styles.barcodePanel}>
              <PdfBarcode value={label.retailBarcode} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.main, textDirection]}>{clipped(label.mainName, 44)}</Text>
              {label.variationName ? (
                <Text style={[styles.variation, textDirection]}>{clipped(label.variationName, 42)}</Text>
              ) : null}
              <View style={styles.specsBlock}>
                {label.specItems.map((item) => (
                  <Text key={`${item.label}-${item.value}`} style={[styles.spec, textDirection]}>
                    {clipped(`${item.label}: ${item.value}`, 38)}
                  </Text>
                ))}
              </View>
            </View>
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
  const barHeight = 44;
  const guardHeight = 49;
  const groupedDigits = `${value[0]}  ${value.slice(1, 7)}  ${value.slice(7)}`;

  return (
    <View style={styles.barcode}>
      <Svg width={BARCODE_WIDTH} height={guardHeight} viewBox={`0 0 ${BARCODE_WIDTH} ${guardHeight}`}>
        <Rect x="0" y="0" width={BARCODE_WIDTH} height={guardHeight} fill="#FFFFFF" />
        {modules.filter((module) => module.bar).map((module) => (
          <Rect
            key={module.index}
            x={(quietLeft + module.index) * moduleWidth}
            y="0"
            width={moduleWidth}
            height={module.guard ? guardHeight : barHeight}
            fill="#000000"
          />
        ))}
      </Svg>
      <Text style={styles.digits}>{groupedDigits}</Text>
    </View>
  );
}

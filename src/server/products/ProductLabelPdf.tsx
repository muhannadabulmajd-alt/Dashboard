import { Document, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { encodeEan13 } from '@/lib/barcode';
import { registerLaheebPdfFonts } from '@/server/pdf/laheeb-pdf';
import type { ProductLabelData } from './label-data';

registerLaheebPdfFonts();

const MM = 72 / 25.4;
const PAGE_WIDTH = 60 * MM;
const PAGE_HEIGHT = 30 * MM;
const PAGE_PADDING = 1.8 * MM;
const BARCODE_WIDTH = PAGE_WIDTH - PAGE_PADDING * 2;

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
    flexDirection: 'column',
    overflow: 'hidden',
  },
  copy: {
    width: '100%',
    height: '100%',
  },
  textBlock: {
    height: 34,
    overflow: 'hidden',
  },
  main: {
    color: '#000000',
    fontSize: 10.5,
    fontWeight: 700,
    lineHeight: 1.02,
    marginBottom: 1,
  },
  variation: {
    color: '#000000',
    fontSize: 7.6,
    fontWeight: 700,
    lineHeight: 1.05,
    marginBottom: 0.5,
  },
  specs: {
    color: '#000000',
    fontSize: 5.6,
    lineHeight: 1.05,
    marginTop: 0.4,
  },
  barcode: {
    marginTop: 'auto',
    height: 39,
    width: '100%',
  },
  digits: {
    color: '#000000',
    fontFamily: 'Helvetica',
    fontSize: 6.2,
    letterSpacing: 1.45,
    lineHeight: 1,
    textAlign: 'center',
    marginTop: -0.5,
  },
});

export function ProductLabelPdf({ label, copies = 1 }: { label: ProductLabelData; copies?: number }) {
  const safeCopies = Math.min(24, Math.max(1, Math.trunc(copies)));
  const textDirection = label.locale === 'ar' ? { textAlign: 'right' as const } : { textAlign: 'left' as const };

  return (
    <Document title="Laheeb product label">
      {Array.from({ length: safeCopies }, (_, index) => (
        <Page key={index} size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page}>
          <View style={styles.copy}>
            <View style={styles.textBlock}>
              <Text style={[styles.main, textDirection]}>{label.mainName}</Text>
              {label.variationName ? <Text style={[styles.variation, textDirection]}>{label.variationName}</Text> : null}
              {label.specLines.map((line) => <Text key={line} style={[styles.specs, textDirection]}>{line}</Text>)}
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
  const barHeight = 26;
  const guardHeight = 30;
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

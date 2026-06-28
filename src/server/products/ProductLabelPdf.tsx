import { Document, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { barcodeModuleCount, encodeCode128B } from '@/lib/barcode';
import { registerLaheebPdfFonts } from '@/server/pdf/laheeb-pdf';
import type { ProductLabelData } from './label-data';

registerLaheebPdfFonts();

const MM = 72 / 25.4;
const PAGE_WIDTH = 60 * MM;
const PAGE_HEIGHT = 30 * MM;

const styles = StyleSheet.create({
  page: {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    padding: 6,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: 'Amiri',
  },
  label: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  main: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.05,
    marginBottom: 2,
  },
  variation: {
    color: '#000000',
    fontSize: 7,
    fontWeight: 700,
    lineHeight: 1.1,
    marginBottom: 1,
  },
  specs: {
    color: '#000000',
    fontSize: 6,
    lineHeight: 1.1,
  },
});

export function ProductLabelPdf({ label }: { label: ProductLabelData }) {
  return (
    <Document title="Laheeb product label">
      <Page size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page}>
        <View style={styles.label}>
          <View>
            <Text style={styles.main}>{label.mainName}</Text>
            <Text style={styles.variation}>{label.variationName}</Text>
            {label.specs ? <Text style={styles.specs}>{label.specs}</Text> : null}
          </View>
          <PdfBarcode value={label.barcodeValue} />
        </View>
      </Page>
    </Document>
  );
}

function PdfBarcode({ value }: { value: string }) {
  const units = encodeCode128B(value);
  const total = barcodeModuleCount(units);
  const width = PAGE_WIDTH - 12;
  const height = 25;
  const rects = units.reduce<{ x: number; bars: { x: number; width: number }[] }>(
    (acc, unit) => {
      const unitWidth = (unit.width / total) * width;
      return {
        x: acc.x + unitWidth,
        bars: unit.bar ? [...acc.bars, { x: acc.x, width: unitWidth }] : acc.bars,
      };
    },
    { x: 0, bars: [] },
  ).bars;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Rect x="0" y="0" width={width} height={height} fill="#FFFFFF" />
      {rects.map((rect, index) => <Rect key={index} x={rect.x} y="0" width={rect.width} height={height} fill="#000000" />)}
    </Svg>
  );
}

import { Document, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { encodeEan13 } from '@/lib/barcode';
import {
  PRODUCT_LABEL_COLUMN_GAP_MM,
  PRODUCT_LABEL_DETAILS_PERCENT,
  PRODUCT_LABEL_SAFE_MARGIN_MM,
  productLabelPdfLineHeight,
  productLabelTypography,
  softWrapLabelText,
} from '@/lib/product-label-layout';
import { registerLaheebPdfFonts } from '@/server/pdf/laheeb-pdf';
import type { ProductLabelData } from './label-data';

registerLaheebPdfFonts();

const MM = 72 / 25.4;
const PAGE_WIDTH = 60 * MM;
const PAGE_HEIGHT = 30 * MM;
const SAFE_MARGIN = PRODUCT_LABEL_SAFE_MARGIN_MM * MM;
const INNER_WIDTH = PAGE_WIDTH - SAFE_MARGIN * 2;
const COLUMN_GAP = PRODUCT_LABEL_COLUMN_GAP_MM * MM;
const DETAILS_WIDTH = INNER_WIDTH * (PRODUCT_LABEL_DETAILS_PERCENT / 100);
const BARCODE_WIDTH = INNER_WIDTH - DETAILS_WIDTH - COLUMN_GAP;
const BAR_HEIGHT = 17.5 * MM;
const GUARD_HEIGHT = 19 * MM;

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
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  details: {
    width: DETAILS_WIDTH,
    flexShrink: 0,
    justifyContent: 'center',
  },
  main: {
    width: '100%',
    color: '#000000',
    fontWeight: 700,
  },
  variation: {
    width: '100%',
    color: '#000000',
    fontWeight: 700,
    marginTop: 1.8,
  },
  specs: {
    width: '100%',
    color: '#000000',
    marginTop: 0.8,
  },
  barcodePanel: {
    width: BARCODE_WIDTH,
    marginRight: COLUMN_GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digits: {
    width: '100%',
    color: '#000000',
    fontFamily: 'Helvetica',
    fontSize: 5.1,
    letterSpacing: 0.65,
    lineHeight: 1,
    textAlign: 'center',
    marginTop: 0.5,
  },
});

export function ProductLabelPdf({ label, copies = 1 }: { label: ProductLabelData; copies?: number }) {
  const safeCopies = Math.min(24, Math.max(1, Math.trunc(copies)));
  const typography = productLabelTypography(label);
  const rtl = label.locale === 'ar';
  const textAlign = rtl ? 'right' : 'left';

  return (
    <Document title="Laheeb product label">
      {Array.from({ length: safeCopies }, (_, index) => (
        <Page key={index} size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page}>
          <View style={styles.label}>
            <PdfBarcode value={label.retailBarcode} />
            <View style={styles.details}>
              <Text
                style={[
                  styles.main,
                  {
                    fontSize: typography.titlePt,
                    lineHeight: productLabelPdfLineHeight(typography.titlePt, 1.12),
                    textAlign,
                  },
                ]}
              >
                {softWrapLabelText(label.mainName)}
              </Text>
              {label.variationName ? (
                <Text
                  style={[
                    styles.variation,
                    {
                      fontSize: typography.variationPt,
                      lineHeight: productLabelPdfLineHeight(typography.variationPt, 1.18),
                      textAlign,
                    },
                  ]}
                >
                  {softWrapLabelText(label.variationName)}
                </Text>
              ) : null}
              {label.specItems.map((item) => (
                <Text
                  key={`${item.label}-${item.value}`}
                  style={[
                    styles.specs,
                    {
                      fontSize: typography.specsPt,
                      lineHeight: productLabelPdfLineHeight(typography.specsPt, 1.28),
                      textAlign,
                    },
                  ]}
                >
                  {softWrapLabelText(`${item.label}: ${item.value}`)}
                </Text>
              ))}
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

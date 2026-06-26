import path from 'node:path';
import { Font, Line, Polyline, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { formatMoney, formatNumber, formatPercent, type AppLocale } from '@/lib/money';
import type { WidgetValueKind } from '@/lib/dashboard-builder';

let fontsRegistered = false;

export function registerLaheebPdfFonts() {
  if (fontsRegistered) return;
  Font.register({ family: 'Amiri', src: path.join(process.cwd(), 'public/fonts/Amiri-Regular.ttf') });
  fontsRegistered = true;
}

registerLaheebPdfFonts();

export const PDF_COLORS = {
  linen: '#F3F0DC',
  grove: '#3C4220',
  amber: '#AD6830',
  sage: '#7F8B57',
  cherry: '#963520',
  roast: '#562D1E',
  border: '#DDD6C8',
  muted: '#766B5F',
  white: '#FFFFFF',
};

export const pdfBaseStyles = StyleSheet.create({
  page: { padding: 26, fontFamily: 'Amiri', color: PDF_COLORS.roast, backgroundColor: '#FFFEFB', fontSize: 8.5 },
  rtl: { textAlign: 'right' },
  header: { marginBottom: 10, borderBottomWidth: 1, borderBottomColor: PDF_COLORS.border, paddingBottom: 8 },
  title: { fontSize: 18, color: PDF_COLORS.grove, marginBottom: 3 },
  subtitle: { color: PDF_COLORS.muted, lineHeight: 1.4 },
  footer: { position: 'absolute', bottom: 12, left: 26, right: 26, flexDirection: 'row', justifyContent: 'space-between', color: PDF_COLORS.muted, fontSize: 7 },
  card: { borderWidth: 1, borderColor: PDF_COLORS.border, backgroundColor: PDF_COLORS.white, borderRadius: 5, padding: 8 },
  cardTitle: { fontSize: 9.5, color: PDF_COLORS.grove, marginBottom: 5 },
  muted: { color: PDF_COLORS.muted },
  row: { flexDirection: 'row' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: PDF_COLORS.border, paddingVertical: 3 },
  tableHead: { backgroundColor: PDF_COLORS.linen, color: PDF_COLORS.grove },
  cell: { paddingHorizontal: 3, lineHeight: 1.25 },
});

export function pdfDirection(locale: AppLocale) {
  return locale === 'ar' ? pdfBaseStyles.rtl : {};
}

export function pdfWidgetValue(value: number, kind: WidgetValueKind, locale: AppLocale): string {
  if (kind === 'iqd') return formatMoney(value, 'IQD', locale);
  if (kind === 'percent') return formatPercent(value, locale);
  if (kind === 'grams') return `${formatNumber(value / 1000, locale, 3)} kg`;
  if (kind === 'days') return `${formatNumber(value, locale, 1)} d`;
  return formatNumber(value, locale, 1);
}

export function PdfKpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={pdfBaseStyles.card}>
      <Text style={[pdfBaseStyles.muted, { marginBottom: 4 }]}>{label}</Text>
      <Text style={{ color: PDF_COLORS.roast, fontSize: 15, lineHeight: 1.25 }}>{value}</Text>
    </View>
  );
}

export function PdfTable({
  columns,
  rows,
  maxRows = 24,
}: {
  columns: string[];
  rows: (string | number)[][];
  maxRows?: number;
}) {
  return (
    <View>
      <View style={[pdfBaseStyles.tableRow, pdfBaseStyles.tableHead]} fixed>
        {columns.map((column) => <Text key={column} style={[pdfBaseStyles.cell, { flex: 1 }]}>{column}</Text>)}
      </View>
      {rows.slice(0, maxRows).map((row, index) => (
        <View key={index} style={pdfBaseStyles.tableRow} wrap={false}>
          {row.map((cell, cellIndex) => <Text key={cellIndex} style={[pdfBaseStyles.cell, { flex: 1 }]}>{String(cell)}</Text>)}
        </View>
      ))}
    </View>
  );
}

export function PdfBarList({
  rows,
  kind,
  locale,
}: {
  rows: { label: string; value: number }[];
  kind: WidgetValueKind;
  locale: AppLocale;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View>
      {rows.slice(0, 12).map((row) => (
        <View key={row.label} style={{ marginBottom: 5 }} wrap={false}>
          <View style={[pdfBaseStyles.row, { justifyContent: 'space-between', marginBottom: 2 }]}>
            <Text style={{ width: '58%' }}>{row.label}</Text>
            <Text style={{ width: '40%', textAlign: 'right' }}>{pdfWidgetValue(row.value, kind, locale)}</Text>
          </View>
          <View style={{ height: 8, backgroundColor: PDF_COLORS.linen, borderRadius: 2 }}>
            <View style={{ height: 8, width: `${Math.max(1, (row.value / max) * 100)}%`, backgroundColor: PDF_COLORS.amber, borderRadius: 2 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function PdfLineChart({
  rows,
  kind,
  locale,
}: {
  rows: { label: string; value: number }[];
  kind: WidgetValueKind;
  locale: AppLocale;
}) {
  const points = rows.slice(0, 18);
  const max = Math.max(1, ...points.map((row) => row.value));
  const width = 250;
  const height = 96;
  const coords = points.map((row, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - (row.value / max) * (height - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <View>
      <Svg width="100%" height={118} viewBox={`0 0 ${width} 118`}>
        <Line x1="0" y1={height} x2={width} y2={height} stroke={PDF_COLORS.border} strokeWidth="1" />
        <Line x1="0" y1="10" x2={width} y2="10" stroke={PDF_COLORS.linen} strokeWidth="1" />
        <Polyline points={coords} fill="none" stroke={PDF_COLORS.amber} strokeWidth="2" />
      </Svg>
      {points.length ? (
        <View style={[pdfBaseStyles.row, { justifyContent: 'space-between', color: PDF_COLORS.muted, fontSize: 7 }]}>
          <Text>{points[0].label}</Text>
          <Text>{pdfWidgetValue(max, kind, locale)}</Text>
          <Text>{points[points.length - 1].label}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function PdfDonutLegend({
  rows,
  kind,
  locale,
}: {
  rows: { label: string; value: number }[];
  kind: WidgetValueKind;
  locale: AppLocale;
}) {
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.value, 0));
  return (
    <View>
      {rows.slice(0, 10).map((row, index) => (
        <View key={row.label} style={[pdfBaseStyles.row, { alignItems: 'center', marginBottom: 4 }]} wrap={false}>
          <View style={{ width: 7, height: 7, backgroundColor: index % 2 ? PDF_COLORS.sage : PDF_COLORS.amber }} />
          <Text style={{ marginLeft: 5, flex: 1 }}>{row.label}</Text>
          <Text style={{ width: 72, textAlign: 'right' }}>{pdfWidgetValue(row.value, kind, locale)}</Text>
          <Text style={{ width: 32, textAlign: 'right', color: PDF_COLORS.muted }}>{formatPercent(row.value / total, locale, 0)}</Text>
        </View>
      ))}
    </View>
  );
}

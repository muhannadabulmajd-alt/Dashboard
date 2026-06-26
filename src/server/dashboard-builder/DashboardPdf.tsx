import path from 'node:path';
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { DashboardConfig, WidgetData, WidgetValueKind } from '@/lib/dashboard-builder';
import { formatMoney, formatNumber, formatPercent, type AppLocale } from '@/lib/money';

Font.register({ family: 'Amiri', src: path.join(process.cwd(), 'public/fonts/Amiri-Regular.ttf') });

const C = {
  linen: '#F3F0DC',
  grove: '#3C4220',
  amber: '#AD6830',
  roast: '#562D1E',
  border: '#DDD6C8',
  muted: '#766B5F',
  white: '#FFFFFF',
};

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: 'Amiri', color: C.roast, backgroundColor: '#FFFEFB', fontSize: 8.5 },
  rtl: { textAlign: 'right' },
  header: { marginBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 8 },
  title: { fontSize: 18, color: C.grove, marginBottom: 3 },
  subtitle: { color: C.muted, lineHeight: 1.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  widget: { padding: 4 },
  card: { borderWidth: 1, borderColor: C.border, backgroundColor: C.white, borderRadius: 5, padding: 8, minHeight: 54 },
  cardTitle: { fontSize: 9.5, color: C.grove, marginBottom: 5 },
  kpi: { fontSize: 16, color: C.roast },
  muted: { color: C.muted },
  barRow: { marginBottom: 5 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  barTrack: { height: 8, backgroundColor: C.linen, borderRadius: 2 },
  bar: { height: 8, backgroundColor: C.amber, borderRadius: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 3 },
  th: { backgroundColor: C.linen, color: C.grove },
  cell: { flex: 1, paddingHorizontal: 2 },
  footer: { position: 'absolute', bottom: 12, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', color: C.muted, fontSize: 7 },
});

function value(data: WidgetData, locale: AppLocale): string {
  if (data.kind !== 'kpi') return '';
  if (data.valueKind === 'iqd') return formatMoney(data.value, 'IQD', locale);
  if (data.valueKind === 'percent') return formatPercent(data.value, locale);
  if (data.valueKind === 'grams') return `${formatNumber(data.value / 1000, locale, 3)} kg`;
  if (data.valueKind === 'days') return `${formatNumber(data.value, locale, 1)} d`;
  return formatNumber(data.value, locale, 1);
}

function seriesValue(value: number, kind: WidgetValueKind, locale: AppLocale) {
  if (kind === 'iqd') return formatMoney(value, 'IQD', locale);
  if (kind === 'percent') return formatPercent(value, locale);
  if (kind === 'grams') return `${formatNumber(value / 1000, locale, 3)} kg`;
  return formatNumber(value, locale, 1);
}

function WidgetBody({ data, locale }: { data: WidgetData; locale: AppLocale }) {
  if (data.kind === 'kpi') {
    return <><Text style={s.kpi}>{value(data, locale)}</Text>{data.subtitle ? <Text style={s.muted}>{data.subtitle}</Text> : null}</>;
  }
  if (data.kind === 'series') {
    const rows = data.points.slice(0, 12);
    const max = Math.max(1, ...rows.map((point) => point.value));
    return <View>{rows.map((point) => <View key={point.label} style={s.barRow} wrap={false}>
      <View style={s.barLabels}><Text>{point.label}</Text><Text>{seriesValue(point.value, data.valueKind, locale)}</Text></View>
      <View style={s.barTrack}><View style={[s.bar, { width: `${Math.max(1, point.value / max * 100)}%` }]} /></View>
    </View>)}</View>;
  }
  if (data.kind === 'table') {
    return <View>
      <View style={[s.tableRow, s.th]}>{data.columns.map((column) => <Text key={column} style={s.cell}>{column}</Text>)}</View>
      {data.rows.slice(0, 24).map((row, index) => <View key={index} style={s.tableRow} wrap={false}>
        {row.map((cell, cellIndex) => <Text key={cellIndex} style={s.cell}>{String(cell)}</Text>)}
      </View>)}
    </View>;
  }
  if (data.kind === 'text') return <Text style={s.muted}>{data.body}</Text>;
  return <Text style={s.muted}>{data.message}</Text>;
}

export function DashboardPdf({
  name,
  description,
  config,
  dataByWidget,
  locale,
}: {
  name: string;
  description: string | null;
  config: DashboardConfig;
  dataByWidget: Record<string, WidgetData>;
  locale: AppLocale;
}) {
  const rtl = locale === 'ar' ? s.rtl : {};
  const visibleWidgets = config.widgets.filter((widget) => !widget.hideFromPdf);
  return <Document title={name} author="Laheeb Atlas">
    <Page size="A4" orientation="landscape" style={[s.page, rtl]} wrap>
      <View style={s.header}>
        <Text style={s.title}>{name}</Text>
        {description ? <Text style={s.subtitle}>{description}</Text> : null}
        <Text style={s.subtitle}>{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad' }).format(new Date())}</Text>
      </View>
      <View style={s.grid}>
        {visibleWidgets.map((widget) => {
          const item = config.layout.find((layout) => layout.i === widget.id);
          const width = `${(((item?.w ?? 6) / 12) * 100).toFixed(4)}%`;
          return <View key={widget.id} style={[s.widget, { width }]} wrap={false}>
            <View style={s.card}>
              <Text style={s.cardTitle}>{widget.title}</Text>
              <WidgetBody data={dataByWidget[widget.id] ?? { kind: 'empty', message: 'No data found for the selected filters.' }} locale={locale} />
            </View>
          </View>;
        })}
      </View>
      <View style={s.footer} fixed><Text>LAHEEB ATLAS</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
    </Page>
  </Document>;
}

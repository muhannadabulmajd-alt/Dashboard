import path from 'node:path';
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { DashboardConfig, WidgetData } from '@/lib/dashboard-builder';
import type { AppLocale } from '@/lib/money';
import { PDF_COLORS as C, PdfBarList, PdfDonutLegend, PdfLineChart, PdfTable, pdfBaseStyles, pdfDirection, pdfWidgetValue } from '@/server/pdf/laheeb-pdf';

Font.register({ family: 'Amiri', src: path.join(process.cwd(), 'public/fonts/Amiri-Regular.ttf') });

const s = StyleSheet.create({
  page: pdfBaseStyles.page,
  header: pdfBaseStyles.header,
  title: pdfBaseStyles.title,
  subtitle: pdfBaseStyles.subtitle,
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  filterChip: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, color: C.muted, fontSize: 7 },
  row: { flexDirection: 'row', marginHorizontal: -3, marginBottom: 6 },
  widget: { padding: 4 },
  card: { borderWidth: 1, borderColor: C.border, backgroundColor: C.white, borderRadius: 5, padding: 8 },
  cardTitle: { fontSize: 9.5, color: C.grove, marginBottom: 5 },
  kpi: { fontSize: 16, color: C.roast },
  muted: { color: C.muted },
  footer: pdfBaseStyles.footer,
});

function value(data: WidgetData, locale: AppLocale): string {
  if (data.kind !== 'kpi') return '';
  return pdfWidgetValue(data.value, data.valueKind, locale);
}

function WidgetBody({
  data,
  widgetType,
  locale,
}: {
  data: WidgetData;
  widgetType: DashboardConfig['widgets'][number]['type'];
  locale: AppLocale;
}) {
  if (data.kind === 'kpi') {
    return <><Text style={s.kpi}>{value(data, locale)}</Text>{data.subtitle ? <Text style={s.muted}>{data.subtitle}</Text> : null}</>;
  }
  if (data.kind === 'series') {
    if (widgetType === 'line' || widgetType === 'combo') return <PdfLineChart rows={data.points} kind={data.valueKind} locale={locale} />;
    if (widgetType === 'donut') return <PdfDonutLegend rows={data.points} kind={data.valueKind} locale={locale} />;
    return <PdfBarList rows={data.points} kind={data.valueKind} locale={locale} />;
  }
  if (data.kind === 'table') {
    return <PdfTable columns={data.columns} rows={data.rows} />;
  }
  if (data.kind === 'text') return <Text style={s.muted}>{data.body}</Text>;
  return <Text style={s.muted}>{data.message}</Text>;
}

function rowGroups(config: DashboardConfig) {
  const visible = config.layout
    .filter((item) => config.widgets.some((widget) => widget.id === item.i && !widget.hideFromPdf))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: typeof visible[] = [];
  for (const item of visible) {
    const group = groups.find((row) => Math.abs(row[0].y - item.y) <= 1);
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map((row) => row.sort((a, b) => a.x - b.x));
}

function FilterSummary({ config }: { config: DashboardConfig }) {
  const entries = Object.entries(config.globalFilters ?? {}).filter(([, value]) => {
    if (Array.isArray(value)) return value.length;
    return Boolean(value);
  });
  if (!entries.length) return null;
  return <View style={s.filterBar}>{entries.map(([key, value]) => (
    <Text key={key} style={s.filterChip}>{key}: {Array.isArray(value) ? value.join(', ') : String(value)}</Text>
  ))}</View>;
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
  const rtl = pdfDirection(locale);
  const rows = rowGroups(config);
  return <Document title={name} author="Laheeb Atlas">
    <Page size="A4" orientation="landscape" style={[s.page, rtl]} wrap>
      <View style={s.header}>
        <Text style={s.title}>{name}</Text>
        {description ? <Text style={s.subtitle}>{description}</Text> : null}
        <Text style={s.subtitle}>{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad' }).format(new Date())}</Text>
        <FilterSummary config={config} />
      </View>
      <View>
        {rows.map((row) => (
          <View key={row.map((item) => item.i).join('-')} style={s.row} wrap={false}>
            {row.map((item) => {
              const widget = config.widgets.find((candidate) => candidate.id === item.i);
              if (!widget) return null;
              const width = `${((item.w / 12) * 100).toFixed(4)}%`;
              const minHeight = Math.max(54, Math.min(210, item.h * 34));
              return <View key={widget.id} style={[s.widget, { width }]} wrap={false}>
                <View style={[s.card, { minHeight }]}>
                  <Text style={s.cardTitle}>{widget.title}</Text>
                  <WidgetBody
                    widgetType={widget.type}
                    data={dataByWidget[widget.id] ?? { kind: 'empty', message: 'No data found for the selected filters.' }}
                    locale={locale}
                  />
                </View>
              </View>;
            })}
          </View>
        ))}
      </View>
      <View style={s.footer} fixed><Text>LAHEEB ATLAS</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
    </Page>
  </Document>;
}

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import type { DeckData } from './deck-data';

const COFFEE = '#6f4e37';
const ACCENT = '#a9743f';
const MUTED = '#6b625a';
const BORDER = '#e7e0d6';

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 44, paddingHorizontal: 40, fontSize: 9, color: '#1c1917' },
  cover: { flexDirection: 'column', justifyContent: 'center', height: '100%' },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  brandMark: { width: 34, height: 34, borderRadius: 8, backgroundColor: COFFEE, marginRight: 10 },
  brandText: { fontSize: 13, fontWeight: 'bold', color: COFFEE },
  title: { fontSize: 26, fontWeight: 'bold', marginBottom: 6 },
  subtitle: { fontSize: 12, color: MUTED, marginBottom: 24 },
  meta: { fontSize: 10, color: MUTED, marginBottom: 3 },
  confidential: { position: 'absolute', bottom: 36, left: 40, fontSize: 8, color: MUTED },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COFFEE,
    marginTop: 16,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 3,
  },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  kpiBox: {
    width: '25%',
    padding: 6,
  },
  kpiInner: { borderWidth: 1, borderColor: BORDER, borderRadius: 6, padding: 8 },
  kpiLabel: { fontSize: 7.5, color: MUTED, marginBottom: 3 },
  kpiValue: { fontSize: 11, fontWeight: 'bold' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 3 },
  th: { fontSize: 8, color: MUTED, fontWeight: 'bold' },
  cell: { fontSize: 9 },
  bullet: { flexDirection: 'row', marginBottom: 4 },
  bulletDot: { width: 10, color: ACCENT },
  pageNum: { position: 'absolute', bottom: 24, right: 40, fontSize: 8, color: MUTED },
  header: { position: 'absolute', top: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  headerText: { fontSize: 8, color: MUTED },
});

const money = (n: number) => formatMoney(n, 'IQD', 'en');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function RunningHeader() {
  return (
    <View style={s.header} fixed>
      <Text style={s.headerText}>Laheeb Operations Atlas</Text>
      <Text style={s.headerText}>Management Deck</Text>
    </View>
  );
}

export function Deck({ data }: { data: DeckData }) {
  return (
    <Document title="Laheeb Operations Atlas — Management Deck">
      {/* Cover */}
      <Page size="A4" style={s.page}>
        <View style={s.cover}>
          <View style={s.brandRow}>
            <View style={s.brandMark} />
            <Text style={s.brandText}>LAHEEB COFFEE · قهوة لهيب</Text>
          </View>
          <Text style={s.title}>Operations Atlas</Text>
          <Text style={s.subtitle}>Management Deck — Roastery & Commerce Intelligence</Text>
          <Text style={s.meta}>Period: {data.periodLabel}</Text>
          <Text style={s.meta}>Generated: {data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</Text>
          <Text style={s.meta}>Scope: {data.showFinancial ? 'Includes financials' : 'Operational (no financials)'}</Text>
        </View>
        <Text style={s.confidential}>Confidential — internal use only.</Text>
      </Page>

      {/* Content */}
      <Page size="A4" style={s.page}>
        <RunningHeader />

        <Section title="Executive summary">
          <View style={s.kpiGrid}>
            {data.executive.map((k, i) => (
              <View key={i} style={s.kpiBox}>
                <View style={s.kpiInner}>
                  <Text style={s.kpiLabel}>{k.label}</Text>
                  <Text style={s.kpiValue}>{k.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Top products">
          <View style={s.row}>
            <Text style={[s.th, { flex: 3 }]}>Product</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Units</Text>
            <Text style={[s.th, { flex: 2, textAlign: 'right' }]}>Net sales</Text>
          </View>
          {data.topProducts.map((p, i) => (
            <View key={i} style={s.row}>
              <Text style={[s.cell, { flex: 3 }]}>{p.name}</Text>
              <Text style={[s.cell, { flex: 1, textAlign: 'right' }]}>{formatNumber(p.units, 'en')}</Text>
              <Text style={[s.cell, { flex: 2, textAlign: 'right' }]}>{money(p.netSales)}</Text>
            </View>
          ))}
        </Section>

        {data.pnl ? (
          <Section title="P&L summary">
            {[
              ['Gross revenue', data.pnl.gross],
              ['− Discounts', -data.pnl.discounts],
              ['− Refunds', -data.pnl.refunds],
              ['= Net sales', data.pnl.net],
              ['− COGS', -data.pnl.cogs],
              ['= Gross margin', data.pnl.grossMargin],
              ['− Operating costs', -data.pnl.opex],
              ['= Operating profit', data.pnl.operatingProfit],
            ].map(([label, value], i) => (
              <View key={i} style={s.row}>
                <Text style={[s.cell, { flex: 3 }]}>{label as string}</Text>
                <Text style={[s.cell, { flex: 2, textAlign: 'right' }]}>{money(value as number)}</Text>
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Inventory & stock health">
          <View style={s.kpiGrid}>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Stock value</Text>
                <Text style={s.kpiValue}>{money(data.inventory.stockValue)}</Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Reorder alerts</Text>
                <Text style={s.kpiValue}>{data.inventory.reorderCount}</Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Near expiry</Text>
                <Text style={s.kpiValue}>{data.inventory.expiryCount}</Text>
              </View>
            </View>
          </View>
          {data.inventory.alerts.length ? (
            <Text style={[s.cell, { color: MUTED, marginTop: 4 }]}>Watchlist: {data.inventory.alerts.join(', ')}</Text>
          ) : null}
        </Section>

        <Section title="Customers & fulfillment">
          <View style={s.kpiGrid}>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Active customers</Text>
                <Text style={s.kpiValue}>{formatNumber(data.customers.active, 'en')}</Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>New / Returning</Text>
                <Text style={s.kpiValue}>
                  {data.customers.newCount} / {data.customers.returning}
                </Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Repeat rate</Text>
                <Text style={s.kpiValue}>{formatPercent(data.customers.repeatRate, 'en')}</Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Delivery SLA</Text>
                <Text style={s.kpiValue}>{formatPercent(data.fulfillment.slaPct, 'en')}</Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Avg delivery</Text>
                <Text style={s.kpiValue}>{formatNumber(data.fulfillment.avgDeliveryDays, 'en', 1)} d</Text>
              </View>
            </View>
            <View style={s.kpiBox}>
              <View style={s.kpiInner}>
                <Text style={s.kpiLabel}>Return rate</Text>
                <Text style={s.kpiValue}>{formatPercent(data.fulfillment.returnRate, 'en')}</Text>
              </View>
            </View>
          </View>
        </Section>

        <Section title="Action plan">
          {data.actions.map((a, i) => (
            <View key={i} style={s.bullet}>
              <Text style={s.bulletDot}>•</Text>
              <Text style={[s.cell, { flex: 1 }]}>{a}</Text>
            </View>
          ))}
        </Section>

        <Text style={s.pageNum} render={({ pageNumber }) => `${pageNumber}`} fixed />
      </Page>
    </Document>
  );
}

import path from 'node:path';
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { AppLocale } from '@/lib/money';
import type { ShareholderReportData } from './shareholder-data';

Font.register({ family: 'Amiri', src: path.join(process.cwd(), 'public/fonts/Amiri-Regular.ttf') });

const C = {
  linen: '#F3F0DC',
  sage: '#818C55',
  grove: '#3C4220',
  amber: '#AD6830',
  cherry: '#96351E',
  roast: '#562D1E',
  white: '#FFFFFF',
  border: '#DDD6C8',
  muted: '#6B625A',
};

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 38, paddingHorizontal: 34, fontFamily: 'Amiri', fontSize: 8.5, color: C.roast, backgroundColor: '#FFFEFB' },
  rtl: { textAlign: 'right' },
  header: { position: 'absolute', top: 16, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', color: C.muted, fontSize: 7 },
  footer: { position: 'absolute', bottom: 16, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', color: C.muted, fontSize: 7 },
  cover: { height: '100%', justifyContent: 'center' },
  eyebrow: { color: C.amber, fontSize: 10, marginBottom: 8 },
  title: { color: C.grove, fontSize: 27, lineHeight: 1.25, marginBottom: 10 },
  subtitle: { color: C.muted, fontSize: 12, lineHeight: 1.5, marginBottom: 24 },
  meta: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 6, lineHeight: 1.6 },
  confidential: { position: 'absolute', bottom: 24, left: 34, right: 34, color: C.muted, fontSize: 7 },
  sectionTitle: { color: C.grove, fontSize: 15, marginBottom: 8, marginTop: 4 },
  sectionNote: { color: C.muted, lineHeight: 1.45, marginBottom: 10 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  kpi: { width: '25%', padding: 4 },
  kpiInner: { borderWidth: 1, borderColor: C.border, borderRadius: 5, padding: 8, minHeight: 54 },
  kpiLabel: { color: C.muted, fontSize: 7, marginBottom: 4 },
  kpiValue: { color: C.grove, fontSize: 12 },
  assurance: { borderWidth: 1, borderColor: C.sage, backgroundColor: '#F5F7EC', borderRadius: 5, padding: 10, marginBottom: 8 },
  warning: { borderColor: C.amber, backgroundColor: '#FFF8ED' },
  assuranceTitle: { fontSize: 10, color: C.grove, marginBottom: 3 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 4, minHeight: 18 },
  th: { color: C.grove, backgroundColor: C.linen, fontSize: 7.2, paddingVertical: 4 },
  cell: { paddingHorizontal: 3, fontSize: 7.2 },
  barRow: { marginBottom: 8 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  barTrack: { height: 10, backgroundColor: C.linen, borderRadius: 2 },
  bar: { height: 10, backgroundColor: C.amber, borderRadius: 2 },
  checkPass: { color: C.sage },
  checkWarn: { color: C.amber },
  checkFail: { color: C.cherry },
  hash: { fontSize: 6.5, color: C.muted },
});

const T = {
  en: {
    title: 'Shareholder Finance Report', subtitle: 'Capital deployment, spending, assets, liquidity and data integrity',
    confidential: 'Confidential - shareholders and authorized management only', period: 'Reporting period', generated: 'Generated in Baghdad', snapshot: 'Snapshot hash',
    executive: 'Financial position', integrity: 'Data integrity assurance', internal: 'Internal reconciliation', traceability: 'Atlas source traceability', evidence: 'Attached-document coverage',
    evidenceNote: 'Atlas record keys provide source traceability. They do not independently prove a supplier invoice or bank movement.',
    capital: 'Capital received', spending: 'Total spending', paid: 'Paid spending', payable: 'Outstanding payable', cash: 'Cash balance', inventory: 'Inventory value', assets: 'Fixed assets', operating: 'Operating spending', sales: 'Sales recorded',
    allocation: 'Where the money went', monthly: 'Spending over time', suppliers: 'Largest suppliers', owners: 'Capital by shareholder',
    checks: 'Integrity checks', check: 'Check', status: 'Status', actual: 'Actual', expected: 'Expected', note: 'Explanation',
    transactions: 'Every recorded spending line', key: 'Record', date: 'Date', supplier: 'Supplier', item: 'Item / purpose', qty: 'Qty', unit: 'Unit', unitCost: 'Unit cost', total: 'Total', payment: 'Payment', reference: 'Reference',
    prelaunch: 'No sales are recorded. This report therefore describes a pre-launch capital-deployment position, not trading profitability.',
  },
  ar: {
    title: 'التقرير المالي للمساهمين', subtitle: 'توظيف رأس المال والإنفاق والأصول والسيولة وسلامة البيانات',
    confidential: 'سري - للمساهمين والإدارة المخولة فقط', period: 'فترة التقرير', generated: 'وقت الإنشاء في بغداد', snapshot: 'بصمة لقطة البيانات',
    executive: 'الوضع المالي', integrity: 'تأكيد سلامة البيانات', internal: 'المطابقة الداخلية', traceability: 'تتبع سجلات أطلس', evidence: 'تغطية المستندات المرفقة',
    evidenceNote: 'توفر رموز سجلات أطلس إمكانية التتبع، لكنها لا تثبت بصورة مستقلة فاتورة المورد أو الحركة المصرفية.',
    capital: 'رأس المال المستلم', spending: 'إجمالي الإنفاق', paid: 'الإنفاق المدفوع', payable: 'المبلغ المستحق', cash: 'الرصيد النقدي', inventory: 'قيمة المخزون', assets: 'الأصول الثابتة', operating: 'الإنفاق التشغيلي', sales: 'المبيعات المسجلة',
    allocation: 'أين صُرفت الأموال', monthly: 'الإنفاق عبر الزمن', suppliers: 'أكبر الموردين', owners: 'رأس المال حسب المساهم',
    checks: 'فحوصات سلامة البيانات', check: 'الفحص', status: 'الحالة', actual: 'الفعلي', expected: 'المتوقع', note: 'التوضيح',
    transactions: 'كل بند إنفاق مسجل', key: 'السجل', date: 'التاريخ', supplier: 'المورد', item: 'البند / الغرض', qty: 'الكمية', unit: 'الوحدة', unitCost: 'كلفة الوحدة', total: 'الإجمالي', payment: 'الدفع', reference: 'المرجع',
    prelaunch: 'لا توجد مبيعات مسجلة، لذلك يوضح هذا التقرير وضع توظيف رأس المال قبل الإطلاق وليس ربحية التشغيل التجاري.',
  },
} as const;

function money(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 0 }).format(value) + ' IQD';
}

function pct(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 1 }).format(value) + '%';
}

function date(value: Date | null, locale: AppLocale): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Baghdad' }).format(value);
}

function Header({ locale }: { locale: AppLocale }) {
  return <View style={[s.header, locale === 'ar' ? s.rtl : {}]} fixed><Text>LAHEEB ATLAS</Text><Text>{T[locale].title}</Text></View>;
}

function Footer({ data, locale }: { data: ShareholderReportData; locale: AppLocale }) {
  return <View style={[s.footer, locale === 'ar' ? s.rtl : {}]} fixed><Text>{data.snapshotHash.slice(0, 16)}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <View style={s.kpi}><View style={s.kpiInner}><Text style={s.kpiLabel}>{label}</Text><Text style={s.kpiValue}>{value}</Text></View></View>;
}

function Bars({ rows, locale }: { rows: { name: string; amount: number }[]; locale: AppLocale }) {
  const max = Math.max(1, ...rows.map((row) => row.amount));
  return <View>{rows.map((row) => <View key={row.name} style={s.barRow} wrap={false}>
    <View style={[s.barLabels, locale === 'ar' ? s.rtl : {}]}><Text>{row.name}</Text><Text>{money(row.amount, locale)}</Text></View>
    <View style={s.barTrack}><View style={[s.bar, { width: `${Math.max(1, row.amount / max * 100)}%` }]} /></View>
  </View>)}</View>;
}

export function ShareholderReportPdf({ data, locale }: { data: ShareholderReportData; locale: AppLocale }) {
  const t = T[locale];
  const rtl = locale === 'ar' ? s.rtl : {};
  const allocationLabels = locale === 'ar'
    ? { INVENTORY: 'مشتريات المخزون', FIXED_ASSET: 'الأصول الثابتة', OPERATING: 'الإنفاق التشغيلي' }
    : { INVENTORY: 'Inventory purchases', FIXED_ASSET: 'Fixed assets', OPERATING: 'Operating spending' };
  return <Document title={t.title} author="Laheeb Atlas" subject={data.snapshotHash}>
    <Page size="A4" style={[s.page, rtl]}>
      <View style={s.cover}>
        <Text style={s.eyebrow}>LAHEEB COFFEE / قهوة لهيب</Text>
        <Text style={s.title}>{t.title}</Text>
        <Text style={s.subtitle}>{t.subtitle}</Text>
        <View style={s.meta}>
          <Text>{t.period}: {date(data.firstActivityAt, locale)} - {date(data.asOf, locale)}</Text>
          <Text>{t.generated}: {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad' }).format(data.generatedAt)}</Text>
          <Text style={s.hash}>{t.snapshot}: {data.snapshotHash}</Text>
        </View>
      </View>
      <Text style={s.confidential}>{t.confidential}</Text>
    </Page>

    <Page size="A4" style={[s.page, rtl]}>
      <Header locale={locale} /><Footer data={data} locale={locale} />
      <Text style={s.sectionTitle}>{t.executive}</Text>
      <View style={s.kpiGrid}>
        <Kpi label={t.capital} value={money(data.baseline.capitalReceived, locale)} />
        <Kpi label={t.spending} value={money(data.baseline.totalSpending, locale)} />
        <Kpi label={t.paid} value={money(data.baseline.paidSpending, locale)} />
        <Kpi label={t.payable} value={money(data.baseline.outstandingPayable, locale)} />
        <Kpi label={t.cash} value={money(data.baseline.cashBalance, locale)} />
        <Kpi label={t.inventory} value={money(data.baseline.inventoryValue, locale)} />
        <Kpi label={t.assets} value={money(data.baseline.fixedAssetValue, locale)} />
        <Kpi label={t.operating} value={money(data.baseline.operatingSpending, locale)} />
      </View>
      {data.baseline.salesOrders === 0 ? <Text style={[s.assurance, { marginTop: 10 }]}>{t.prelaunch}</Text> : null}
      <Text style={s.sectionTitle}>{t.integrity}</Text>
      <View style={s.assurance}><Text style={s.assuranceTitle}>{t.internal}: {pct(data.internalIntegrityPercent, locale)}</Text><Text>{data.internallyReconciled ? 'PASS' : 'FAIL'} - {data.checks.filter((row) => row.status === 'PASS').length}/{data.checks.filter((row) => row.status !== 'WARNING').length}</Text></View>
      <View style={s.assurance}><Text style={s.assuranceTitle}>{t.traceability}: {pct(data.traceabilityPercent, locale)}</Text><Text>{data.baseline.tracedRecords}/{data.baseline.spendingRecords}</Text></View>
      <View style={[s.assurance, s.warning]}><Text style={s.assuranceTitle}>{t.evidence}: {pct(data.attachmentCoveragePercent, locale)}</Text><Text>{t.evidenceNote}</Text></View>
    </Page>

    <Page size="A4" style={[s.page, rtl]}>
      <Header locale={locale} /><Footer data={data} locale={locale} />
      <Text style={s.sectionTitle}>{t.allocation}</Text>
      <Bars locale={locale} rows={data.spendingByClass.map((row) => ({ name: allocationLabels[row.key], amount: row.amount }))} />
      <Text style={s.sectionTitle}>{t.monthly}</Text>
      <Bars locale={locale} rows={data.monthlySpending.map((row) => ({ name: row.month, amount: row.amount }))} />
    </Page>

    <Page size="A4" style={[s.page, rtl]}>
      <Header locale={locale} /><Footer data={data} locale={locale} />
      <Text style={s.sectionTitle}>{t.suppliers}</Text>
      <Bars locale={locale} rows={data.spendingBySupplier.slice(0, 12)} />
      <Text style={s.sectionTitle}>{t.owners}</Text>
      <Bars locale={locale} rows={data.capitalByOwner} />
    </Page>

    <Page size="A4" style={[s.page, rtl]}>
      <Header locale={locale} /><Footer data={data} locale={locale} />
      <Text style={s.sectionTitle}>{t.checks}</Text>
      <View style={[s.row, s.th]}><Text style={[s.cell, { flex: 2.2 }]}>{t.check}</Text><Text style={[s.cell, { flex: 0.7 }]}>{t.status}</Text><Text style={[s.cell, { flex: 1 }]}>{t.actual}</Text><Text style={[s.cell, { flex: 1 }]}>{t.expected}</Text><Text style={[s.cell, { flex: 3 }]}>{t.note}</Text></View>
      {data.checks.map((row) => <View key={row.key} style={s.row} wrap={false}>
        <Text style={[s.cell, { flex: 2.2 }]}>{row.key.replaceAll('_', ' ')}</Text>
        <Text style={[s.cell, { flex: 0.7 }, row.status === 'PASS' ? s.checkPass : row.status === 'WARNING' ? s.checkWarn : s.checkFail]}>{row.status}</Text>
        <Text style={[s.cell, { flex: 1 }]}>{String(row.actual)}</Text><Text style={[s.cell, { flex: 1 }]}>{String(row.expected)}</Text><Text style={[s.cell, { flex: 3 }]}>{row.note}</Text>
      </View>)}
    </Page>

    <Page size="A4" orientation="landscape" style={[s.page, rtl]} wrap>
      <Header locale={locale} /><Footer data={data} locale={locale} />
      <Text style={s.sectionTitle}>{t.transactions}</Text>
      <View style={[s.row, s.th]} fixed><Text style={[s.cell, { width: '9%' }]}>{t.key}</Text><Text style={[s.cell, { width: '9%' }]}>{t.date}</Text><Text style={[s.cell, { width: '14%' }]}>{t.supplier}</Text><Text style={[s.cell, { width: '22%' }]}>{t.item}</Text><Text style={[s.cell, { width: '7%' }]}>{t.qty}</Text><Text style={[s.cell, { width: '7%' }]}>{t.unit}</Text><Text style={[s.cell, { width: '10%' }]}>{t.unitCost}</Text><Text style={[s.cell, { width: '10%' }]}>{t.total}</Text><Text style={[s.cell, { width: '7%' }]}>{t.payment}</Text><Text style={[s.cell, { width: '10%' }]}>{t.reference}</Text></View>
      {data.spendLines.map((row) => <View key={`${row.entryId}-${row.lineNo}`} style={s.row} wrap={false}>
        <Text style={[s.cell, { width: '9%' }]}>{row.recordKey}</Text><Text style={[s.cell, { width: '9%' }]}>{date(row.date, locale)}</Text><Text style={[s.cell, { width: '14%' }]}>{row.supplier}</Text><Text style={[s.cell, { width: '22%' }]}>{row.itemName}</Text><Text style={[s.cell, { width: '7%' }]}>{row.quantity.toFixed(3)}</Text><Text style={[s.cell, { width: '7%' }]}>{row.unit}</Text><Text style={[s.cell, { width: '10%' }]}>{money(row.unitCost, locale)}</Text><Text style={[s.cell, { width: '10%' }]}>{money(row.lineTotal, locale)}</Text><Text style={[s.cell, { width: '7%' }]}>{row.paymentStatus}</Text><Text style={[s.cell, { width: '10%' }]}>{row.reference}</Text>
      </View>)}
    </Page>
  </Document>;
}

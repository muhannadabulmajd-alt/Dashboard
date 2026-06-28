import path from 'node:path';
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { PDF_COLORS as C, pdfBaseStyles, pdfDirection } from '@/server/pdf/laheeb-pdf';
import type { PartyStatementData } from './party-statement';

Font.register({ family: 'Amiri', src: path.join(process.cwd(), 'public/fonts/Amiri-Regular.ttf') });

const styles = StyleSheet.create({
  page: { ...pdfBaseStyles.page, padding: 28, fontSize: 9.2 },
  title: { fontSize: 20, color: C.grove, marginBottom: 4 },
  muted: { color: C.muted, lineHeight: 1.35 },
  section: { marginTop: 14 },
  grid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  box: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 8, minHeight: 54 },
  boxLabel: { color: C.muted, marginBottom: 4 },
  boxValue: { fontSize: 13.5, color: C.roast },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border, paddingVertical: 5, minHeight: 24 },
  head: { backgroundColor: C.linen, color: C.grove },
  cDate: { width: '11%', paddingHorizontal: 2 },
  cText: { width: '32%', paddingHorizontal: 2 },
  cRef: { width: '24%', paddingHorizontal: 2 },
  cMoney: { width: '11%', paddingHorizontal: 2, textAlign: 'right' },
  footer: pdfBaseStyles.footer,
});

const LABELS = {
  en: {
    title: 'Party statement',
    period: 'Period',
    opening: 'Opening',
    charges: 'Charges',
    payments: 'Payments',
    closing: 'Closing',
    date: 'Date',
    description: 'Description',
    reference: 'Reference',
    charge: 'Charge',
    payment: 'Payment',
    balance: 'Balance',
  },
  ar: {
    title: 'كشف حساب الطرف',
    period: 'الفترة',
    opening: 'الرصيد الافتتاحي',
    charges: 'المستحقات',
    payments: 'المدفوعات',
    closing: 'الرصيد الختامي',
    date: 'التاريخ',
    description: 'الوصف',
    reference: 'المرجع',
    charge: 'مستحق',
    payment: 'مدفوع',
    balance: 'الرصيد',
  },
} as const;

export function PartyStatementPdf({ data }: { data: PartyStatementData }) {
  const t = LABELS[data.locale];
  const locale = data.locale;
  return (
    <Document title={`${t.title} ${data.party.name}`}>
      <Page size="A4" style={[styles.page, pdfDirection(locale)]} wrap>
        <Text style={styles.title}>{t.title}</Text>
        <Text>{data.party.name}</Text>
        <Text style={styles.muted}>
          {t.period}: {formatDate(data.range.start, locale)} - {formatDate(data.range.end, locale)}
        </Text>
      </Page>
    </Document>
  );
}

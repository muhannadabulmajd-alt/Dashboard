import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import type { PartyStatementData } from './party-statement';

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10, color: '#532d1f', fontFamily: 'Helvetica' },
  rtl: { direction: 'rtl', textAlign: 'right' },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  muted: { color: '#766b5f' },
  section: { marginTop: 14 },
  grid: { flexDirection: 'row', gap: 8, marginTop: 10 },
  box: { flex: 1, borderWidth: 1, borderColor: '#e6dccb', borderRadius: 6, padding: 8 },
  boxLabel: { color: '#766b5f', marginBottom: 4 },
  boxValue: { fontSize: 13, fontWeight: 700 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e6dccb', paddingVertical: 5 },
  head: { backgroundColor: '#f5efe4', fontWeight: 700 },
  cDate: { width: '13%' },
  cText: { width: '34%' },
  cRef: { width: '17%' },
  cMoney: { width: '12%', textAlign: 'right' },
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
  const rtl = locale === 'ar';
  return (
    <Document title={`${t.title} ${data.party.name}`}>
      <Page size="A4" style={rtl ? [styles.page, styles.rtl] : styles.page}>
        <Text style={styles.title}>{t.title}</Text>
        <Text>{data.party.name}</Text>
        <Text style={styles.muted}>
          {t.period}: {formatDate(data.range.start, locale)} - {formatDate(data.range.end, locale)}
        </Text>
        <Text style={styles.muted}>
          {[data.party.phone, data.party.email, data.party.address].filter(Boolean).join(' · ')}
        </Text>

        <View style={styles.grid}>
          {[
            [t.opening, data.opening],
            [t.charges, data.charges],
            [t.payments, data.payments],
            [t.closing, data.closing],
          ].map(([label, value]) => (
            <View key={label} style={styles.box}>
              <Text style={styles.boxLabel}>{label}</Text>
              <Text style={styles.boxValue}>{formatMoney(Number(value), 'IQD', locale)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <View style={[styles.row, styles.head]}>
            <Text style={styles.cDate}>{t.date}</Text>
            <Text style={styles.cText}>{t.description}</Text>
            <Text style={styles.cRef}>{t.reference}</Text>
            <Text style={styles.cMoney}>{t.charge}</Text>
            <Text style={styles.cMoney}>{t.payment}</Text>
            <Text style={styles.cMoney}>{t.balance}</Text>
          </View>
          {data.entries.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <Text style={styles.cDate}>{formatDate(entry.date, locale)}</Text>
              <Text style={styles.cText}>{entry.description}</Text>
              <Text style={styles.cRef}>{entry.reference ?? ''}</Text>
              <Text style={styles.cMoney}>{entry.charge ? formatMoney(entry.charge, 'IQD', locale) : ''}</Text>
              <Text style={styles.cMoney}>{entry.payment ? formatMoney(entry.payment, 'IQD', locale) : ''}</Text>
              <Text style={styles.cMoney}>{formatMoney(entry.balance, 'IQD', locale)}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

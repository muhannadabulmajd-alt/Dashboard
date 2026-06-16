import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { activeInvoiceFinanceEntry } from '@/lib/invoice';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { formatMoney, type AppLocale } from '@/lib/money';
import type { InvoiceData } from './data';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: '#2f211b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e7ded2', paddingBottom: 14 },
  brand: { fontSize: 15, fontWeight: 'bold', color: '#532d1f' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#9b3a22', textAlign: 'right' },
  muted: { color: '#73695f' },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginBottom: 6, color: '#532d1f' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee7df', paddingVertical: 4 },
  th: { fontSize: 7.5, fontWeight: 'bold', color: '#73695f' },
  cell: { fontSize: 8.5 },
  right: { textAlign: 'right' },
  summary: { marginTop: 12, marginLeft: 'auto', width: 220 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  total: { borderTopWidth: 1, borderTopColor: '#e7ded2', paddingTop: 4, fontWeight: 'bold' },
});

type Labels = Record<string, string>;

export function InvoicePdf({ data, labels, locale }: { data: InvoiceData; labels: Labels; locale: AppLocale }) {
  const { order, financeEntries, payment } = data;
  const m = (amount: number) => formatMoney(amount, order.currency, locale);
  const customerName =
    (locale === 'ar' ? order.customer?.nameAr : order.customer?.nameEn) ||
    order.customer?.nameEn ||
    order.customer?.nameAr ||
    order.customer?.externalId ||
    labels.walkIn;
  const paymentRows = financeEntries.filter((entry) => {
    if (!activeInvoiceFinanceEntry(entry)) return false;
    if (entry.type === 'INCOME' && !entry.obligation && entry.orderId === order.id) return true;
    return entry.type === 'PAYMENT_IN' && Boolean(entry.settlesId && payment.receivableIds.includes(entry.settlesId));
  });
  const lineDiscount = Math.max(0, order.discountAmount - order.orderDiscount);

  return (
    <Document title={`${labels.title} ${order.orderNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{labels.brand}</Text>
            <Text style={styles.muted}>{labels.tagline}</Text>
            <Text style={styles.muted}>{order.branch ? (locale === 'ar' ? order.branch.nameAr : order.branch.nameEn) : ''}</Text>
          </View>
          <View>
            <Text style={styles.title}>{labels.title}</Text>
            <Text>{labels.invoiceNo}: {order.orderNumber}</Text>
            <Text>{labels.date}: {formatDate(order.placedAt, locale)}</Text>
            <Text>{labels.paymentStatusLabel}: {labels[`paymentStatus.${payment.status}`]}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.customerDetails}</Text>
          <Text>{customerName}</Text>
          {order.customer?.externalId ? <Text style={styles.muted}>{labels.customerId}: {order.customer.externalId}</Text> : null}
          {order.customer?.phone ? <Text style={styles.muted}>{labels.phone}: {order.customer.phone}</Text> : null}
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={[styles.th, { flex: 0.35 }]}>#</Text>
            <Text style={[styles.th, { flex: 2.2 }]}>{labels.item}</Text>
            <Text style={[styles.th, { flex: 1.4 }]}>{labels.variation}</Text>
            <Text style={[styles.th, { flex: 0.8 }]}>{labels.unit}</Text>
            <Text style={[styles.th, styles.right, { flex: 0.7 }]}>{labels.qty}</Text>
            <Text style={[styles.th, styles.right, { flex: 1 }]}>{labels.unitPrice}</Text>
            <Text style={[styles.th, styles.right, { flex: 1 }]}>{labels.lineTotal}</Text>
          </View>
          {order.lines.map((line, index) => (
            <View key={line.id} style={styles.row}>
              <Text style={[styles.cell, { flex: 0.35 }]}>{index + 1}</Text>
              <Text style={[styles.cell, { flex: 2.2 }]}>{line.product.invoiceName || (locale === 'ar' ? line.product.nameAr : line.product.nameEn)}</Text>
              <Text style={[styles.cell, { flex: 1.4 }]}>{[line.product.sizeLabel, enumLabel(line.product.grind, locale)].filter(Boolean).join(' ')}</Text>
              <Text style={[styles.cell, { flex: 0.8 }]}>{line.unitLabel}</Text>
              <Text style={[styles.cell, styles.right, { flex: 0.7 }]}>{line.quantity}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>{m(line.unitGrossPrice)}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>{m(line.lineNet)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.summary}>
          <Summary label={labels.subtotal} value={m(order.grossAmount)} />
          {lineDiscount ? <Summary label={labels.itemDiscounts} value={`- ${m(lineDiscount)}`} /> : null}
          {order.orderDiscount ? <Summary label={labels.orderDiscount} value={`- ${m(order.orderDiscount)}`} /> : null}
          {order.deliveryFee ? <Summary label={labels.delivery} value={m(order.deliveryFee)} /> : null}
          {order.extraCharges ? <Summary label={labels.extraCharges} value={m(order.extraCharges)} /> : null}
          <Summary label={labels.grandTotal} value={m(payment.total)} strong />
          <Summary label={labels.paid} value={m(payment.paid)} />
          <Summary label={labels.remaining} value={m(payment.remaining)} strong />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.paymentHistory}</Text>
          {paymentRows.length ? paymentRows.map((entry) => (
            <Text key={entry.id}>{formatDate(entry.date, locale)} - {m(entry.amount)} - {entry.account?.name ?? ''}</Text>
          )) : <Text style={styles.muted}>{labels.noPayments}</Text>}
        </View>
      </Page>
    </Document>
  );
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={strong ? [styles.summaryRow, styles.total] : styles.summaryRow}>
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { activeInvoiceFinanceEntry } from '@/lib/invoice';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { formatMoney, type AppLocale } from '@/lib/money';
import { registerLaheebPdfFonts } from '@/server/pdf/laheeb-pdf';
import type { InvoiceData } from './data';

registerLaheebPdfFonts();

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: 'Amiri', fontSize: 9, color: '#2f211b' },
  rtl: { textAlign: 'right' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e7ded2', paddingBottom: 14 },
  brand: { fontSize: 15, fontWeight: 'bold', color: '#532d1f' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#9b3a22', textAlign: 'right' },
  muted: { color: '#73695f' },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginBottom: 6, color: '#532d1f' },
  detailsGrid: { flexDirection: 'row', gap: 10, marginTop: 14 },
  detailCard: { flex: 1, borderWidth: 1, borderColor: '#e7ded2', borderRadius: 4, padding: 9 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 3 },
  detailRowRtl: { flexDirection: 'row-reverse' },
  detailLabel: { width: 76, color: '#73695f', paddingRight: 5 },
  detailLabelRtl: { paddingRight: 0, paddingLeft: 5 },
  detailValue: { flex: 1, lineHeight: 1.35 },
  notes: { marginTop: 12, padding: 8, backgroundColor: '#f7f3ec', borderRadius: 4, lineHeight: 1.4 },
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
  const isRtl = locale === 'ar';
  const m = (amount: number) => formatMoney(amount, order.currency, locale);
  const customerName =
    (locale === 'ar' ? order.customer?.nameAr : order.customer?.nameEn) ||
    order.customer?.nameEn ||
    order.customer?.nameAr ||
    order.customer?.externalId ||
    labels.walkIn;
  const branchName = order.branch ? (locale === 'ar' ? order.branch.nameAr : order.branch.nameEn) : '—';
  const branchAddress = [
    order.branch?.governorate ? enumLabel(order.branch.governorate, locale) : '',
    order.branch?.address,
    order.branch?.street,
  ].filter(Boolean).join(' · ');
  const deliveryGovernorate = enumLabel(order.governorate || order.customer?.governorate, locale);
  const creator = order.createdBy?.name ?? order.createdBy?.email ?? labels.system;
  const paymentRows = financeEntries.filter((entry) => {
    if (!activeInvoiceFinanceEntry(entry)) return false;
    if (payment.providerReceivableIds.includes(entry.id)) return true;
    if (
      (entry.type === 'INCOME' || entry.type === 'PAYMENT_IN') &&
      !entry.obligation &&
      !entry.settlesId &&
      entry.orderId === order.id
    ) return true;
    return entry.type === 'PAYMENT_IN' && Boolean(
      entry.settlesId &&
      [...payment.receivableIds, ...payment.providerReceivableIds].includes(entry.settlesId),
    );
  });
  const lineDiscount = Math.max(0, order.discountAmount - order.orderDiscount);

  return (
    <Document title={`${labels.title} ${order.orderNumber}`}>
      <Page size="A4" style={isRtl ? [styles.page, styles.rtl] : styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{labels.brand}</Text>
            <Text style={styles.muted}>{labels.tagline}</Text>
            <Text style={styles.muted}>{branchName}</Text>
            {branchAddress ? <Text style={styles.muted}>{branchAddress}</Text> : null}
            {order.branch?.phone ? <Text style={styles.muted}>{labels.phone}: {order.branch.phone}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>{labels.title}</Text>
            <Text>{labels.invoiceNo}: {order.orderNumber}</Text>
            <Text>{labels.date}: {formatDate(order.placedAt, locale)}</Text>
            <Text>{labels.paymentStatusLabel}: {labels[`paymentStatus.${payment.status}`]}</Text>
          </View>
        </View>

        <View style={styles.detailsGrid}>
          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>{labels.customerDetails}</Text>
            <DetailRow label={labels.billTo} value={customerName} rtl={isRtl} strong />
            <DetailRow label={labels.customerId} value={order.customer?.externalId} rtl={isRtl} />
            <DetailRow label={labels.phone} value={order.customer?.phone} rtl={isRtl} />
            <DetailRow label={labels.email} value={order.customer?.email} rtl={isRtl} />
            <DetailRow label={labels.governorate} value={deliveryGovernorate} rtl={isRtl} />
            <DetailRow label={labels.address} value={order.customer?.address1} rtl={isRtl} />
            <DetailRow label={labels.street} value={order.customer?.street} rtl={isRtl} />
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>{labels.deliveryDetails}</Text>
            <DetailRow label={labels.branch} value={branchName} rtl={isRtl} />
            <DetailRow label={labels.channel} value={enumLabel(order.channel, locale)} rtl={isRtl} />
            <DetailRow label={labels.fulfillment} value={enumLabel(order.fulfillmentMethod, locale)} rtl={isRtl} />
            <DetailRow label={labels.orderStatus} value={enumLabel(order.status, locale)} rtl={isRtl} />
            <DetailRow label={labels.paymentStatusLabel} value={labels[`paymentStatus.${payment.status}`]} rtl={isRtl} strong />
            <DetailRow label={labels.createdBy} value={creator} rtl={isRtl} />
          </View>
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
          {order.refundAmount ? <Summary label={labels.refunds} value={`- ${m(order.refundAmount)}`} /> : null}
          <Summary label={labels.grandTotal} value={m(payment.total)} strong />
          <Summary label={labels.paid} value={m(payment.paid)} />
          <Summary label={labels.remaining} value={m(payment.remaining)} strong />
          <Summary label={labels.paymentRoute} value={labels[`route.${payment.route}`]} />
          {payment.providerName ? <Summary label={labels.provider} value={payment.providerName} /> : null}
          {payment.providerCollected > 0 ? (
            <>
              <Summary label={labels.providerCollected} value={m(payment.providerCollected)} />
              <Summary label={labels.providerRemitted} value={m(payment.providerRemitted)} />
              <Summary label={labels.providerFeesOffset} value={m(payment.providerFeesOffset)} />
              <Summary label={labels.providerOutstanding} value={m(payment.providerOutstanding)} />
            </>
          ) : null}
        </View>

        {order.notes ? (
          <View style={styles.notes} wrap={false}>
            <Text><Text style={{ fontWeight: 'bold' }}>{labels.notes}: </Text>{order.notes}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.paymentHistory}</Text>
          {paymentRows.length ? paymentRows.map((entry) => (
            <Text key={entry.id}>
              {formatDate(entry.date, locale)} - {m(entry.amount)} - {entry.account?.name ?? entry.party?.name ?? ''}
            </Text>
          )) : <Text style={styles.muted}>{labels.noPayments}</Text>}
        </View>
      </Page>
    </Document>
  );
}

function DetailRow({
  label,
  value,
  rtl,
  strong = false,
}: {
  label: string;
  value: string | null | undefined;
  rtl: boolean;
  strong?: boolean;
}) {
  return (
    <View style={rtl ? [styles.detailRow, styles.detailRowRtl] : styles.detailRow}>
      <Text style={rtl ? [styles.detailLabel, styles.detailLabelRtl] : styles.detailLabel}>{label}</Text>
      <Text style={strong ? [styles.detailValue, { fontWeight: 'bold' }] : styles.detailValue}>{value || '—'}</Text>
    </View>
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

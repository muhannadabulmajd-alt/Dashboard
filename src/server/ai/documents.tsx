import 'server-only';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  renderToBuffer,
  StyleSheet,
} from '@react-pdf/renderer';
import type { AiDocumentKind } from '@prisma/client';
import type { AppLocale } from '@/lib/money';
import { formatMoney, formatNumber } from '@/lib/money';
import { prisma } from '@/server/db/client';
import { renderInvoicePdf } from '@/server/invoice/pdf';
import {
  PDF_COLORS,
  pdfBaseStyles,
  pdfDirection,
  registerLaheebPdfFonts,
} from '@/server/pdf/laheeb-pdf';
import { sendTelegramDocument } from '@/server/telegram/api';
import { enqueueAiDocument } from './document-queue';

registerLaheebPdfFonts();

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 5,
    marginBottom: 9,
    overflow: 'hidden',
  },
  sectionTitle: {
    backgroundColor: PDF_COLORS.linen,
    color: PDF_COLORS.grove,
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  fieldRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  fieldLabel: { width: '34%', color: PDF_COLORS.muted },
  fieldValue: { width: '66%', color: PDF_COLORS.roast },
  summary: {
    backgroundColor: PDF_COLORS.grove,
    color: PDF_COLORS.white,
    borderRadius: 5,
    padding: 9,
    marginBottom: 9,
  },
});

type PdfField = { label: string; value: string };
type PdfSection = { title: string; fields: PdfField[] };

type DocumentSnapshot = {
  title: string;
  subtitle: string;
  summary: string;
  sections: PdfSection[];
};

function localized(locale: AppLocale, en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

function clean(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toString' in value) return String(value);
  return String(value);
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'record';
}

function titleForKind(kind: AiDocumentKind, locale: AppLocale): string {
  const titles: Record<AiDocumentKind, [string, string]> = {
    INVOICE: ['Invoice', 'فاتورة'],
    PAYMENT_RECEIPT: ['Payment receipt', 'وصل استلام'],
    REFUND_RECEIPT: ['Refund receipt', 'وصل استرداد'],
    FINANCE_VOUCHER: ['Finance voucher', 'سند مالي'],
    INVENTORY_MOVEMENT: ['Inventory movement', 'حركة مخزون'],
    PRODUCTION_MOVEMENT: ['Production movement', 'حركة إنتاج'],
    RECORD_SUMMARY: ['Record summary', 'ملخص السجل'],
    CHANGE_CONFIRMATION: ['Change confirmation', 'تأكيد التغيير'],
    REPORT: ['Atlas report', 'تقرير أطلس'],
  };
  return localized(locale, titles[kind][0], titles[kind][1]);
}

function dateLabel(value: Date | null | undefined, locale: AppLocale): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Baghdad',
  }).format(value);
}

function GenericAiDocument({
  snapshot,
  locale,
  reference,
  generatedAt,
}: {
  snapshot: DocumentSnapshot;
  locale: AppLocale;
  reference: string;
  generatedAt: Date;
}) {
  const rtl = locale === 'ar';
  return (
    <Document title={snapshot.title} author="Laheeb Operations Atlas">
      <Page size="A4" style={[pdfBaseStyles.page, pdfDirection(locale)]}>
        <View style={pdfBaseStyles.header}>
          <Text style={[pdfBaseStyles.title, rtl ? { textAlign: 'right' } : {}]}>{snapshot.title}</Text>
          <Text style={[pdfBaseStyles.subtitle, rtl ? { textAlign: 'right' } : {}]}>{snapshot.subtitle}</Text>
        </View>
        <View style={styles.summary}>
          <Text style={rtl ? { textAlign: 'right' } : {}}>{snapshot.summary}</Text>
        </View>
        {snapshot.sections.map((section, sectionIndex) => (
          <View key={`${section.title}-${sectionIndex}`} style={styles.section} wrap={false}>
            <Text style={[styles.sectionTitle, rtl ? { textAlign: 'right' } : {}]}>{section.title}</Text>
            {section.fields.map((field, fieldIndex) => (
              <View key={`${field.label}-${fieldIndex}`} style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, rtl ? { textAlign: 'right' } : {}]}>{field.label}</Text>
                <Text style={[styles.fieldValue, rtl ? { textAlign: 'right' } : {}]}>{field.value}</Text>
              </View>
            ))}
          </View>
        ))}
        <View style={pdfBaseStyles.footer} fixed>
          <Text>{reference}</Text>
          <Text>{localized(locale, 'Generated', 'تاريخ الإنشاء')}: {dateLabel(generatedAt, locale)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

async function customerSnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: recordId },
    select: {
      externalId: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      email: true,
      governorate: true,
      address1: true,
      street: true,
      segment: true,
      campaignSource: true,
      notes: true,
      createdAt: true,
    },
  });
  if (!customer) return null;
  const name = locale === 'ar'
    ? customer.nameAr || customer.nameEn || customer.phone || customer.externalId
    : customer.nameEn || customer.nameAr || customer.phone || customer.externalId;
  return {
    title: localized(locale, 'Customer record', 'سجل العميل'),
    subtitle: clean(customer.externalId),
    summary: clean(name),
    sections: [{
      title: localized(locale, 'Customer details', 'تفاصيل العميل'),
      fields: [
        { label: localized(locale, 'Name', 'الاسم'), value: clean(name) },
        { label: localized(locale, 'Phone', 'رقم الهاتف'), value: clean(customer.phone) },
        { label: localized(locale, 'Email', 'البريد الإلكتروني'), value: clean(customer.email) },
        { label: localized(locale, 'Governorate', 'المحافظة'), value: clean(customer.governorate) },
        { label: localized(locale, 'Address', 'العنوان'), value: clean(customer.address1) },
        { label: localized(locale, 'Street', 'الشارع'), value: clean(customer.street) },
        { label: localized(locale, 'Segment', 'التصنيف'), value: clean(customer.segment) },
        { label: localized(locale, 'Source', 'المصدر'), value: clean(customer.campaignSource) },
        { label: localized(locale, 'Notes', 'ملاحظات'), value: clean(customer.notes) },
        { label: localized(locale, 'Created', 'تاريخ الإنشاء'), value: dateLabel(customer.createdAt, locale) },
      ],
    }],
  };
}

async function partySnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const party = await prisma.party.findUnique({
    where: { id: recordId },
    select: { externalKey: true, name: true, type: true, phone: true, email: true, address: true, notes: true, createdAt: true },
  });
  if (!party) return null;
  return {
    title: localized(locale, 'Party record', 'سجل الجهة'),
    subtitle: clean(party.externalKey || party.type),
    summary: party.name,
    sections: [{
      title: localized(locale, 'Details', 'التفاصيل'),
      fields: [
        { label: localized(locale, 'Name', 'الاسم'), value: party.name },
        { label: localized(locale, 'Type', 'النوع'), value: party.type },
        { label: localized(locale, 'Phone', 'رقم الهاتف'), value: clean(party.phone) },
        { label: localized(locale, 'Email', 'البريد الإلكتروني'), value: clean(party.email) },
        { label: localized(locale, 'Address', 'العنوان'), value: clean(party.address) },
        { label: localized(locale, 'Notes', 'ملاحظات'), value: clean(party.notes) },
        { label: localized(locale, 'Created', 'تاريخ الإنشاء'), value: dateLabel(party.createdAt, locale) },
      ],
    }],
  };
}

async function financeSnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const entry = await prisma.financeEntry.findUnique({
    where: { id: recordId },
    include: {
      account: { select: { name: true } },
      toAccount: { select: { name: true } },
      party: { select: { name: true } },
      ledgerLines: { orderBy: { lineNo: 'asc' } },
      fixedAssets: { select: { id: true, name: true, totalCost: true } },
    },
  });
  if (!entry) return null;
  const sections: PdfSection[] = [{
    title: localized(locale, 'Record details', 'تفاصيل السجل'),
    fields: [
      { label: localized(locale, 'Record key', 'رقم السجل'), value: clean(entry.recordKey || entry.importKey || entry.id) },
      { label: localized(locale, 'Date', 'التاريخ'), value: dateLabel(entry.date, locale) },
      { label: localized(locale, 'Type', 'النوع'), value: entry.type },
      { label: localized(locale, 'Amount', 'المبلغ'), value: formatMoney(entry.amount, 'IQD', locale) },
      { label: localized(locale, 'Account', 'الحساب'), value: clean(entry.account?.name) },
      { label: localized(locale, 'To account', 'إلى حساب'), value: clean(entry.toAccount?.name) },
      { label: localized(locale, 'Party', 'الجهة'), value: clean(entry.party?.name) },
      { label: localized(locale, 'Payment method', 'طريقة الدفع'), value: clean(entry.paymentMethod) },
      { label: localized(locale, 'Reference', 'المرجع'), value: clean(entry.reference) },
      { label: localized(locale, 'Description', 'الوصف'), value: clean(entry.description) },
      { label: localized(locale, 'Reversed', 'معكوس'), value: entry.reversedAt ? dateLabel(entry.reversedAt, locale) : '-' },
      { label: localized(locale, 'Reversal reason', 'سبب العكس'), value: clean(entry.reversalReason) },
    ],
  }];
  if (entry.ledgerLines.length) {
    sections.push({
      title: localized(locale, 'Lines and classifications', 'البنود والتصنيفات'),
      fields: entry.ledgerLines.flatMap((line) => [
        {
          label: `${line.lineNo}. ${line.itemName}`,
          value: `${formatNumber(Number(line.quantity), locale, 3)} ${line.unit} · ${formatMoney(line.lineTotal, 'IQD', locale)}`,
        },
        {
          label: localized(locale, 'Treatment', 'المعالجة'),
          value: `${line.spendTreatment} · ${line.classificationStatus}${line.classificationNote ? ` · ${line.classificationNote}` : ''}`,
        },
      ]),
    });
  }
  if (entry.fixedAssets.length) {
    sections.push({
      title: localized(locale, 'Linked assets', 'الأصول المرتبطة'),
      fields: entry.fixedAssets.map((asset) => ({ label: asset.name, value: formatMoney(asset.totalCost, 'IQD', locale) })),
    });
  }
  return {
    title: titleForKind('FINANCE_VOUCHER', locale),
    subtitle: clean(entry.recordKey || entry.importKey || entry.id),
    summary: `${clean(entry.description)} · ${formatMoney(entry.amount, 'IQD', locale)}`,
    sections,
  };
}

async function orderChangeSnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const order = await prisma.order.findUnique({
    where: { id: recordId },
    include: {
      customer: { select: { externalId: true, nameEn: true, nameAr: true, phone: true, address1: true, street: true } },
      lines: { include: { product: { select: { sku: true, nameEn: true, nameAr: true } } } },
    },
  });
  if (!order) return null;
  const total = Math.max(0, order.grossAmount - order.discountAmount - order.refundAmount + order.deliveryFee + order.extraCharges);
  return {
    title: localized(locale, 'Order change confirmation', 'تأكيد تغيير الطلب'),
    subtitle: order.orderNumber,
    summary: `${order.orderNumber} · ${order.status}`,
    sections: [
      {
        title: localized(locale, 'Order', 'الطلب'),
        fields: [
          { label: localized(locale, 'Status', 'الحالة'), value: order.status },
          { label: localized(locale, 'Date', 'التاريخ'), value: dateLabel(order.placedAt, locale) },
          { label: localized(locale, 'Total', 'الإجمالي'), value: formatMoney(total, 'IQD', locale) },
          { label: localized(locale, 'Customer', 'العميل'), value: clean(locale === 'ar' ? order.customer?.nameAr || order.customer?.nameEn : order.customer?.nameEn || order.customer?.nameAr) },
          { label: localized(locale, 'Phone', 'الهاتف'), value: clean(order.customer?.phone) },
          { label: localized(locale, 'Address', 'العنوان'), value: clean([order.customer?.address1, order.customer?.street].filter(Boolean).join(' · ')) },
        ],
      },
      {
        title: localized(locale, 'Items', 'المواد'),
        fields: order.lines.map((line) => ({
          label: locale === 'ar' ? line.product.nameAr || line.product.nameEn : line.product.nameEn || line.product.nameAr,
          value: `${line.quantity} × ${formatMoney(line.unitGrossPrice, 'IQD', locale)} · ${line.product.sku}`,
        })),
      },
    ],
  };
}

async function inventorySnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: recordId },
    include: { movements: { orderBy: { occurredAt: 'desc' }, take: 10 } },
  });
  if (!item) return null;
  const quantity = item.movements.reduce((sum, movement) => sum + Number(movement.quantity), 0);
  const movementFields = item.movements.map((movement) => ({
    label: `${dateLabel(movement.occurredAt, locale)} · ${movement.reason}`,
    value: `${formatNumber(Number(movement.quantity), locale, 3)} ${item.unit}${movement.reference ? ` · ${movement.reference}` : ''}`,
  }));
  return {
    title: localized(locale, 'Inventory movement', 'حركة المخزون'),
    subtitle: clean(item.externalKey || item.id),
    summary: locale === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr,
    sections: [
      {
        title: localized(locale, 'Inventory details', 'تفاصيل المخزون'),
        fields: [
          { label: localized(locale, 'Item', 'المادة'), value: locale === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr },
          { label: localized(locale, 'Category', 'الفئة'), value: item.category },
          { label: localized(locale, 'Quantity', 'الكمية'), value: `${formatNumber(quantity, locale, 3)} ${item.unit}` },
          { label: localized(locale, 'Unit cost', 'تكلفة الوحدة'), value: item.unitCost ? formatMoney(Number(item.unitCost), 'IQD', locale) : '-' },
        ],
      },
      ...(movementFields.length ? [{ title: localized(locale, 'Recent movements', 'أحدث الحركات'), fields: movementFields }] : []),
    ],
  };
}

async function roastBatchSnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const batch = await prisma.roastBatch.findUnique({
    where: { id: recordId },
    include: {
      operator: { select: { name: true } },
      branch: { select: { nameEn: true, nameAr: true } },
      greenInventoryItem: { select: { nameEn: true, nameAr: true, unit: true } },
      roastedInventoryItem: { select: { nameEn: true, nameAr: true, unit: true } },
      stockMovements: { orderBy: { occurredAt: 'asc' } },
    },
  });
  if (!batch) return null;
  const inventoryName = (item: { nameEn: string; nameAr: string } | null) => item
    ? locale === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr
    : '-';
  return {
    title: localized(locale, 'Production movement', 'حركة إنتاج'),
    subtitle: batch.batchNumber,
    summary: `${batch.origin} · ${clean(batch.roastLevel)}`,
    sections: [
      {
        title: localized(locale, 'Batch details', 'تفاصيل الدفعة'),
        fields: [
          { label: localized(locale, 'Batch number', 'رقم الدفعة'), value: batch.batchNumber },
          { label: localized(locale, 'Origin', 'المنشأ'), value: batch.origin },
          { label: localized(locale, 'Roast date', 'تاريخ التحميص'), value: dateLabel(batch.roastDate, locale) },
          { label: localized(locale, 'Roast level', 'درجة التحميص'), value: clean(batch.roastLevel) },
          { label: localized(locale, 'Green input', 'مدخل البن الأخضر'), value: `${formatNumber(batch.greenInputGrams, locale)} g` },
          { label: localized(locale, 'Roasted output', 'الناتج المحمص'), value: batch.roastedOutputGrams ? `${formatNumber(batch.roastedOutputGrams, locale)} g` : '-' },
          { label: localized(locale, 'Green inventory', 'مخزون البن الأخضر'), value: inventoryName(batch.greenInventoryItem) },
          { label: localized(locale, 'Roasted inventory', 'مخزون البن المحمص'), value: inventoryName(batch.roastedInventoryItem) },
          { label: localized(locale, 'Operator', 'المشغل'), value: clean(batch.operator?.name) },
          { label: localized(locale, 'Branch', 'الفرع'), value: batch.branch ? locale === 'ar' ? batch.branch.nameAr : batch.branch.nameEn : '-' },
          { label: localized(locale, 'QC score', 'درجة الجودة'), value: clean(batch.qcScore) },
          { label: localized(locale, 'QC notes', 'ملاحظات الجودة'), value: clean(batch.qcNotes) },
        ],
      },
      ...(batch.stockMovements.length ? [{
        title: localized(locale, 'Stock movements', 'حركات المخزون'),
        fields: batch.stockMovements.map((movement) => ({
          label: movement.reason,
          value: `${formatNumber(Number(movement.quantity), locale, 3)} · ${clean(movement.reference)}`,
        })),
      }] : []),
    ],
  };
}

async function dashboardSnapshot(recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  const dashboard = await prisma.dashboard.findUnique({
    where: { id: recordId },
    include: { owner: { select: { name: true } } },
  });
  if (!dashboard || dashboard.deletedAt) return null;
  const config = (dashboard.draftConfig ?? dashboard.config) as { widgets?: Array<{ title?: string; type?: string }> };
  const widgets = Array.isArray(config.widgets) ? config.widgets : [];
  return {
    title: localized(locale, 'Dashboard draft', 'مسودة لوحة'),
    subtitle: dashboard.name,
    summary: clean(dashboard.description || dashboard.name),
    sections: [
      {
        title: localized(locale, 'Draft details', 'تفاصيل المسودة'),
        fields: [
          { label: localized(locale, 'Name', 'الاسم'), value: dashboard.name },
          { label: localized(locale, 'Owner', 'المالك'), value: dashboard.owner.name },
          { label: localized(locale, 'Visibility', 'الظهور'), value: dashboard.visibility },
          { label: localized(locale, 'Widgets', 'العناصر'), value: formatNumber(widgets.length, locale) },
          { label: localized(locale, 'Updated', 'آخر تحديث'), value: dateLabel(dashboard.updatedAt, locale) },
        ],
      },
      ...(widgets.length ? [{
        title: localized(locale, 'Widgets', 'العناصر'),
        fields: widgets.map((widget, index) => ({
          label: `${index + 1}. ${clean(widget.title)}`,
          value: clean(widget.type),
        })),
      }] : []),
    ],
  };
}

async function loadDocumentSnapshot(recordType: string, recordId: string, locale: AppLocale): Promise<DocumentSnapshot | null> {
  if (recordType === 'Customer') return customerSnapshot(recordId, locale);
  if (recordType === 'Party') return partySnapshot(recordId, locale);
  if (recordType === 'FinanceEntry') return financeSnapshot(recordId, locale);
  if (recordType === 'Order') return orderChangeSnapshot(recordId, locale);
  if (recordType === 'InventoryItem') return inventorySnapshot(recordId, locale);
  if (recordType === 'RoastBatch') return roastBatchSnapshot(recordId, locale);
  if (recordType === 'Dashboard') return dashboardSnapshot(recordId, locale);
  return null;
}

async function renderGenericDocument(input: {
  recordType: string;
  recordId: string;
  kind: AiDocumentKind;
  locale: AppLocale;
  reference: string;
  generatedAt: Date;
}) {
  const snapshot = await loadDocumentSnapshot(input.recordType, input.recordId, input.locale);
  if (!snapshot) throw new Error('document_record_not_found');
  if (input.kind !== 'FINANCE_VOUCHER' && input.kind !== 'CHANGE_CONFIRMATION') {
    snapshot.title = titleForKind(input.kind, input.locale);
  }
  const element = createElement(GenericAiDocument, {
    snapshot,
    locale: input.locale,
    reference: input.reference,
    generatedAt: input.generatedAt,
  }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);
  return {
    bytes: Uint8Array.from(buffer),
    filename: `laheeb-${input.kind.toLowerCase().replaceAll('_', '-')}-${safeFilenamePart(input.reference)}.pdf`,
  };
}

export function aiDocumentHref(documentId: string): string {
  return `/api/ai-assistant/documents/${documentId}`;
}

export function documentKindForAction(actionType: string): AiDocumentKind {
  if (actionType === 'CREATE_ORDER') return 'INVOICE';
  if (actionType === 'RECORD_PAYMENT') return 'PAYMENT_RECEIPT';
  if (actionType === 'RECORD_REFUND') return 'REFUND_RECEIPT';
  if (actionType === 'CREATE_EXPENSE' || actionType === 'CREATE_PURCHASE' || actionType === 'RECLASSIFY_SPEND') return 'FINANCE_VOUCHER';
  if (actionType === 'ADJUST_INVENTORY') return 'INVENTORY_MOVEMENT';
  if (actionType === 'CREATE_ROAST_BATCH') return 'PRODUCTION_MOVEMENT';
  if (actionType === 'UPDATE_ORDER_STATUS' || actionType === 'REVERSE_RECORD') return 'CHANGE_CONFIRMATION';
  if (actionType === 'CREATE_DASHBOARD_DRAFT') return 'REPORT';
  return 'RECORD_SUMMARY';
}

export async function generateAiDocument(documentId: string) {
  const existing = await prisma.aiDocument.findUnique({ where: { id: documentId } });
  if (!existing) throw new Error('document_not_found');
  if (existing.status === 'READY' && existing.content && existing.fileName) return existing;

  const claimed = await prisma.aiDocument.updateMany({
    where: { id: documentId, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'GENERATING', attempts: { increment: 1 }, errorCode: null },
  });
  if (claimed.count !== 1) {
    const current = await prisma.aiDocument.findUnique({ where: { id: documentId } });
    if (current?.status === 'READY' && current.content && current.fileName) return current;
    throw new Error('document_in_progress');
  }

  try {
    const document = await prisma.aiDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { receipt: { select: { executionKey: true, actionType: true } } },
    });
    const locale = document.locale === 'ar' ? 'ar' : 'en';
    const rendered = document.kind === 'INVOICE' && document.recordType === 'Order'
      ? await renderInvoicePdf(document.recordId, locale)
      : await renderGenericDocument({
          recordType: document.recordType,
          recordId: document.recordId,
          kind: document.kind,
          locale,
          reference: document.receipt.executionKey,
          generatedAt: new Date(),
        });
    if (!rendered) throw new Error('document_record_not_found');
    const content = Buffer.from(rendered.bytes);
    const checksum = createHash('sha256').update(content).digest('hex');
    const ready = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiDocument.update({
        where: { id: documentId },
        data: {
          status: 'READY',
          fileName: rendered.filename,
          byteSize: content.byteLength,
          checksum,
          content,
          generatedAt: new Date(),
          errorCode: null,
        },
      });
      await tx.aiExecutionReceipt.update({
        where: { id: document.receiptId },
        data: { status: 'COMPLETED', completedAt: new Date(), errorCode: null },
      });
      return updated;
    });
    return ready;
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'document_generation_failed';
    await prisma.$transaction(async (tx) => {
      const document = await tx.aiDocument.update({
        where: { id: documentId },
        data: { status: 'FAILED', errorCode },
        select: { receiptId: true },
      });
      await tx.aiExecutionReceipt.update({
        where: { id: document.receiptId },
        data: { status: 'DOCUMENT_PENDING', errorCode },
      });
    });
    throw error;
  }
}

export async function deliverAiDocument(documentId: string): Promise<void> {
  const document = await generateAiDocument(documentId);
  const deliveries = await prisma.aiDeliveryOutbox.findMany({
    where: { documentId, status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: new Date() } },
    include: { receipt: { select: { userId: true, recordType: true, recordId: true, result: true } } },
  });
  for (const delivery of deliveries) {
    const claimed = await prisma.aiDeliveryOutbox.updateMany({
      where: { id: delivery.id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: new Date(), errorCode: null },
    });
    if (claimed.count !== 1) continue;
    try {
      if (delivery.channel !== 'TELEGRAM') throw new Error('delivery_channel_unsupported');
      const result = delivery.receipt.result as Record<string, unknown>;
      const sent = await sendTelegramDocument({
        chatId: delivery.destination,
        document: Uint8Array.from(document.content ?? []),
        filename: document.fileName ?? 'laheeb-document.pdf',
        caption: document.locale === 'ar'
          ? `تم حفظ السجل بنجاح. ${clean(result.message)}`
          : `The record was saved successfully. ${clean(result.message)}`,
      });
      await prisma.$transaction(async (tx) => {
        await tx.aiDeliveryOutbox.update({
          where: { id: delivery.id },
          data: { status: 'DELIVERED', deliveredAt: new Date(), externalMessageId: String(sent.message_id), errorCode: null },
        });
        await tx.auditLog.create({
          data: {
            userId: delivery.receipt.userId,
            action: 'AI_PDF_DELIVERED',
            entity: delivery.receipt.recordType,
            entityId: delivery.receipt.recordId,
            metadata: { documentId, deliveryId: delivery.id, channel: delivery.channel, externalMessageId: sent.message_id },
          },
        });
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'document_delivery_failed';
      await prisma.aiDeliveryOutbox.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorCode,
          availableAt: new Date(Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(delivery.attempts, 6))),
        },
      });
      throw error;
    }
  }
}

export async function prepareAiDocument(documentId: string): Promise<'READY' | 'PENDING'> {
  try {
    await deliverAiDocument(documentId);
    const pendingDelivery = await prisma.aiDeliveryOutbox.count({
      where: { documentId, status: { not: 'DELIVERED' } },
    });
    return pendingDelivery === 0 ? 'READY' : 'PENDING';
  } catch {
    await enqueueAiDocument(documentId).catch(() => undefined);
    const current = await prisma.aiDocument.findUnique({
      where: { id: documentId },
      select: { status: true },
    });
    if (current?.status !== 'READY') return 'PENDING';
    const pendingDelivery = await prisma.aiDeliveryOutbox.count({
      where: { documentId, status: { not: 'DELIVERED' } },
    });
    return pendingDelivery === 0 ? 'READY' : 'PENDING';
  }
}

export async function processAiDocumentJob(documentId: string): Promise<void> {
  await deliverAiDocument(documentId);
}

export async function replayDueAiDocuments(limit = 20): Promise<{ processed: number }> {
  const documents = await prisma.aiDocument.findMany({
    where: {
      OR: [
        { status: { in: ['PENDING', 'FAILED'] } },
        { status: 'READY', deliveries: { some: { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: new Date() } } } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  for (const document of documents) {
    try {
      await deliverAiDocument(document.id);
      processed += 1;
    } catch {
      // The retry metadata is persisted; another queue/cron attempt will resume it.
    }
  }
  return { processed };
}

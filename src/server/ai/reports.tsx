import 'server-only';

import { createElement } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  renderToBuffer,
  StyleSheet,
} from '@react-pdf/renderer';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { AiResultCard, AiStreamEvent } from '@/lib/ai-assistant';
import type { AppLocale } from '@/lib/money';
import { prisma } from '@/server/db/client';
import {
  PDF_COLORS,
  PdfKpi,
  PdfTable,
  pdfBaseStyles,
  pdfDirection,
  registerLaheebPdfFonts,
} from '@/server/pdf/laheeb-pdf';
import { sendTelegramDocument } from '@/server/telegram/api';
import { getAiAssistantConfig } from './config';
import { enqueueAiReportDelivery } from './report-queue';
import { assertAiCapabilityEnabled, isAiCapabilityEnabled } from './capabilities';

registerLaheebPdfFonts();

export type AiReportFormat = 'pdf' | 'xlsx' | 'csv';

type ReportContext = {
  conversationId: string;
  sourceMessageId: string;
  user: { id: string };
  locale: AppLocale;
  now: Date;
};

type ReportDeliveryPayload = {
  reportId: string;
  chatId: string;
  locale: AppLocale;
  origin: string;
};

const styles = StyleSheet.create({
  answer: {
    backgroundColor: PDF_COLORS.linen,
    borderRadius: 5,
    color: PDF_COLORS.grove,
    lineHeight: 1.5,
    marginBottom: 10,
    padding: 9,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  metric: {
    width: '48.5%',
  },
  sectionTitle: {
    color: PDF_COLORS.grove,
    fontSize: 11,
    marginBottom: 5,
  },
});

function localized(locale: AppLocale, en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

function safeFilePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report';
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asReportCard(value: Prisma.JsonValue): AiResultCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ai_report_payload_invalid');
  const card = value as unknown as AiResultCard;
  if (!card.title || !card.generatedAt) throw new Error('ai_report_payload_invalid');
  return card;
}

function csvCell(value: unknown): string {
  const clean = String(value ?? '').replace(/\r\n?/g, '\n');
  const safe = /^[=+\-@\t\r]/.test(clean) ? `'${clean}` : clean;
  return `"${safe.replace(/"/g, '""')}"`;
}

function reportRows(card: AiResultCard): string[][] {
  const rows: string[][] = [];
  if (card.answer) rows.push(['Summary', card.title, card.answer, card.period ?? '', card.href ?? '']);
  for (const metric of card.metrics ?? []) {
    rows.push(['Metric', metric.label, String(metric.value), metric.hint ?? '', '']);
  }
  for (const row of card.rows ?? []) {
    rows.push(['Record', row.title, String(row.value ?? ''), row.subtitle ?? '', row.href ?? '']);
  }
  return rows;
}

function buildCsv(card: AiResultCard): Uint8Array {
  const rows = [
    ['Section', 'Label', 'Value', 'Details', 'Atlas path'],
    ...reportRows(card),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return new TextEncoder().encode(`\uFEFF${csv}`);
}

async function buildWorkbook(card: AiResultCard, locale: AppLocale): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Laheeb Operations Atlas';
  workbook.company = 'Laheeb Coffee';
  workbook.subject = card.title;
  workbook.created = new Date(card.generatedAt);

  const sheet = workbook.addWorksheet(locale === 'ar' ? 'تقرير أطلس' : 'Atlas report', {
    views: [{ rightToLeft: locale === 'ar', showGridLines: false, state: 'frozen', ySplit: 4 }],
  });
  sheet.columns = [
    { width: 16 },
    { width: 34 },
    { width: 28 },
    { width: 58 },
    { width: 46 },
  ];
  sheet.mergeCells('A1:E1');
  const title = sheet.getCell('A1');
  title.value = card.title;
  title.font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3C4220' } };
  title.alignment = { vertical: 'middle', horizontal: locale === 'ar' ? 'right' : 'left' };
  sheet.getRow(1).height = 32;
  sheet.mergeCells('A2:E2');
  sheet.getCell('A2').value = card.answer ?? '';
  sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle', horizontal: locale === 'ar' ? 'right' : 'left' };
  sheet.getRow(2).height = 34;
  sheet.mergeCells('A3:E3');
  sheet.getCell('A3').value = [card.period, card.generatedAt].filter(Boolean).join(' | ');
  sheet.getCell('A3').font = { color: { argb: 'FF766B5F' } };

  const header = sheet.addRow(['Section', 'Label', 'Value', 'Details', 'Atlas path']);
  header.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF562D1E' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  for (const row of reportRows(card)) sheet.addRow(row);
  sheet.autoFilter = { from: 'A4', to: `E${Math.max(4, sheet.lastRow?.number ?? 4)}` };
  for (let row = 5; row <= (sheet.lastRow?.number ?? 4); row += 1) {
    for (let column = 1; column <= 5; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDD6C8' } } };
      if (row % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF8F2' } };
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function AiReportPdf({ card, locale }: { card: AiResultCard; locale: AppLocale }) {
  const rtl = locale === 'ar';
  const rows = (card.rows ?? []).map((row) => [row.title, String(row.value ?? '-'), row.subtitle ?? '-']);
  return (
    <Document title={card.title} author="Laheeb Operations Atlas">
      <Page size="A4" style={[pdfBaseStyles.page, pdfDirection(locale)]}>
        <View style={pdfBaseStyles.header}>
          <Text style={[pdfBaseStyles.title, rtl ? { textAlign: 'right' } : {}]}>{card.title}</Text>
          {card.period ? <Text style={[pdfBaseStyles.subtitle, rtl ? { textAlign: 'right' } : {}]}>{card.period}</Text> : null}
        </View>
        {card.answer ? <Text style={[styles.answer, rtl ? { textAlign: 'right' } : {}]}>{card.answer}</Text> : null}
        {card.metrics?.length ? (
          <View style={styles.metricGrid}>
            {card.metrics.map((metric) => (
              <View key={`${metric.label}-${metric.value}`} style={styles.metric} wrap={false}>
                <PdfKpi label={metric.label} value={String(metric.value)} />
              </View>
            ))}
          </View>
        ) : null}
        {rows.length ? (
          <View>
            <Text style={[styles.sectionTitle, rtl ? { textAlign: 'right' } : {}]}>
              {localized(locale, 'Details', 'التفاصيل')}
            </Text>
            <PdfTable
              columns={[
                localized(locale, 'Record', 'السجل'),
                localized(locale, 'Value', 'القيمة'),
                localized(locale, 'Details', 'التفاصيل'),
              ]}
              rows={rows}
              maxRows={100}
            />
          </View>
        ) : null}
        <View style={pdfBaseStyles.footer} fixed>
          <Text>{localized(locale, 'Laheeb Operations Atlas', 'أطلس عمليات لهيب')}</Text>
          <Text>{new Date(card.generatedAt).toISOString()}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

async function buildPdf(card: AiResultCard, locale: AppLocale): Promise<Uint8Array> {
  const element = createElement(AiReportPdf, { card, locale }) as Parameters<typeof renderToBuffer>[0];
  const content = await renderToBuffer(element);
  return Uint8Array.from(content);
}

export async function renderAiReportExport(input: {
  card: AiResultCard;
  locale: AppLocale;
  reportType: string;
  format: AiReportFormat;
}): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
  const base = `laheeb-${safeFilePart(input.reportType)}-${safeFilePart(input.card.title)}`;
  if (input.format === 'csv') {
    return { bytes: buildCsv(input.card), contentType: 'text/csv; charset=utf-8', fileName: `${base}.csv` };
  }
  if (input.format === 'xlsx') {
    return {
      bytes: await buildWorkbook(input.card, input.locale),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${base}.xlsx`,
    };
  }
  return { bytes: await buildPdf(input.card, input.locale), contentType: 'application/pdf', fileName: `${base}.pdf` };
}

export async function createAiReportCard(
  card: AiResultCard,
  context: ReportContext,
  reportType: string,
): Promise<AiResultCard> {
  if (!await isAiCapabilityEnabled('MEDIA_REPORTS')) return card;
  const expiresAt = new Date(context.now.getTime() + getAiAssistantConfig().historyRetentionDays * 86_400_000);
  const snapshot = await prisma.$transaction(async (tx) => {
    const created = await tx.aiReportSnapshot.create({
      data: {
        userId: context.user.id,
        conversationId: context.conversationId,
        sourceMessageId: context.sourceMessageId,
        locale: context.locale,
        reportType,
        title: card.title,
        payload: asInputJson(card),
        expiresAt,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: context.user.id,
        action: 'AI_REPORT_CREATED',
        entity: 'AiReportSnapshot',
        entityId: created.id,
        metadata: { reportType, conversationId: context.conversationId },
      },
    });
    return created;
  });
  const base = `/api/ai-assistant/reports/${snapshot.id}`;
  return {
    ...card,
    reportId: snapshot.id,
    downloads: [
      { format: 'PDF', href: `${base}/pdf` },
      { format: 'XLSX', href: `${base}/xlsx` },
      { format: 'CSV', href: `${base}/csv` },
    ],
  };
}

export async function getAiReportExport(input: {
  reportId: string;
  userId: string;
  format: AiReportFormat;
}): Promise<{ bytes: Uint8Array; contentType: string; fileName: string; reportType: string } | null> {
  const report = await prisma.aiReportSnapshot.findFirst({
    where: { id: input.reportId, userId: input.userId, expiresAt: { gt: new Date() } },
  });
  if (!report) return null;
  const rendered = await renderAiReportExport({
    card: asReportCard(report.payload),
    locale: report.locale === 'ar' ? 'ar' : 'en',
    reportType: report.reportType,
    format: input.format,
  });
  return { ...rendered, reportType: report.reportType };
}

function reportCards(events: AiStreamEvent[]): AiResultCard[] {
  return events
    .filter((event): event is Extract<AiStreamEvent, { type: 'result_card' }> => event.type === 'result_card')
    .map((event) => event.card)
    .filter((card) => Boolean(card.reportId));
}

function reportDeliveryPayload(value: Prisma.JsonValue): ReportDeliveryPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ai_report_delivery_payload_invalid');
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.reportId !== 'string'
    || typeof payload.chatId !== 'string'
    || (payload.locale !== 'ar' && payload.locale !== 'en')
    || typeof payload.origin !== 'string'
  ) throw new Error('ai_report_delivery_payload_invalid');
  return payload as ReportDeliveryPayload;
}

export async function processAiReportNotification(notificationId: string): Promise<void> {
  await assertAiCapabilityEnabled('MEDIA_REPORTS');
  const now = new Date();
  const staleAt = new Date(now.getTime() - 10 * 60_000);
  await prisma.aiNotificationLog.updateMany({
    where: { id: notificationId, status: 'PROCESSING', lastAttemptAt: { lt: staleAt } },
    data: { status: 'FAILED', errorCode: 'delivery_interrupted', availableAt: now },
  });
  const claimed = await prisma.aiNotificationLog.updateMany({
    where: { id: notificationId, status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: now } },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: now, errorCode: null },
  });
  if (claimed.count !== 1) return;

  const notification = await prisma.aiNotificationLog.findUnique({ where: { id: notificationId } });
  if (!notification) return;
  try {
    const payload = reportDeliveryPayload(notification.payload);
    const report = await prisma.aiReportSnapshot.findFirst({
      where: { id: payload.reportId, userId: notification.userId, expiresAt: { gt: now } },
    });
    if (!report) throw new Error('ai_report_not_found');
    const card = asReportCard(report.payload);
    const rendered = await renderAiReportExport({
      card,
      locale: payload.locale,
      reportType: report.reportType,
      format: 'pdf',
    });
    const openUrl = card.href
      ? new URL(`/${payload.locale}${card.href.startsWith('/') ? card.href : `/${card.href}`}`, payload.origin).toString()
      : undefined;
    const sent = await sendTelegramDocument({
      chatId: payload.chatId,
      document: rendered.bytes,
      filename: rendered.fileName,
      caption: localized(payload.locale, `Atlas report: ${card.title}`, `تقرير أطلس: ${card.title}`),
      keyboard: openUrl ? [[{ text: localized(payload.locale, 'Open in Atlas', 'فتح في أطلس'), url: openUrl }]] : undefined,
    });
    await prisma.aiNotificationLog.update({
      where: { id: notification.id },
      data: { status: 'SENT', externalMessageId: String(sent.message_id), sentAt: new Date(), errorCode: null },
    });
  } catch (error) {
    const current = await prisma.aiNotificationLog.findUnique({ where: { id: notification.id }, select: { attempts: true } });
    const attempts = current?.attempts ?? 1;
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'ai_report_delivery_failed';
    await prisma.aiNotificationLog.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        errorCode,
        availableAt: new Date(Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts, 6))),
      },
    });
    throw error;
  }
}

export async function deliverAiReportsToTelegram(input: {
  events: AiStreamEvent[];
  userId: string;
  chatId: string;
  locale: AppLocale;
  origin: string;
}): Promise<void> {
  for (const card of reportCards(input.events)) {
    const idempotencyKey = `ai-report:${card.reportId}:telegram:${input.chatId}`;
    const notification = await prisma.aiNotificationLog.upsert({
      where: { idempotencyKey },
      create: {
        userId: input.userId,
        kind: 'AI_REPORT',
        channel: 'TELEGRAM',
        payload: asInputJson({ reportId: card.reportId, chatId: input.chatId, locale: input.locale, origin: input.origin }),
        idempotencyKey,
      },
      update: {},
      select: { id: true, status: true },
    });
    if (notification.status === 'SENT') continue;
    try {
      await processAiReportNotification(notification.id);
    } catch {
      await enqueueAiReportDelivery(notification.id).catch(() => undefined);
    }
  }
}

export async function replayDueAiReports(limit = 20): Promise<{ processed: number }> {
  const staleAt = new Date(Date.now() - 10 * 60_000);
  const notifications = await prisma.aiNotificationLog.findMany({
    where: {
      kind: 'AI_REPORT',
      OR: [
        { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: new Date() } },
        { status: 'PROCESSING', lastAttemptAt: { lt: staleAt } },
      ],
    },
    orderBy: { availableAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  for (const notification of notifications) {
    try {
      await processAiReportNotification(notification.id);
      processed += 1;
    } catch {
      // The persisted backoff controls the next queue or cron retry.
    }
  }
  return { processed };
}

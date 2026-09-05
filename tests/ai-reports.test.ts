import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiResultCard, AiStreamEvent } from '@/lib/ai-assistant';

const deliveryState = vi.hoisted(() => ({
  status: 'PENDING' as 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED',
  attempts: 0,
}));
const sendTelegramDocument = vi.hoisted(() => vi.fn(async () => ({ message_id: 91 })));

const reportCard: AiResultCard = {
  title: 'Buyer report تقرير المشترين',
  answer: 'Two customers purchased this item.',
  period: '1 Sep 2026 - 5 Sep 2026',
  generatedAt: '2026-09-05T12:00:00.000Z',
  metrics: [{ label: 'Customers', value: 2 }],
  rows: [{
    id: 'customer-1',
    title: '=HYPERLINK("https://invalid.example","Unsafe")',
    subtitle: '+9647700000000',
    value: 'IQD 27,000',
    href: '/admin/records/customers/customer-1',
  }],
  href: '/customers/product-buyers',
};

vi.mock('@/server/db/client', () => ({
  prisma: {
    aiReportSnapshot: {
      findFirst: vi.fn(async () => ({
        id: 'report-1',
        userId: 'user-1',
        locale: 'ar',
        reportType: 'product-buyers',
        payload: reportCard,
        expiresAt: new Date('2026-10-05T12:00:00.000Z'),
      })),
    },
    aiNotificationLog: {
      upsert: vi.fn(async () => ({ id: 'notification-1', status: deliveryState.status })),
      updateMany: vi.fn(async (input: { data?: { status?: typeof deliveryState.status; attempts?: { increment: number } } }) => {
        if (!['PENDING', 'FAILED'].includes(deliveryState.status)) return { count: 0 };
        deliveryState.status = input.data?.status ?? 'PROCESSING';
        deliveryState.attempts += input.data?.attempts?.increment ?? 0;
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => ({
        id: 'notification-1',
        userId: 'user-1',
        attempts: deliveryState.attempts,
        payload: {
          reportId: 'report-1',
          chatId: '7739683566',
          locale: 'ar',
          origin: 'https://dashboard.example',
        },
      })),
      update: vi.fn(async (input: { data?: { status?: typeof deliveryState.status } }) => {
        if (input.data?.status) deliveryState.status = input.data.status;
        return { id: 'notification-1' };
      }),
    },
  },
}));

vi.mock('@/server/telegram/api', () => ({ sendTelegramDocument }));
vi.mock('@/server/ai/report-queue', () => ({ enqueueAiReportDelivery: vi.fn(async () => undefined) }));

import { deliverAiReportsToTelegram, renderAiReportExport } from '@/server/ai/reports';

afterEach(() => {
  deliveryState.status = 'PENDING';
  deliveryState.attempts = 0;
  sendTelegramDocument.mockClear();
});

describe('AI report exports and Telegram delivery', () => {
  it('renders bilingual PDF, Excel, and formula-safe UTF-8 CSV exports', async () => {
    const [pdf, xlsx, csv] = await Promise.all([
      renderAiReportExport({ card: reportCard, locale: 'ar', reportType: 'product-buyers', format: 'pdf' }),
      renderAiReportExport({ card: reportCard, locale: 'ar', reportType: 'product-buyers', format: 'xlsx' }),
      renderAiReportExport({ card: reportCard, locale: 'ar', reportType: 'product-buyers', format: 'csv' }),
    ]);

    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(Array.from(xlsx.bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const csvText = new TextDecoder().decode(csv.bytes);
    expect(csvText.startsWith('\uFEFF')).toBe(true);
    expect(csvText).toContain("'=HYPERLINK");
    expect(csvText).toContain('تقرير المشترين');
    expect(pdf.fileName).toMatch(/\.pdf$/);
    expect(xlsx.contentType).toContain('spreadsheetml');
  });

  it('sends one persisted report document for duplicate Telegram delivery attempts', async () => {
    const events: AiStreamEvent[] = [{
      type: 'result_card',
      card: {
        ...reportCard,
        reportId: 'report-1',
        downloads: [{ format: 'PDF', href: '/api/ai-assistant/reports/report-1/pdf' }],
      },
    }];
    const input = {
      events,
      userId: 'user-1',
      chatId: '7739683566',
      locale: 'ar' as const,
      origin: 'https://dashboard.example',
    };

    await deliverAiReportsToTelegram(input);
    await deliverAiReportsToTelegram(input);

    expect(sendTelegramDocument).toHaveBeenCalledOnce();
    expect(sendTelegramDocument).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '7739683566',
      filename: expect.stringMatching(/\.pdf$/),
      document: expect.any(Uint8Array),
    }));
    expect(deliveryState.status).toBe('SENT');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiStreamEvent } from '@/lib/ai-assistant';
import { assistantToolsForRole, canExecuteAssistantAction } from '@/server/ai/access';
import { parseTelegramUserIds, telegramSecretMatches } from '@/server/telegram/config';
import {
  parseTelegramCallback,
  renderAssistantEvents,
  splitTelegramText,
} from '@/server/telegram/render';
import { supportedTelegramUpdate, telegramLocale, TelegramUpdateSchema } from '@/server/telegram/schemas';
import type { CurrentUser } from '@/server/auth/session';
import {
  createTrustedCommandContext,
  getTrustedCommandActor,
  type TrustedCommandContext,
} from '@/server/commands/actor-context';
import { can } from '@/lib/rbac';
import { shouldRetryTelegramProcessing } from '@/lib/telegram-errors';
import { downloadTelegramFile, sendTelegramDocument } from '@/server/telegram/api';

const adminUser: CurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN',
  branchId: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Telegram Atlas AI transport contracts', () => {
  it('parses only numeric bootstrap IDs and compares webhook secrets exactly', () => {
    expect([...parseTelegramUserIds('123, 456;abc\n789')]).toEqual(['123', '456', '789']);
    expect(telegramSecretMatches('same-secret', 'same-secret')).toBe(true);
    expect(telegramSecretMatches('same-secret-x', 'same-secret')).toBe(false);
    expect(telegramSecretMatches(null, 'same-secret')).toBe(false);
  });

  it('accepts private messages and marks groups as non-private', () => {
    const privateUpdate = TelegramUpdateSchema.parse({
      update_id: 11,
      message: {
        message_id: 3,
        from: { id: 123, first_name: 'Muhannad' },
        chat: { id: 123, type: 'private' },
        text: 'حلل المبيعات',
      },
    });
    const groupUpdate = TelegramUpdateSchema.parse({
      update_id: 12,
      message: {
        message_id: 4,
        from: { id: 123, first_name: 'Muhannad' },
        chat: { id: -1001, type: 'group' },
        text: 'sales',
      },
    });
    expect(supportedTelegramUpdate(privateUpdate)).toMatchObject({ privateChat: true, chatId: '123', type: 'message' });
    expect(supportedTelegramUpdate(groupUpdate)).toMatchObject({ privateChat: false, chatId: '-1001' });
    expect(telegramLocale('en', 'حلل المبيعات')).toBe('ar');
    expect(telegramLocale('en', 'Show sales')).toBe('en');
  });

  it('extracts the largest private photo and document captions without trusting media metadata', () => {
    const update = TelegramUpdateSchema.parse({
      update_id: 13,
      message: {
        message_id: 5,
        from: { id: 123, first_name: 'Muhannad' },
        chat: { id: 123, type: 'private' },
        caption: 'سجل هذا الوصل',
        photo: [
          { file_id: 'small', width: 90, height: 90, file_size: 100 },
          { file_id: 'large', width: 1280, height: 1280, file_size: 2_000 },
        ],
      },
    });
    expect(supportedTelegramUpdate(update)).toMatchObject({
      text: 'سجل هذا الوصل',
      media: {
        type: 'photo',
        fileId: 'large',
        mimeType: 'image/jpeg',
        fileSize: 2_000,
      },
    });
  });

  it('validates compact callback payloads', () => {
    expect(parseTelegramCallback('q:sales')).toEqual({ type: 'quick', key: 'sales' });
    expect(parseTelegramCallback('c:cm123:2')).toEqual({ type: 'choice', messageId: 'cm123', index: 2 });
    expect(parseTelegramCallback('a:action123:c')).toEqual({ type: 'action', actionId: 'action123', command: 'confirm' });
    expect(parseTelegramCallback('a:action123:h')).toEqual({ type: 'action', actionId: 'action123', command: 'high-confirm' });
    expect(parseTelegramCallback('a:action123:x')).toEqual({ type: 'action', actionId: 'action123', command: 'cancel' });
    expect(parseTelegramCallback('bad')).toBeNull();
  });

  it('keeps Telegram text within the API limit without dropping content', () => {
    const source = Array.from({ length: 900 }, (_, index) => `line-${index}`).join(' ');
    const chunks = splitTelegramText(source, 500);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
    expect(chunks.join(' ')).toBe(source);
  });

  it('renders action confirmation and direct Atlas links', () => {
    const events: AiStreamEvent[] = [
      {
        type: 'action_preview',
        action: {
          id: 'action123',
          type: 'CREATE_ORDER',
          risk: 'MEDIUM',
          title: 'Create order',
          summary: 'Order for Saba',
          fields: [{ label: 'Total', value: 'IQD 27,000' }],
          warnings: [],
          expiresAt: '2026-08-23T14:00:00.000Z',
          status: 'PENDING',
        },
      },
      {
        type: 'action_result',
        actionId: 'action123',
        status: 'EXECUTED',
        message: 'Order created.',
        href: '/admin/records/orders/order123',
        invoiceHref: '/invoice/order123',
      },
    ];
    const rendered = renderAssistantEvents(events, { locale: 'en', origin: 'https://preview.example' });
    expect(rendered.chunks.join('\n')).toContain('IQD 27,000');
    expect(rendered.keyboard?.flat()).toContainEqual(expect.objectContaining({ callback_data: 'a:action123:c' }));
    expect(rendered.keyboard?.flat()).toContainEqual(expect.objectContaining({ url: 'https://preview.example/en/invoice/order123' }));
  });

  it('renders report exports as exact API links without a locale prefix', () => {
    const rendered = renderAssistantEvents([{
      type: 'result_card',
      card: {
        title: 'Customer report',
        generatedAt: '2026-09-05T12:00:00.000Z',
        reportId: 'report-1',
        downloads: [
          { format: 'PDF', href: '/api/ai-assistant/reports/report-1/pdf' },
          { format: 'XLSX', href: '/api/ai-assistant/reports/report-1/xlsx' },
        ],
      },
    }], { locale: 'en', origin: 'https://preview.example' });
    expect(rendered.keyboard?.flat()).toContainEqual({
      text: 'Download PDF',
      url: 'https://preview.example/api/ai-assistant/reports/report-1/pdf',
    });
  });

  it('filters tools and writes by the linked Atlas role', () => {
    const salesTools = assistantToolsForRole('SALES_CRM').map((tool) => tool.name);
    expect(salesTools).toContain('prepare_create_order');
    expect(salesTools).toContain('product_buyers');
    expect(salesTools).toContain('customer_insights');
    expect(salesTools).not.toContain('prepare_create_expense');
    expect(salesTools).not.toContain('finance_overview');
    expect(canExecuteAssistantAction('SALES_CRM', 'CREATE_ORDER')).toBe(true);
    expect(canExecuteAssistantAction('SALES_CRM', 'CREATE_EXPENSE')).toBe(false);
    expect(canExecuteAssistantAction('VIEWER', 'CREATE_ORDER')).toBe(false);
  });

  it('authorizes queue commands through a server-only trusted actor context', () => {
    const context = createTrustedCommandContext(adminUser);
    expect(getTrustedCommandActor(context)).toEqual(adminUser);
    expect(can(getTrustedCommandActor(context)?.role ?? 'VIEWER', 'manage:orders')).toBe(true);
  });

  it('does not accept a forged serialized actor context', () => {
    const forged = { actor: adminUser } as TrustedCommandContext;
    expect(getTrustedCommandActor(forged)).toBeNull();
  });

  it('does not retry terminal action or stale callback failures', () => {
    expect(shouldRetryTelegramProcessing(new Error('action_failed:debug-id'))).toBe(false);
    expect(shouldRetryTelegramProcessing(Object.assign(new Error('telegram_api_400'), { retryable: false }))).toBe(false);
    expect(shouldRetryTelegramProcessing(Object.assign(new Error('telegram_api_500'), { retryable: true }))).toBe(true);
    expect(shouldRetryTelegramProcessing(new Error('temporary_network_failure'))).toBe(true);
  });

  it('uploads invoice PDFs to Telegram as multipart documents', async () => {
    vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-secret');
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 42 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await sendTelegramDocument({
      chatId: '7739683566',
      document: new TextEncoder().encode('%PDF-1.7'),
      filename: 'laheeb-invoice-LHB-ORD-260823-WA-0001.pdf',
      caption: 'Order recorded successfully.',
    });

    expect(result.message_id).toBe(42);
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendDocument');
    expect(init?.method).toBe('POST');
    const payload = init?.body as FormData;
    expect(payload.get('chat_id')).toBe('7739683566');
    expect(payload.get('caption')).toBe('Order recorded successfully.');
    const document = payload.get('document') as File;
    expect(document.name).toBe('laheeb-invoice-LHB-ORD-260823-WA-0001.pdf');
    expect(document.type).toBe('application/pdf');
    expect(await document.text()).toBe('%PDF-1.7');
  });

  it('downloads Telegram media with a size bound and never includes auth headers', async () => {
    vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-secret');
    const request = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { file_id: 'file-1', file_unique_id: 'unique-1', file_size: 9, file_path: 'voice/file_1.ogg' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('OggSvoice'), {
        status: 200,
        headers: { 'content-length': '9' },
      }));

    const result = await downloadTelegramFile('file-1', 20);
    expect(new TextDecoder().decode(result.bytes)).toBe('OggSvoice');
    expect(request.mock.calls[0][0]).toBe('https://api.telegram.org/bottest-token/getFile');
    expect(request.mock.calls[1][0]).toBe('https://api.telegram.org/file/bottest-token/voice/file_1.ogg');
    expect((request.mock.calls[1][1]?.headers as Record<string, string> | undefined)?.authorization).toBeUndefined();
  });

  it('rejects Telegram media from getFile metadata before downloading it', async () => {
    vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-secret');
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: { file_id: 'file-2', file_unique_id: 'unique-2', file_size: 21, file_path: 'docs/file_2.pdf' },
    }), { status: 200 }));

    await expect(downloadTelegramFile('file-2', 20)).rejects.toThrow('attachment_too_large');
    expect(request).toHaveBeenCalledOnce();
  });
});

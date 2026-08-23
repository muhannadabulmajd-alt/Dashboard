import { describe, expect, it } from 'vitest';
import type { AiStreamEvent } from '@/lib/ai-assistant';
import { assistantToolsForRole, canExecuteAssistantAction } from '@/server/ai/access';
import { parseTelegramUserIds, telegramSecretMatches } from '@/server/telegram/config';
import {
  parseTelegramCallback,
  renderAssistantEvents,
  splitTelegramText,
} from '@/server/telegram/render';
import { supportedTelegramUpdate, telegramLocale, TelegramUpdateSchema } from '@/server/telegram/schemas';

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

  it('validates compact callback payloads', () => {
    expect(parseTelegramCallback('q:sales')).toEqual({ type: 'quick', key: 'sales' });
    expect(parseTelegramCallback('c:cm123:2')).toEqual({ type: 'choice', messageId: 'cm123', index: 2 });
    expect(parseTelegramCallback('a:action123:c')).toEqual({ type: 'action', actionId: 'action123', command: 'confirm' });
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

  it('filters tools and writes by the linked Atlas role', () => {
    const salesTools = assistantToolsForRole('SALES_CRM').map((tool) => tool.name);
    expect(salesTools).toContain('prepare_create_order');
    expect(salesTools).not.toContain('prepare_create_expense');
    expect(canExecuteAssistantAction('SALES_CRM', 'CREATE_ORDER')).toBe(true);
    expect(canExecuteAssistantAction('SALES_CRM', 'CREATE_EXPENSE')).toBe(false);
    expect(canExecuteAssistantAction('VIEWER', 'CREATE_ORDER')).toBe(false);
  });
});

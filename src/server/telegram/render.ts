import type { AiStreamEvent } from '@/lib/ai-assistant';
import type { InlineKeyboard } from './api';

const TELEGRAM_TEXT_LIMIT = 3_900;

export type TelegramRenderedReply = {
  chunks: string[];
  keyboard?: InlineKeyboard;
};

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function atlasUrl(origin: string, locale: 'ar' | 'en', href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  const path = href.startsWith('/') ? href : `/${href}`;
  if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return `${origin}${path}`;
  return `${origin}/${locale}${path}`;
}

export function splitTelegramText(value: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  const text = value.trim();
  if (!text) return [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const newline = window.lastIndexOf('\n');
    const space = window.lastIndexOf(' ');
    const splitAt = Math.max(newline, space, Math.floor(limit * 0.7));
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function quickActionKeyboard(locale: 'ar' | 'en'): InlineKeyboard {
  return [
    [
      { text: locale === 'ar' ? 'المبيعات' : 'Sales', callback_data: 'q:sales' },
      { text: locale === 'ar' ? 'بحث عن طلب' : 'Find order', callback_data: 'q:order' },
    ],
    [
      { text: locale === 'ar' ? 'المخزون' : 'Inventory', callback_data: 'q:inventory' },
      { text: locale === 'ar' ? 'المصروفات' : 'Spending', callback_data: 'q:expenses' },
    ],
    [
      { text: locale === 'ar' ? 'إنشاء طلب' : 'Create order', callback_data: 'q:createOrder' },
      { text: locale === 'ar' ? 'تسجيل مصروف' : 'Record expense', callback_data: 'q:expense' },
    ],
  ];
}

export const TELEGRAM_QUICK_PROMPTS: Record<string, { ar: string; en: string }> = {
  sales: { ar: 'حلل المبيعات لهذا الشهر.', en: 'Analyze sales for this month.' },
  order: { ar: 'ساعدني في البحث عن طلب.', en: 'Help me find an order.' },
  inventory: { ar: 'اعرض المخزون الحالي والمواد منخفضة المخزون.', en: 'Show current inventory and low-stock items.' },
  expenses: { ar: 'راجع إنفاق العمل لهذا الشهر.', en: 'Review business spending for this month.' },
  createOrder: { ar: 'ساعدني في إنشاء طلب جديد.', en: 'Help me create a new order.' },
  expense: { ar: 'ساعدني في تسجيل مصروف.', en: 'Help me record an expense.' },
};

export type TelegramCallbackAction =
  | { type: 'quick'; key: string }
  | { type: 'choice'; messageId: string; index: number }
  | { type: 'action'; actionId: string; command: 'confirm' | 'high-confirm' | 'cancel' };

export function parseTelegramCallback(value: string | undefined): TelegramCallbackAction | null {
  if (!value) return null;
  const [prefix, id, tail] = value.split(':');
  if (prefix === 'q' && id && !tail) return { type: 'quick', key: id };
  if (prefix === 'c' && id && /^\d+$/.test(tail ?? '')) {
    return { type: 'choice', messageId: id, index: Number(tail) };
  }
  if (prefix === 'a' && id && (tail === 'c' || tail === 'h' || tail === 'x')) {
    return {
      type: 'action',
      actionId: id,
      command: tail === 'c' ? 'confirm' : tail === 'h' ? 'high-confirm' : 'cancel',
    };
  }
  return null;
}

export function renderAssistantEvents(
  events: AiStreamEvent[],
  input: { locale: 'ar' | 'en'; origin: string; messageId?: string },
): TelegramRenderedReply {
  const sections: string[] = [];
  const keyboard: InlineKeyboard = [];
  const text = events
    .filter((event): event is Extract<AiStreamEvent, { type: 'text_delta' }> => event.type === 'text_delta')
    .map((event) => event.delta)
    .join('')
    .trim();
  if (text) sections.push(text);

  for (const event of events) {
    if (event.type === 'result_card') {
      const card = event.card;
      const lines = [card.title, card.answer, card.period ? `${input.locale === 'ar' ? 'الفترة' : 'Period'}: ${card.period}` : '']
        .filter(Boolean)
        .map(clean);
      for (const metric of card.metrics ?? []) lines.push(`${clean(metric.label)}: ${clean(metric.value)}`);
      for (const row of (card.rows ?? []).slice(0, 10)) {
        lines.push(`- ${clean(row.title)}${row.value !== undefined ? `: ${clean(row.value)}` : ''}${row.subtitle ? ` (${clean(row.subtitle)})` : ''}`);
        if (row.href && keyboard.length < 8) {
          keyboard.push([{ text: clean(row.title).slice(0, 50), url: atlasUrl(input.origin, input.locale, row.href) }]);
        }
      }
      if (card.href) {
        keyboard.push([{ text: input.locale === 'ar' ? 'فتح التفاصيل' : 'Open details', url: atlasUrl(input.origin, input.locale, card.href) }]);
      }
      sections.push(lines.join('\n'));
    }

    if (event.type === 'clarification') {
      sections.push(event.clarification.message);
      if (input.messageId) {
        for (const [index, choice] of (event.clarification.choices ?? []).slice(0, 10).entries()) {
          keyboard.push([{ text: clean(choice.label).slice(0, 55), callback_data: `c:${input.messageId}:${index}` }]);
        }
      }
    }

    if (event.type === 'action_preview') {
      const action = event.action;
      const lines = [
        action.title,
        action.summary,
        ...action.fields.map((field) => `${clean(field.label)}: ${clean(field.value)}`),
        ...action.warnings.map((warning) => `${input.locale === 'ar' ? 'تنبيه' : 'Warning'}: ${clean(warning)}`),
        input.locale === 'ar' ? 'راجع التفاصيل ثم أكد أو ألغِ.' : 'Review the details, then confirm or cancel.',
      ];
      sections.push(lines.filter(Boolean).join('\n'));
      keyboard.push([
        { text: input.locale === 'ar' ? 'تأكيد' : 'Confirm', callback_data: `a:${action.id}:c` },
        { text: input.locale === 'ar' ? 'إلغاء' : 'Cancel', callback_data: `a:${action.id}:x` },
      ]);
    }

    if (event.type === 'action_result') {
      sections.push(event.message);
      if (event.requiresSecondConfirmation && event.confirmationChallenge) {
        keyboard.push([
          {
            text: `${input.locale === 'ar' ? 'تأكيد' : 'Confirm'} ${clean(event.confirmationChallenge)}`.slice(0, 60),
            callback_data: `a:${event.actionId}:h`,
          },
          { text: input.locale === 'ar' ? 'إلغاء' : 'Cancel', callback_data: `a:${event.actionId}:x` },
        ]);
        continue;
      }
      const links: InlineKeyboard[number] = [];
      if (event.href) links.push({ text: input.locale === 'ar' ? 'فتح السجل' : 'Open record', url: atlasUrl(input.origin, input.locale, event.href) });
      if (event.invoiceHref) links.push({ text: input.locale === 'ar' ? 'فتح الفاتورة' : 'Open invoice', url: atlasUrl(input.origin, input.locale, event.invoiceHref) });
      if (event.documentHref) links.push({ text: input.locale === 'ar' ? 'تنزيل PDF' : 'Download PDF', url: atlasUrl(input.origin, input.locale, event.documentHref) });
      if (links.length) keyboard.push(links);
    }

    if (event.type === 'error') sections.push(event.message);
  }

  const fallback = input.locale === 'ar' ? 'تمت معالجة الطلب.' : 'The request was processed.';
  return {
    chunks: splitTelegramText(sections.filter(Boolean).join('\n\n') || fallback),
    keyboard: keyboard.length ? keyboard : undefined,
  };
}

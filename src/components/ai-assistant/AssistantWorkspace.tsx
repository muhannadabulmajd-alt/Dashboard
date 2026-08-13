'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  History,
  LoaderCircle,
  MessageSquarePlus,
  PackagePlus,
  ReceiptText,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiActionPreview, AiClarification, AiResultCard, AiStreamEvent } from '@/lib/ai-assistant';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type ConversationSummary = {
  id: string;
  title: string | null;
  locale: string;
  lastMessageAt: string;
  messageCount: number;
};

type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  events: AiStreamEvent[];
  createdAt: string;
  streaming?: boolean;
};

type StoredMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string | null;
  payload: unknown;
  createdAt: string;
};

type ActionResult = {
  actionId: string;
  status: string;
  message: string;
  href?: string;
};

const QUICK_ACTIONS = [
  { key: 'sales', icon: BarChart3 },
  { key: 'order', icon: FileSearch },
  { key: 'inventory', icon: Boxes },
  { key: 'expenses', icon: ReceiptText },
  { key: 'createOrder', icon: ShoppingBag },
  { key: 'expense', icon: ReceiptText },
  { key: 'purchase', icon: PackagePlus },
  { key: 'status', icon: Check },
] as const;

const PROMPTS = {
  en: {
    sales: 'Analyze sales for this month.',
    order: 'Help me find an order.',
    inventory: 'Show current inventory and low-stock items.',
    expenses: 'Review business spending for this month.',
    createOrder: 'Help me create a new order.',
    expense: 'Help me record an expense.',
    purchase: 'Help me record a purchase.',
    status: 'Help me update an order status.',
  },
  ar: {
    sales: 'حلل المبيعات لهذا الشهر.',
    order: 'ساعدني في البحث عن طلب.',
    inventory: 'اعرض المخزون الحالي والمواد منخفضة المخزون.',
    expenses: 'راجع إنفاق العمل لهذا الشهر.',
    createOrder: 'ساعدني في إنشاء طلب جديد.',
    expense: 'ساعدني في تسجيل مصروف.',
    purchase: 'ساعدني في تسجيل عملية شراء.',
    status: 'ساعدني في تحديث حالة طلب.',
  },
} as const;

function payloadEvents(payload: unknown): AiStreamEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as { events?: unknown; actionResult?: ActionResult };
  if (Array.isArray(value.events)) return value.events as AiStreamEvent[];
  if (value.actionResult) {
    return [{
      type: 'action_result',
      actionId: value.actionResult.actionId,
      status: value.actionResult.status,
      message: value.actionResult.message,
      href: value.actionResult.href,
    }];
  }
  return [];
}

function dateLabel(value: string, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Baghdad',
  }).format(new Date(value));
}

function parseSseBlock(block: string): AiStreamEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data) as AiStreamEvent;
  } catch {
    return null;
  }
}

function ResultCard({ card, locale }: { card: AiResultCard; locale: 'ar' | 'en' }) {
  const t = useTranslations('aiAssistant');
  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-amber/20 bg-card text-start shadow-[0_8px_24px_rgba(83,45,31,0.06)]">
      <div className="border-b border-border/70 bg-linen/25 px-4 py-3">
        <h3 className="font-bold text-roast">{card.title}</h3>
        {card.answer ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{card.answer}</p> : null}
        {card.period ? <p className="mt-1 text-xs text-muted-foreground">{card.period}</p> : null}
      </div>
      {card.metrics?.length ? (
        <div className="grid grid-cols-1 divide-y divide-border/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {card.metrics.map((metric) => (
            <div key={`${metric.label}-${metric.value}`} className="px-4 py-3">
              <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
              <div className="mt-1 break-words text-xl font-bold tabular text-roast">{metric.value}</div>
              {metric.hint ? <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {card.rows?.length ? (
        <div className="divide-y divide-border/70 border-t border-border/70">
          {card.rows.map((row) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-roast">{row.title}</span>
                  {row.subtitle ? <span className="mt-0.5 block break-words text-xs text-muted-foreground">{row.subtitle}</span> : null}
                </span>
                {row.value !== undefined ? <span className="shrink-0 text-sm font-bold tabular text-roast">{row.value}</span> : null}
                {row.href ? <ChevronRight className="size-4 shrink-0 rtl:rotate-180" /> : null}
              </>
            );
            return row.href ? (
              <Link key={row.id} href={row.href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-linen/35">
                {body}
              </Link>
            ) : (
              <div key={row.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">{body}</div>
            );
          })}
        </div>
      ) : null}
      {card.href ? (
        <div className="border-t border-border/70 px-4 py-2.5">
          <Link href={card.href} className="text-sm font-semibold text-primary hover:text-amber">{t('viewInAtlas')}</Link>
        </div>
      ) : null}
      <p className="border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
        {t('generatedAt', { date: dateLabel(card.generatedAt, locale) })}
      </p>
    </section>
  );
}

function ClarificationCard({
  clarification,
  disabled,
  onChoose,
}: {
  clarification: AiClarification;
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <section className="mt-3 rounded-xl border border-warning/25 bg-warning-soft/55 p-3 text-start">
      <p className="text-sm font-semibold leading-6 text-roast">{clarification.message}</p>
      {clarification.choices?.length ? (
        <div className="mt-2 grid gap-2">
          {clarification.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(`${clarification.field ?? 'selection'}: ${choice.value}`)}
              className="min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-start text-sm font-semibold text-roast hover:border-amber/45 hover:bg-linen/35 disabled:opacity-50"
            >
              {choice.label}
              {choice.detail ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{choice.detail}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ActionPreviewCard({
  action,
  locale,
  busy,
  onAction,
}: {
  action: AiActionPreview;
  locale: 'ar' | 'en';
  busy: boolean;
  onAction: (action: AiActionPreview, operation: 'confirm' | 'cancel') => void;
}) {
  const t = useTranslations('aiAssistant');
  const terminal = ['EXECUTING', 'EXECUTED', 'CANCELLED', 'FAILED', 'EXPIRED', 'STALE'].includes(action.status);
  const terminalLabels: Record<string, string> = {
    EXECUTING: t('processing'),
    EXECUTED: t('confirmed'),
    CANCELLED: t('cancelled'),
    FAILED: t('failed'),
    EXPIRED: t('expired'),
    STALE: t('stale'),
  };
  return (
    <section className="mt-3 overflow-hidden rounded-xl border-2 border-amber/35 bg-card text-start shadow-[0_10px_28px_rgba(83,45,31,0.08)]">
      <div className="flex items-start gap-3 border-b border-amber/20 bg-amber/10 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">{t('confirmationRequired')}</p>
          <h3 className="mt-1 break-words font-bold text-roast">{action.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{action.summary}</p>
        </div>
      </div>
      <dl className="divide-y divide-border/70">
        {action.fields.map((field) => (
          <div key={`${field.label}-${field.value}`} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="break-words text-sm font-semibold text-roast">{field.value}</dd>
          </div>
        ))}
      </dl>
      {action.warnings.length ? (
        <ul className="border-t border-border/70 bg-warning-soft/50 px-4 py-2.5 text-xs leading-5 text-warning">
          {action.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      <div className="border-t border-border/70 p-3">
        {!terminal ? (
          <>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              {t('expiresAt', { date: dateLabel(action.expiresAt, locale) })}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(action, 'confirm')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-amber/90 disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                {t('confirm')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(action, 'cancel')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-roast hover:bg-linen/40 disabled:opacity-50"
              >
                <X className="size-4" />
                {t('cancel')}
              </button>
            </div>
          </>
        ) : (
          <div className={cn('flex items-center gap-2 text-sm font-bold', action.status === 'EXECUTED' ? 'text-success' : 'text-muted-foreground')}>
            {action.status === 'EXECUTING'
              ? <LoaderCircle className="size-4 animate-spin" />
              : action.status === 'EXECUTED'
                ? <Check className="size-4" />
                : <X className="size-4" />}
            {terminalLabels[action.status] ?? action.status}
          </div>
        )}
      </div>
      <span className="sr-only">{locale}</span>
    </section>
  );
}

function ConversationHistory({
  conversations,
  activeId,
  locale,
  privacyText,
  onSelect,
  onNew,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  locale: 'ar' | 'en';
  privacyText: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const t = useTranslations('aiAssistant');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 p-3">
        <button
          type="button"
          onClick={onNew}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-grove px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-grove/90"
        >
          <MessageSquarePlus className="size-4" />
          {t('newChat')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.length ? conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelect(conversation.id)}
            className={cn(
              'mb-1 w-full rounded-lg px-3 py-2.5 text-start hover:bg-linen/40',
              activeId === conversation.id && 'bg-linen/65',
            )}
          >
            <span className="line-clamp-2 text-sm font-semibold leading-5 text-roast">{conversation.title || t('newChat')}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">{dateLabel(conversation.lastMessageAt, locale)}</span>
          </button>
        )) : <p className="p-3 text-sm leading-6 text-muted-foreground">{t('noHistory')}</p>}
      </div>
      <div className="border-t border-border/70 p-3 text-xs leading-5 text-muted-foreground">{privacyText}</div>
    </div>
  );
}

export function AssistantWorkspace({
  locale,
  initialConversations,
  retentionDays,
}: {
  locale: 'ar' | 'en';
  initialConversations: ConversationSummary[];
  retentionDays: number;
}) {
  const t = useTranslations('aiAssistant');
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const historyDialogRef = useRef<HTMLDivElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const conversationLoadRef = useRef(0);
  const conversationAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const shouldFollowRef = useRef(true);
  const privacyText = t('privacy', { days: retentionDays });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!messages.length) {
      viewport.scrollTop = 0;
      shouldFollowRef.current = true;
      return;
    }
    if (shouldFollowRef.current) viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!historyOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : historyTriggerRef.current;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => historyCloseRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setHistoryOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(historyDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      requestAnimationFrame(() => previous?.focus());
    };
  }, [historyOpen]);

  useEffect(() => () => {
    conversationAbortRef.current?.abort();
    chatAbortRef.current?.abort();
  }, []);

  const quickPrompts = useMemo(() => PROMPTS[locale], [locale]);

  const refreshHistory = async () => {
    const response = await fetch('/api/ai-assistant/conversations', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json() as { conversations: Array<Omit<ConversationSummary, 'messageCount'> & { _count: { messages: number } }> };
    setConversations(data.conversations.map((row) => ({ ...row, messageCount: row._count.messages })));
  };

  const newConversation = () => {
    conversationAbortRef.current?.abort();
    conversationAbortRef.current = null;
    conversationLoadRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setInput('');
    setHistoryOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const loadConversation = async (id: string) => {
    if (sending) return;
    const loadId = conversationLoadRef.current + 1;
    conversationLoadRef.current = loadId;
    conversationAbortRef.current?.abort();
    const controller = new AbortController();
    conversationAbortRef.current = controller;
    try {
      const response = await fetch(`/api/ai-assistant/conversations/${id}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || loadId !== conversationLoadRef.current) return;
      const data = await response.json() as {
        conversation: {
          id: string;
          messages: StoredMessage[];
          pendingActions: Array<{ id: string; status: string }>;
        };
      };
      if (loadId !== conversationLoadRef.current) return;
      const actionStatuses = new Map(data.conversation.pendingActions.map((action) => [action.id, action.status]));
      setConversationId(data.conversation.id);
      setMessages(data.conversation.messages.slice().reverse().flatMap((message) => message.role === 'SYSTEM' ? [] : [{
        id: message.id,
        role: message.role,
        content: message.content ?? '',
        events: payloadEvents(message.payload).map((event) => event.type === 'action_preview'
          ? { ...event, action: { ...event.action, status: actionStatuses.get(event.action.id) ?? event.action.status } }
          : event),
        createdAt: message.createdAt,
      }]));
      shouldFollowRef.current = true;
      setHistoryOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('Conversation load failed');
    }
    if (conversationAbortRef.current === controller) conversationAbortRef.current = null;
  };

  const addEvent = (messageId: string, event: AiStreamEvent) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message;
      if (event.type === 'text_delta') return { ...message, content: message.content + event.delta };
      if (event.type === 'conversation' || event.type === 'completion') return message;
      return { ...message, events: [...message.events, event] };
    }));
  };

  const sendMessage = async (raw?: string) => {
    const messageText = (raw ?? input).trim();
    if (!messageText || sending) return;
    const userId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;
    setInput('');
    setSending(true);
    shouldFollowRef.current = true;
    setMessages((current) => [
      ...current,
      { id: userId, role: 'USER', content: messageText, events: [], createdAt: new Date().toISOString() },
      { id: assistantId, role: 'ASSISTANT', content: '', events: [], createdAt: new Date().toISOString(), streaming: true },
    ]);

    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      const response = await fetch('/api/ai-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversationId ?? undefined, message: messageText, locale }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message || (body.error === 'rate_limited'
          ? (locale === 'ar' ? 'تم إرسال طلبات كثيرة. انتظر قليلاً ثم حاول مجدداً.' : 'Too many requests. Wait a moment and try again.')
          : body.error || 'request_failed'));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.type === 'conversation') setConversationId(event.conversationId);
          if (event.type === 'completion') completed = true;
          addEvent(assistantId, event);
        }
        if (done) break;
      }
      if (!completed) throw new Error(locale === 'ar' ? 'انقطع الرد قبل اكتماله. لم يتم تغيير أي بيانات.' : 'The response ended before completion. No data was changed.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      addEvent(assistantId, {
        type: 'error',
        message: error instanceof Error && error.message !== 'request_failed'
          ? error.message
          : locale === 'ar' ? 'تعذر الاتصال بالمساعد. لم يتم تغيير أي بيانات.' : 'Could not reach the assistant. No data was changed.',
        debugId: 'client-connection',
        retryable: true,
      });
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, streaming: false } : message));
      setSending(false);
      void refreshHistory();
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  };

  const runAction = async (action: AiActionPreview, operation: 'confirm' | 'cancel') => {
    if (actionBusy) return;
    setActionBusy(action.id);
    try {
      const response = await fetch(`/api/ai-assistant/actions/${action.id}/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      const body = await response.json() as ActionResult & { message?: string; error?: string };
      if (!response.ok) {
        const status = body.error === 'action_stale' ? 'STALE' : body.error === 'action_expired' ? 'EXPIRED' : null;
        if (status) {
          setMessages((current) => current.map((message) => ({
            ...message,
            events: message.events.map((event) => event.type === 'action_preview' && event.action.id === action.id
              ? { ...event, action: { ...event.action, status } }
              : event),
          })));
        }
        throw new Error(body.message || 'action_failed');
      }
      setMessages((current) => current.map((message) => ({
        ...message,
        events: message.events.map((event) => event.type === 'action_preview' && event.action.id === action.id
          ? { ...event, action: { ...event.action, status: body.status } }
          : event),
      })));
      setMessages((current) => [...current, {
        id: `action-result-${action.id}-${Date.now()}`,
        role: 'ASSISTANT',
        content: '',
        events: [{ type: 'action_result', actionId: action.id, status: body.status, message: body.message, href: body.href }],
        createdAt: new Date().toISOString(),
      }]);
      void refreshHistory();
    } catch (error) {
      setMessages((current) => [...current, {
        id: `action-error-${action.id}-${Date.now()}`,
        role: 'ASSISTANT',
        content: error instanceof Error ? error.message : 'Action failed',
        events: [],
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <section className="relative grid h-[max(34rem,calc(100dvh-13rem))] max-h-[56rem] overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card shadow-[0_14px_40px_rgba(83,45,31,0.07)] lg:h-[calc(100dvh-12rem)] lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-e border-border/70 bg-linen/20 lg:block">
        <ConversationHistory conversations={conversations} activeId={conversationId} locale={locale} privacyText={privacyText} onSelect={loadConversation} onNew={newConversation} />
      </aside>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5 lg:hidden">
          <button
            ref={historyTriggerRef}
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-roast"
          >
            <History className="size-4" />
            {t('history')}
          </button>
          <button type="button" onClick={newConversation} aria-label={t('newChat')} className="inline-flex size-10 items-center justify-center rounded-lg bg-grove text-primary-foreground">
            <MessageSquarePlus className="size-4" />
          </button>
        </div>

        <div
          ref={viewportRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={sending}
          aria-label={t('transcript')}
          onScroll={(event) => {
            const element = event.currentTarget;
            shouldFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        >
          {!messages.length ? (
            <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center py-8 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-grove text-primary-foreground shadow-lg shadow-grove/15">
                <Sparkles className="size-6" />
              </span>
              <h2 className="mt-4 text-xl font-bold text-roast">{t('emptyTitle')}</h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{t('emptyBody')}</p>
              <div className="mt-5 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {QUICK_ACTIONS.map(({ key, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void sendMessage(quickPrompts[key])}
                    className="flex min-h-20 items-start gap-3 rounded-xl border border-border bg-card p-3 text-start hover:border-amber/45 hover:bg-linen/30"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber/12 text-primary"><Icon className="size-4" /></span>
                    <span className="text-sm font-semibold leading-5 text-roast">{t(`quickActions.${key}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message) => (
                <article
                  key={message.id}
                  aria-label={message.role === 'USER' ? t('userMessage') : t('assistantMessage')}
                  className={cn('flex', message.role === 'USER' ? 'justify-end' : 'justify-start')}
                >
                  <div className={cn(
                    'max-w-[min(100%,46rem)]',
                    message.role === 'USER' ? 'rounded-2xl rounded-ee-md bg-grove px-4 py-3 text-primary-foreground' : 'w-full',
                  )}>
                    {message.content ? <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p> : null}
                    {message.streaming && !message.content && !message.events.length ? (
                      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t('stopWait')}</div>
                    ) : null}
                    {message.events.map((event, index) => {
                      if (event.type === 'result_card') return <ResultCard key={`${message.id}-card-${index}`} card={event.card} locale={locale} />;
                      if (event.type === 'clarification') return <ClarificationCard key={`${message.id}-clarification-${index}`} clarification={event.clarification} disabled={sending} onChoose={(value) => void sendMessage(value)} />;
                      if (event.type === 'action_preview') return <ActionPreviewCard key={`${message.id}-action-${event.action.id}`} action={event.action} locale={locale} busy={actionBusy === event.action.id} onAction={runAction} />;
                      if (event.type === 'action_result') return (
                        <div
                          key={`${message.id}-result-${index}`}
                          className={cn(
                            'mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold',
                            event.status === 'EXECUTED'
                              ? 'border-success/25 bg-success-soft/70 text-success'
                              : 'border-border bg-linen/45 text-roast',
                          )}
                        >
                          {event.status === 'EXECUTED' ? <Check className="size-4" /> : <X className="size-4" />}
                          <span className="flex-1">{event.message}</span>
                          {event.href ? <Link href={event.href} className="text-roast underline underline-offset-4">{t('open')}</Link> : null}
                        </div>
                      );
                      if (event.type === 'error') return (
                        <div key={`${message.id}-error-${index}`} className="mt-2 rounded-xl border border-danger/25 bg-danger-soft/70 px-3 py-2.5 text-sm leading-6 text-danger">
                          {event.message}
                          {event.retryable ? (
                            <button type="button" onClick={() => void sendMessage(messages.filter((row) => row.role === 'USER').at(-1)?.content)} className="ms-2 inline-flex items-center gap-1 font-bold underline underline-offset-4">
                              <RotateCcw className="size-3.5" /> {t('retry')}
                            </button>
                          ) : null}
                        </div>
                      );
                      return null;
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}
          className="border-t border-border/70 bg-card/95 p-3 pe-20 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:p-4"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-[0_8px_24px_rgba(83,45,31,0.06)] focus-within:border-amber/50 focus-within:ring-2 focus-within:ring-amber/10">
            <textarea
              ref={composerRef}
              value={input}
              maxLength={4_000}
              rows={1}
              readOnly={sending}
              aria-label={t('composerLabel')}
              aria-busy={sending}
              placeholder={t('placeholder')}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-6 text-roast outline-none placeholder:text-muted-foreground/75 read-only:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label={t('send')}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">{privacyText}</p>
        </form>
      </div>

      {historyOpen ? (
        <div ref={historyDialogRef} className="fixed inset-0 z-[120] lg:hidden" role="dialog" aria-modal="true" aria-label={t('history')}>
          <button type="button" aria-label={t('closeHistory')} onClick={() => setHistoryOpen(false)} className="absolute inset-0 bg-grove/55 backdrop-blur-[2px]" />
          <aside className="absolute inset-y-0 start-0 w-[min(21rem,90vw)] border-e border-border bg-card shadow-2xl">
            <button ref={historyCloseRef} type="button" onClick={() => setHistoryOpen(false)} className="absolute end-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card" aria-label={t('closeHistory')}>
              <X className="size-4" />
            </button>
            <div className="h-full pt-12">
              <ConversationHistory conversations={conversations} activeId={conversationId} locale={locale} privacyText={privacyText} onSelect={loadConversation} onNew={newConversation} />
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

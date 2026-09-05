'use client';

import { useCallback, useMemo, useState } from 'react';
import { BellRing, CalendarClock, ChevronDown, LoaderCircle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiAutomationKindValue } from '@/lib/ai-automations';
import { cn } from '@/lib/utils';

type PreferenceRecord = {
  id: string;
  kind: AiAutomationKindValue;
  enabled: boolean;
  locale: string;
  channel: 'WEB' | 'TELEGRAM';
  settings: unknown;
  nextRunAt: string | null;
  lastRunAt: string | null;
  updatedAt: string;
};

type PreferenceDraft = {
  enabled: boolean;
  locale: 'ar' | 'en';
  channel: 'WEB' | 'TELEGRAM';
  deliveryHour: number;
  limit: number;
  lookbackDays?: number;
  horizonDays?: number;
  expiryDays?: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

type DeliveryHealth = {
  pendingDocuments: number;
  failedDocuments: number;
  pendingReports: number;
  failedReports: number;
  failedAutomations: number;
  enabledAutomations: number;
  retryable: number;
};

const KINDS: AiAutomationKindValue[] = [
  'DAILY_SUMMARY',
  'ANOMALY_ALERT',
  'REORDER_RECOMMENDATION',
  'DEMAND_FORECAST',
];

function defaults(kind: AiAutomationKindValue, locale: 'ar' | 'en'): PreferenceDraft {
  const common = { enabled: false, locale, channel: 'WEB' as const, deliveryHour: kind === 'DAILY_SUMMARY' ? 8 : 9, limit: kind === 'DAILY_SUMMARY' ? 10 : 25, nextRunAt: null, lastRunAt: null };
  if (kind === 'ANOMALY_ALERT') return { ...common, expiryDays: 30 };
  if (kind === 'REORDER_RECOMMENDATION') return { ...common, horizonDays: 30 };
  if (kind === 'DEMAND_FORECAST') return { ...common, lookbackDays: 60, horizonDays: 30 };
  return common;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function preferenceDraft(record: PreferenceRecord, locale: 'ar' | 'en'): PreferenceDraft {
  const fallback = defaults(record.kind, locale);
  const settings = objectValue(record.settings);
  return {
    ...fallback,
    enabled: record.enabled,
    locale: record.locale === 'ar' ? 'ar' : 'en',
    channel: record.channel,
    deliveryHour: bounded(settings.deliveryHour, fallback.deliveryHour, 0, 23),
    limit: bounded(settings.limit, fallback.limit, 1, 50),
    ...(record.kind === 'ANOMALY_ALERT' ? { expiryDays: bounded(settings.expiryDays, 30, 1, 180) } : {}),
    ...(record.kind === 'REORDER_RECOMMENDATION' ? { horizonDays: bounded(settings.horizonDays, 30, 1, 90) } : {}),
    ...(record.kind === 'DEMAND_FORECAST' ? {
      lookbackDays: bounded(settings.lookbackDays, 60, 14, 180),
      horizonDays: bounded(settings.horizonDays, 30, 1, 90),
    } : {}),
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
  };
}

function formatRun(value: string | null, locale: 'ar' | 'en', never: string): string {
  if (!value) return never;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Baghdad',
  }).format(new Date(value));
}

export function AutomationPreferences({
  locale,
  initialPreferences,
  initialHealth,
  initialTelegramLinked,
}: {
  locale: 'ar' | 'en';
  initialPreferences: PreferenceRecord[];
  initialHealth: DeliveryHealth;
  initialTelegramLinked: boolean;
}) {
  const t = useTranslations('aiAssistant.automations');
  const initialDrafts = useMemo(() => Object.fromEntries(KINDS.map((kind) => [kind, defaults(kind, locale)])) as Record<AiAutomationKindValue, PreferenceDraft>, [locale]);
  const [drafts, setDrafts] = useState(() => {
    const next = { ...initialDrafts };
    for (const kind of KINDS) {
      const records = initialPreferences.filter((record) => record.kind === kind);
      const selected = records.find((record) => record.enabled) ?? records[0];
      if (selected) next[kind] = preferenceDraft(selected, locale);
    }
    return next;
  });
  const [health, setHealth] = useState<DeliveryHealth>(initialHealth);
  const [telegramLinked, setTelegramLinked] = useState(initialTelegramLinked);
  const [saving, setSaving] = useState<AiAutomationKindValue | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [preferencesResponse, deliveriesResponse] = await Promise.all([
        fetch('/api/ai-assistant/preferences', { cache: 'no-store' }),
        fetch('/api/ai-assistant/deliveries', { cache: 'no-store' }),
      ]);
      if (!preferencesResponse.ok || !deliveriesResponse.ok) throw new Error('load_failed');
      const preferenceBody = await preferencesResponse.json() as { preferences: PreferenceRecord[]; telegramLinked: boolean };
      const deliveryBody = await deliveriesResponse.json() as { health: DeliveryHealth };
      const next = { ...initialDrafts };
      for (const kind of KINDS) {
        const records = preferenceBody.preferences.filter((record) => record.kind === kind);
        const selected = records.find((record) => record.enabled) ?? records[0];
        if (selected) next[kind] = preferenceDraft(selected, locale);
      }
      setDrafts(next);
      setHealth(deliveryBody.health);
      setTelegramLinked(preferenceBody.telegramLinked);
      setError(null);
    } catch {
      setError(t('loadError'));
    }
  }, [initialDrafts, locale, t]);

  const update = (kind: AiAutomationKindValue, change: Partial<PreferenceDraft>) => {
    setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...change } }));
    setNotice(null);
    setError(null);
  };

  const save = async (kind: AiAutomationKindValue) => {
    const draft = drafts[kind];
    setSaving(kind);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch('/api/ai-assistant/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...draft, nextRunAt: undefined, lastRunAt: undefined }),
      });
      const body = await response.json().catch(() => null) as { preference?: PreferenceRecord; error?: string } | null;
      if (!response.ok || !body?.preference) {
        throw new Error(body?.error === 'telegram_not_linked' ? 'telegram_not_linked' : 'save_failed');
      }
      update(kind, preferenceDraft(body.preference, locale));
      setNotice(t('saved'));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message === 'telegram_not_linked' ? t('telegramNotLinked') : t('saveError'));
    } finally {
      setSaving(null);
    }
  };

  const replay = async () => {
    setReplaying(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch('/api/ai-assistant/deliveries/replay', { method: 'POST' });
      const body = await response.json().catch(() => null) as { result?: { attempted: number; completed: number; failed: number }; health?: DeliveryHealth } | null;
      if (!body?.result || !body.health) throw new Error('replay_failed');
      setHealth(body.health);
      setNotice(t('replayResult', body.result));
    } catch {
      setError(t('replayError'));
    } finally {
      setReplaying(false);
    }
  };

  return (
    <details className="group mb-3 overflow-hidden rounded-[var(--radius)] border border-border/75 bg-card shadow-[0_8px_24px_rgba(83,45,31,0.045)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 sm:px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber/12 text-primary"><CalendarClock className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-roast">{t('title')}</span>
          <span className="block text-xs leading-5 text-muted-foreground">{t('subtitle')}</span>
        </span>
        {health?.enabledAutomations ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">{t('activeCount', { count: health.enabledAutomations })}</span> : null}
        {health?.retryable ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">{t('retryCount', { count: health.retryable })}</span> : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/70 bg-linen/15 p-3 sm:p-4">
        <div className="grid gap-3">
            <div className="grid gap-3 xl:grid-cols-2">
              {KINDS.map((kind) => {
                const draft = drafts[kind];
                return (
                  <section key={kind} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-grove text-primary-foreground"><BellRing className="size-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-roast">{t(`types.${kind}.title`)}</h3>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t(`types.${kind}.description`)}</p>
                      </div>
                      <label className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-roast">
                        <input type="checkbox" checked={draft.enabled} onChange={(event) => update(kind, { enabled: event.target.checked })} className="size-4 accent-[var(--primary)]" />
                        {draft.enabled ? t('enabled') : t('disabled')}
                      </label>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="text-xs font-semibold text-muted-foreground">
                        {t('channel')}
                        <select value={draft.channel} onChange={(event) => update(kind, { channel: event.target.value as 'WEB' | 'TELEGRAM' })} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast">
                          <option value="WEB">{t('web')}</option>
                          <option value="TELEGRAM" disabled={!telegramLinked}>{t('telegram')}</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        {t('language')}
                        <select value={draft.locale} onChange={(event) => update(kind, { locale: event.target.value as 'ar' | 'en' })} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast">
                          <option value="ar">{t('arabic')}</option>
                          <option value="en">{t('english')}</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        {t('deliveryHour')}
                        <select value={draft.deliveryHour} onChange={(event) => update(kind, { deliveryHour: Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast" dir="ltr">
                          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                        </select>
                      </label>
                      {kind === 'ANOMALY_ALERT' ? (
                        <NumberField label={t('expiryDays')} value={draft.expiryDays ?? 30} min={1} max={180} onChange={(value) => update(kind, { expiryDays: value })} />
                      ) : kind === 'DEMAND_FORECAST' ? (
                        <NumberField label={t('lookbackDays')} value={draft.lookbackDays ?? 60} min={14} max={180} onChange={(value) => update(kind, { lookbackDays: value })} />
                      ) : kind === 'REORDER_RECOMMENDATION' ? (
                        <NumberField label={t('horizonDays')} value={draft.horizonDays ?? 30} min={1} max={90} onChange={(value) => update(kind, { horizonDays: value })} />
                      ) : <div />}
                    </div>
                    {kind === 'DEMAND_FORECAST' ? (
                      <div className="mt-2 max-w-40"><NumberField label={t('horizonDays')} value={draft.horizonDays ?? 30} min={1} max={90} onChange={(value) => update(kind, { horizonDays: value })} /></div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-border/60 pt-2">
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        <span className="me-3">{t('nextRun')}: {formatRun(draft.nextRunAt, locale, t('never'))}</span>
                        <span>{t('lastRun')}: {formatRun(draft.lastRunAt, locale, t('never'))}</span>
                      </div>
                      <button type="button" disabled={saving !== null} onClick={() => void save(kind)} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-amber/90 disabled:opacity-50">
                        {saving === kind ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{saving === kind ? t('saving') : t('save')}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
            {health ? (
              <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
                <div className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
                  <span className="font-bold text-roast">{t('deliveryHealth')}</span>{' '}
                  {t('deliverySummary', { pending: health.pendingDocuments + health.pendingReports, failed: health.retryable, automations: health.failedAutomations })}
                </div>
                <button type="button" disabled={replaying || health.retryable === 0} onClick={() => void replay()} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold text-roast hover:bg-linen/40 disabled:opacity-45')}>
                  {replaying ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{replaying ? t('replaying') : t('replay')}
                </button>
              </section>
            ) : null}
            {notice ? <p className="text-xs font-semibold text-success">{notice}</p> : null}
            {error ? <p className="text-xs font-semibold text-danger">{error}</p> : null}
        </div>
      </div>
    </details>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground">
      {label}
      <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast" dir="ltr" />
    </label>
  );
}

'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AI_CAPABILITIES,
  type AiCapability,
  type AiCapabilityState,
  type AiCapabilityStatusValue,
} from '@/lib/ai-capabilities';

type CapabilityDraft = AiCapabilityState & { reason: string };

function toDraft(state: AiCapabilityState): CapabilityDraft {
  return { ...state, reason: state.disabledReason?.replace(/^automatic:/, '') ?? '' };
}

export function CapabilityControls({ initialCapabilities }: { initialCapabilities: AiCapabilityState[] }) {
  const t = useTranslations('aiAssistant.capabilities');
  const [drafts, setDrafts] = useState<Record<AiCapability, CapabilityDraft>>(() => {
    const byCapability = new Map(initialCapabilities.map((state) => [state.capability, state]));
    return Object.fromEntries(AI_CAPABILITIES.map((capability) => [
      capability,
      toDraft(byCapability.get(capability) ?? {
        capability,
        status: 'ENABLED',
        failureCount: 0,
        failureLimit: 1,
        disabledReason: null,
        lastFailureAt: null,
        updatedAt: null,
      }),
    ])) as Record<AiCapability, CapabilityDraft>;
  });
  const [saving, setSaving] = useState<AiCapability | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (capability: AiCapability, change: Partial<CapabilityDraft>) => {
    setDrafts((current) => ({
      ...current,
      [capability]: { ...current[capability], ...change },
    }));
    setNotice(null);
    setError(null);
  };

  const save = async (capability: AiCapability) => {
    const draft = drafts[capability];
    setSaving(capability);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch('/api/ai-assistant/capabilities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability,
          status: draft.status,
          failureLimit: draft.failureLimit,
          reason: draft.status === 'ENABLED' ? null : draft.reason.trim() || 'manual',
        }),
      });
      const body = await response.json().catch(() => null) as { capability?: AiCapabilityState } | null;
      if (!response.ok || !body?.capability) throw new Error('save_failed');
      update(capability, toDraft(body.capability));
      setNotice(t('saved'));
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <details className="group mb-3 overflow-hidden rounded-[var(--radius)] border border-border/75 bg-card shadow-[0_8px_24px_rgba(83,45,31,0.045)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 sm:px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success"><ShieldCheck className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-roast">{t('title')}</span>
          <span className="block text-xs leading-5 text-muted-foreground">{t('subtitle')}</span>
        </span>
        {Object.values(drafts).some((state) => state.status !== 'ENABLED') ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning"><AlertTriangle className="size-3" />{t('attention')}</span>
        ) : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/70 bg-linen/15 p-3 sm:p-4">
        <div className="grid gap-2 xl:grid-cols-2">
          {AI_CAPABILITIES.map((capability) => {
            const draft = drafts[capability];
            return (
              <section key={capability} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-roast">{t(`types.${capability}.title`)}</h3>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t(`types.${capability}.description`)}</p>
                  </div>
                  <span className={draft.status === 'ENABLED'
                    ? 'rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success'
                    : 'rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning'}>
                    {t(`statuses.${draft.status}`)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t('status')}
                    <select
                      value={draft.status}
                      onChange={(event) => update(capability, { status: event.target.value as AiCapabilityStatusValue })}
                      className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast"
                    >
                      <option value="ENABLED">{t('statuses.ENABLED')}</option>
                      <option value="PAUSED">{t('statuses.PAUSED')}</option>
                      <option value="DISABLED">{t('statuses.DISABLED')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t('failureLimit')}
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={draft.failureLimit}
                      onChange={(event) => update(capability, { failureLimit: Number(event.target.value) })}
                      className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast"
                      dir="ltr"
                    />
                  </label>
                </div>
                {draft.status !== 'ENABLED' ? (
                  <label className="mt-2 block text-xs font-semibold text-muted-foreground">
                    {t('reason')}
                    <input
                      value={draft.reason}
                      maxLength={200}
                      onChange={(event) => update(capability, { reason: event.target.value })}
                      className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-roast"
                    />
                  </label>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-[11px] text-muted-foreground">{t('failureCount', { count: draft.failureCount })}</span>
                  <button
                    type="button"
                    disabled={saving !== null || !Number.isInteger(draft.failureLimit) || draft.failureLimit < 1 || draft.failureLimit > 10}
                    onClick={() => void save(capability)}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-amber/90 disabled:opacity-50"
                  >
                    {saving === capability ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    {saving === capability ? t('saving') : t('save')}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
        {notice ? <p className="mt-3 text-xs font-semibold text-success">{notice}</p> : null}
        {error ? <p className="mt-3 text-xs font-semibold text-danger">{error}</p> : null}
      </div>
    </details>
  );
}

'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bot, CheckCircle2, Link2, Loader2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';

type AtlasUser = { id: string; name: string; email: string; role: string };
type TelegramIdentityRow = {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string;
  lastSeenAt: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
};

type BotStatus = {
  enabled: boolean;
  configured: boolean;
  bot: { id: number; username?: string; first_name: string } | null;
  webhook: { url: string; pending_update_count: number; last_error_message?: string } | null;
};

const field = 'h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary';

export function TelegramConnectorPanel({
  configured,
  enabled,
  environment,
  allowedUserIds,
  users,
  identities,
}: {
  configured: boolean;
  enabled: boolean;
  environment: string;
  allowedUserIds: string[];
  users: AtlasUser[];
  identities: TelegramIdentityRow[];
}) {
  const t = useTranslations('connectors.telegram');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [telegramUserId, setTelegramUserId] = useState('');
  const [atlasUserId, setAtlasUserId] = useState(users[0]?.id ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const allowed = useMemo(() => new Set(allowedUserIds), [allowedUserIds]);

  async function botAction(action: 'verify' | 'register') {
    setMessage(null);
    const response = await fetch('/api/connectors/telegram/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => null) as BotStatus | { error?: string } | null;
    if (!response.ok || !body || 'error' in body) {
      setMessage({ ok: false, text: t('requestFailed') });
      return;
    }
    setBotStatus(body);
    setMessage({ ok: true, text: action === 'register' ? t('registered') : t('verified') });
  }

  async function identityAction(action: 'link' | 'revoke', id = telegramUserId) {
    setMessage(null);
    const response = await fetch('/api/connectors/telegram/identities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, telegramUserId: id, userId: action === 'link' ? atlasUserId : undefined }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setMessage({ ok: false, text: body?.error === 'mapping_conflict' ? t('mappingConflict') : t('requestFailed') });
      return;
    }
    setTelegramUserId('');
    setMessage({ ok: true, text: action === 'link' ? t('linked') : t('revoked') });
    startTransition(() => router.refresh());
  }

  return (
    <section className="rounded-[var(--radius)] border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Bot className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-2.5 py-1 font-medium ${enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                {enabled ? t('enabled') : t('disabled')}
              </span>
              <span className={`rounded-full px-2.5 py-1 font-medium ${configured ? 'bg-success/10 text-success' : 'bg-warning-soft text-warning'}`}>
                {configured ? t('configured') : t('notConfigured')}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">{environment}</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:flex">
          <button
            type="button"
            disabled={pending || !configured || !enabled}
            onClick={() => void botAction('verify')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <ShieldCheck className="size-4" />
            {t('verify')}
          </button>
          <button
            type="button"
            disabled={pending || !configured || !enabled}
            onClick={() => void botAction('register')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t('registerWebhook')}
          </button>
        </div>
      </div>

      {botStatus?.bot ? (
        <div className="mt-4 grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div><span className="text-muted-foreground">{t('bot')}</span><strong className="ms-2">@{botStatus.bot.username ?? botStatus.bot.first_name}</strong></div>
          <div><span className="text-muted-foreground">{t('webhook')}</span><strong className="ms-2 break-all">{botStatus.webhook?.url || t('notRegistered')}</strong></div>
          <div><span className="text-muted-foreground">{t('pendingUpdates')}</span><strong className="ms-2">{botStatus.webhook?.pending_update_count ?? 0}</strong></div>
          {botStatus.webhook?.last_error_message ? <p className="text-danger sm:col-span-3">{botStatus.webhook.last_error_message}</p> : null}
        </div>
      ) : null}

      <div className="mt-5 border-t pt-5">
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">{t('linkTitle')}</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('linkHelp')}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_auto]">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={telegramUserId}
            onChange={(event) => setTelegramUserId(event.target.value.replace(/\D/g, ''))}
            placeholder={t('telegramId')}
            className={field}
          />
          <select value={atlasUserId} onChange={(event) => setAtlasUserId(event.target.value)} className={field}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role} · {user.email}</option>)}
          </select>
          <button
            type="button"
            disabled={pending || !telegramUserId || !atlasUserId}
            onClick={() => void identityAction('link')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Link2 className="size-4" />
            {t('link')}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {identities.length ? identities.map((identity) => {
          const displayName = [identity.firstName, identity.lastName].filter(Boolean).join(' ') || identity.username || identity.telegramUserId;
          return (
            <article key={identity.telegramUserId} className="rounded-md border bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{displayName}</p>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">{identity.telegramUserId}{identity.username ? ` · @${identity.username}` : ''}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${identity.status === 'ACTIVE' ? 'bg-success/10 text-success' : identity.status === 'PENDING' ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground'}`}>
                  {identity.status === 'ACTIVE' ? t('active') : identity.status === 'PENDING' ? t('pending') : t('revokedStatus')}
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">
                  {identity.user ? `${identity.user.name} · ${identity.user.role}` : allowed.has(identity.telegramUserId) ? t('allowlisted') : t('notLinked')}
                </span>
                {identity.status === 'ACTIVE' ? (
                  <button type="button" onClick={() => void identityAction('revoke', identity.telegramUserId)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 font-semibold text-danger hover:bg-danger/5">
                    <Unlink className="size-3.5" /> {t('revoke')}
                  </button>
                ) : (
                  <button type="button" onClick={() => setTelegramUserId(identity.telegramUserId)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 font-semibold hover:bg-muted">
                    <CheckCircle2 className="size-3.5" /> {t('select')}
                  </button>
                )}
              </div>
            </article>
          );
        }) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground lg:col-span-2">{t('empty')}</p>
        )}
      </div>

      {message ? <p className={`mt-4 text-sm font-medium ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p> : null}
    </section>
  );
}

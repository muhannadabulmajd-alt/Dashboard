'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Settings2 } from 'lucide-react';
import { IMPORT_DATASETS } from '@/server/ingestion/parsers';

const field = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function ConnectorConfigForm({ connectors }: { connectors: { id: string; name: string }[] }) {
  const t = useTranslations('connectors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      connectorId: fd.get('connectorId'),
      url: fd.get('url') || undefined,
      token: fd.get('token') || undefined,
      dataset: fd.get('dataset') || undefined,
      status: fd.get('status') || undefined,
    };
    const res = await fetch('/api/connectors/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setMsg({ ok: res.ok });
    if (res.ok) start(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('name')}</label>
        <select name="connectorId" className={field}>
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('dataset')}</label>
        <select name="dataset" defaultValue="products" className={field}>
          {IMPORT_DATASETS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('url')}</label>
        <input name="url" type="url" placeholder="https://…/orders.csv" className={field} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('token')}</label>
        <input name="token" type="password" placeholder="••••••" autoComplete="off" className={field} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('status')}</label>
        <select name="status" defaultValue="" className={field}>
          <option value="">—</option>
          <option value="ACTIVE">{t('active')}</option>
          <option value="PAUSED">{t('paused')}</option>
        </select>
      </div>
      <div className="flex items-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" />}
          {t('save')}
        </button>
        {msg ? (
          <span className={`text-xs font-medium ${msg.ok ? 'text-success' : 'text-danger'}`}>
            {msg.ok ? t('saved') : t('error')}
          </span>
        ) : null}
      </div>
    </form>
  );
}

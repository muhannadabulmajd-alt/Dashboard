'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, UserPlus } from 'lucide-react';
import { createUser, type CreateUserState } from '@/server/auth/actions';
import { ROLES, enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';

const field = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function CreateUserForm({ branches }: { branches: { id: string; name: string }[] }) {
  const t = useTranslations('admin');
  const locale = useLocale() as AppLocale;
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUser, undefined);

  return (
    <form action={action} className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('name')}</label>
        <input name="name" required className={field} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('email')}</label>
        <input name="email" type="email" required className={field} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('password')}</label>
        <input name="password" type="text" required minLength={8} className={field} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('role')}</label>
        <select name="role" defaultValue="VIEWER" className={field}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {enumLabel(r, locale)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('branch')}</label>
        <select name="branchId" defaultValue="" className={field}>
          <option value="">—</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {t('create')}
        </button>
        {state?.ok ? <span className="text-xs font-medium text-success">{t('created')}</span> : null}
        {state?.error ? <span className="text-xs font-medium text-danger">{t(state.error)}</span> : null}
      </div>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Loader2 } from 'lucide-react';
import { createBranch, type CreateBranchState } from '@/server/branches/actions';
import { GOVERNORATES, enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';

const field = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function CreateBranchForm() {
  const t = useTranslations('branches');
  const locale = useLocale() as AppLocale;
  const [state, action, pending] = useActionState<CreateBranchState, FormData>(createBranch, undefined);

  return (
    <form action={action} className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('code')}</label>
        <input name="code" required className={field} placeholder="CAFE-BSR" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('governorate')}</label>
        <select name="governorate" defaultValue="BAGHDAD" className={field}>
          {GOVERNORATES.map((g) => (
            <option key={g} value={g}>
              {enumLabel(g, locale)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('nameEn')}</label>
        <input name="nameEn" required className={field} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('nameAr')}</label>
        <input name="nameAr" required dir="rtl" className={field} />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isFranchise" className="accent-[var(--color-primary)]" />
        {t('isFranchise')}
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
          {t('submit')}
        </button>
        {state?.ok ? <span className="text-xs font-medium text-success">{t('created')}</span> : null}
        {state?.error ? <span className="text-xs font-medium text-danger">{t(state.error)}</span> : null}
      </div>
    </form>
  );
}

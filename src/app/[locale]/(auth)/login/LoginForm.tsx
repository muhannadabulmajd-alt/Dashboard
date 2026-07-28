'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Coffee, Loader2 } from 'lucide-react';
import { authenticate, type LoginState } from '@/server/auth/actions';

export function LoginForm() {
  const t = useTranslations('login');
  const tApp = useTranslations('app');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(authenticate, undefined);

  return (
    <div className="w-full max-w-sm rounded-[var(--radius)] border border-border/80 bg-card p-6 shadow-xl shadow-roast/10">
      <div className="mb-5 flex flex-col items-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-grove text-primary-foreground">
          <Coffee className="size-6" />
        </div>
        <h1 className="text-lg font-bold text-roast">{tApp('name')}</h1>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="redirectTo" value={`/${locale}`} />
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('email')}</label>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-roast outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('password')}</label>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-roast outline-none focus:border-primary"
          />
        </div>

        {state?.error ? <p className="text-xs font-medium text-danger">{t('invalid')}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('submit')}
        </button>
      </form>
    </div>
  );
}

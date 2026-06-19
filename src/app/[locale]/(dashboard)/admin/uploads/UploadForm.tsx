'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2, Upload } from 'lucide-react';
import { importCsv, type ImportState } from '@/server/ingestion/actions';
import { IMPORT_DATASETS, type ImportDataset } from '@/server/ingestion/parsers';

const field = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function UploadForm() {
  const t = useTranslations('uploads');
  const [dataset, setDataset] = useState<ImportDataset>('products');
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsv, undefined);
  const summary = state?.summary;

  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('dataset')}</label>
          <select
            name="dataset"
            value={dataset}
            onChange={(e) => setDataset(e.target.value as ImportDataset)}
            className={field}
          >
            {IMPORT_DATASETS.map((d) => (
              <option key={d} value={d}>
                {t(`datasets.${d}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('file')}</label>
          <input name="file" type="file" accept=".csv,text/csv" required className={field} />
        </div>
        <div className="flex items-end gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t('import')}
          </button>
          <a
            href={`/api/import-template?dataset=${dataset}`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" />
            {t('template')}
          </a>
          <label className="ms-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input name="dryRun" type="checkbox" value="true" className="size-4 rounded border" />
            {t('dryRun')}
          </label>
        </div>
      </form>

      {state?.error ? <p className="text-sm font-medium text-danger">{t(state.error)}</p> : null}

      {summary ? (
        <div className="rounded-[var(--radius)] border bg-card p-4 text-sm">
          {summary.dryRun ? <p className="mb-2 font-semibold text-primary">{t('dryRunResult')}</p> : null}
          <div className="flex flex-wrap gap-4">
            <span className="text-success">
              {t('inserted')}: <b>{summary.inserted}</b>
            </span>
            <span className="text-foreground">
              {t('updated')}: <b>{summary.updated}</b>
            </span>
            <span className="text-muted-foreground">
              {t('skipped')}: <b>{summary.skipped}</b>
            </span>
            <span className={summary.errors.length ? 'text-danger' : 'text-muted-foreground'}>
              {t('errors')}: <b>{summary.errors.length}</b>
            </span>
          </div>
          {summary.errors.length ? (
            <ul className="mt-2 max-h-40 list-disc overflow-auto ps-5 text-xs text-danger">
              {summary.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {e.row ? `row ${e.row}: ` : ''}
                  {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

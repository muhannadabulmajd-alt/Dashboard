import { enumLabel, ROAST_LEVELS } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/**
 * Form fields for creating/editing a roast batch (shared by new + edit pages).
 * Batch number is the permanent key — immutable after creation (CR-5).
 */
export function batchFields(
  t: (key: string) => string,
  locale: AppLocale,
  mode: 'new' | 'edit' = 'new',
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'batchNumber', label: t('f.batchNumber'), type: 'text', required: true, disabled: mode === 'edit' },
    { name: 'origin', label: t('f.origin'), type: 'text', required: true },
    { name: 'roastDate', label: t('f.roastDate'), type: 'date' },
    { name: 'roastLevel', label: t('f.roastLevel'), type: 'select', options: opts(ROAST_LEVELS) },
    { name: 'greenInputGrams', label: t('f.green'), type: 'number', required: true, hint: t('h.greenInput') },
    { name: 'roastedOutputGrams', label: t('f.output'), type: 'number', hint: t('h.roastedOutput') },
    { name: 'qcScore', label: t('f.qc'), type: 'number', step: '0.1', hint: t('h.qcScore') },
    { name: 'qcNotes', label: t('f.qcNotes'), type: 'text' },
  ];
}

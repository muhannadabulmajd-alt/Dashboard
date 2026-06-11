import { enumLabel, GOVERNORATES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

const FRANCHISE_ONLY = { field: 'branchType', in: ['FRANCHISE'] };

/**
 * Branch / franchise fields (§13). `code` is the permanent key — editable on
 * create, immutable afterwards (§14). Franchise contact + agreement fields show
 * only when the type is Franchise.
 */
export function branchFields(
  t: (key: string) => string,
  locale: AppLocale,
  mode: 'new' | 'edit' = 'new',
  governorates?: { value: string; label: string }[],
): FieldDef[] {
  return [
    { name: 'code', label: t('code'), type: 'text', required: true, disabled: mode === 'edit', placeholder: 'CAFE-BGD', hint: t('h.code') },
    { name: 'nameEn', label: t('nameEn'), type: 'text', required: true },
    { name: 'nameAr', label: t('nameAr'), type: 'text', required: true },
    {
      name: 'branchType',
      label: t('type'),
      type: 'select',
      required: true,
      options: ['HQ', 'COMPANY', 'FRANCHISE'].map((v) => ({ value: v, label: t(`types.${v}`) })),
      hint: t('h.type'),
    },
    { name: 'governorate', label: t('governorate'), type: 'select', required: true, options: governorates ?? GOVERNORATES.map((v) => ({ value: v, label: enumLabel(v, locale) })) },
    { name: 'city', label: t('city'), type: 'text' },
    { name: 'address', label: t('address'), type: 'text' },
    { name: 'street', label: t('street'), type: 'text' },
    { name: 'phone', label: t('phone'), type: 'text', hint: t('h.contact') },
    { name: 'email', label: t('email'), type: 'email', hint: t('h.contact') },
    { name: 'managerName', label: t('managerName'), type: 'text' },
    { name: 'managerPhone', label: t('managerPhone'), type: 'text' },
    { name: 'managerEmail', label: t('managerEmail'), type: 'email' },
    { name: 'franchiseeName', label: t('franchiseeName'), type: 'text', showWhen: FRANCHISE_ONLY },
    { name: 'franchiseePhone', label: t('franchiseePhone'), type: 'text', showWhen: FRANCHISE_ONLY },
    { name: 'franchiseeEmail', label: t('franchiseeEmail'), type: 'email', showWhen: FRANCHISE_ONLY },
    { name: 'agreementStart', label: t('agreementStart'), type: 'date', showWhen: FRANCHISE_ONLY },
    { name: 'agreementEnd', label: t('agreementEnd'), type: 'date', showWhen: FRANCHISE_ONLY },
    { name: 'openingDate', label: t('openingDate'), type: 'date' },
    { name: 'operatingHours', label: t('operatingHours'), type: 'text', placeholder: '9:00–22:00' },
    { name: 'hasDelivery', label: t('hasDelivery'), type: 'checkbox' },
    { name: 'hasPos', label: t('hasPos'), type: 'checkbox' },
    { name: 'trackInventory', label: t('trackInventory'), type: 'checkbox', hint: t('trackInventoryHint') },
    { name: 'hasWarehouse', label: t('hasWarehouse'), type: 'checkbox' },
    { name: 'notes', label: t('notes'), type: 'text' },
  ];
}

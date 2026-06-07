import { enumLabel, CHANNELS, GOVERNORATES, FULFILLMENT_METHODS, ORDER_STATUSES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/** Order-level fields for the edit form (line items are managed on create). */
export function orderFields(t: (key: string) => string, locale: AppLocale): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'orderNumber', label: t('f.orderNumber'), type: 'text', required: true },
    { name: 'placedAt', label: t('f.date'), type: 'date', required: true },
    { name: 'customerExternalId', label: t('f.customer'), type: 'text' },
    { name: 'channel', label: t('f.channel'), type: 'select', required: true, options: opts(CHANNELS) },
    { name: 'governorate', label: t('f.governorate'), type: 'select', required: true, options: opts(GOVERNORATES) },
    { name: 'fulfillmentMethod', label: t('f.fulfillment'), type: 'select', required: true, options: opts(FULFILLMENT_METHODS) },
    { name: 'status', label: t('f.status'), type: 'select', required: true, options: opts(ORDER_STATUSES) },
    { name: 'deliveryFee', label: t('f.deliveryFee'), type: 'number' },
    { name: 'deliveryCost', label: t('f.deliveryCost'), type: 'number' },
  ];
}

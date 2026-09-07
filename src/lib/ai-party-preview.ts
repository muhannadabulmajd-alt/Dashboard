import type { AppLocale } from './money';

export type PartyPreviewField = { label: string; value: string };

type ExistingParty = {
  name: string;
  phone: string | null;
};

type NewParty = {
  name: string;
  type: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

const EMPTY_VALUE = '—';

function text(locale: AppLocale, en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

export function partyPreviewFields(input: {
  locale: AppLocale;
  subject: 'PARTY' | 'SUPPLIER';
  existing: ExistingParty | null;
  created: NewParty | null;
}): PartyPreviewField[] {
  const supplier = input.subject === 'SUPPLIER';
  const labels = {
    name: text(input.locale, supplier ? 'Supplier name' : 'Party name', supplier ? 'اسم المورد' : 'اسم الجهة'),
    type: text(input.locale, supplier ? 'Supplier type' : 'Party type', supplier ? 'نوع المورد' : 'نوع الجهة'),
    phone: text(input.locale, supplier ? 'Supplier phone' : 'Party phone', supplier ? 'هاتف المورد' : 'هاتف الجهة'),
    email: text(input.locale, supplier ? 'Supplier email' : 'Party email', supplier ? 'بريد المورد' : 'بريد الجهة'),
    address: text(input.locale, supplier ? 'Supplier address' : 'Party address', supplier ? 'عنوان المورد' : 'عنوان الجهة'),
    notes: text(input.locale, supplier ? 'Supplier notes' : 'Party notes', supplier ? 'ملاحظات المورد' : 'ملاحظات الجهة'),
    setup: text(input.locale, supplier ? 'Supplier setup' : 'Party setup', supplier ? 'إعداد المورد' : 'إعداد الجهة'),
  };
  if (input.created) {
    return [
      { label: labels.name, value: input.created.name },
      { label: labels.type, value: input.created.type },
      { label: labels.phone, value: input.created.phone || EMPTY_VALUE },
      { label: labels.email, value: input.created.email || EMPTY_VALUE },
      { label: labels.address, value: input.created.address || EMPTY_VALUE },
      { label: labels.notes, value: input.created.notes || EMPTY_VALUE },
      {
        label: labels.setup,
        value: text(
          input.locale,
          supplier ? 'Create new supplier with this record' : 'Create new party with this record',
          supplier ? 'إنشاء مورد جديد مع هذا السجل' : 'إنشاء جهة جديدة مع هذا السجل',
        ),
      },
    ];
  }
  if (input.existing) {
    return [
      { label: labels.name, value: input.existing.name },
      { label: labels.phone, value: input.existing.phone || EMPTY_VALUE },
    ];
  }
  return [];
}

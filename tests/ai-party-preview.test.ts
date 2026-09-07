import { describe, expect, it } from 'vitest';
import { partyPreviewFields } from '@/lib/ai-party-preview';

describe('AI finance party previews', () => {
  it('shows every supplied new-supplier field before confirmation', () => {
    const fields = partyPreviewFields({
      locale: 'en',
      subject: 'SUPPLIER',
      existing: null,
      created: {
        name: 'Baghdad Technical Services',
        type: 'SUPPLIER',
        phone: '+9647812345678',
        email: 'service@example.test',
        address: 'Karrada, Street 14',
        notes: 'Call before delivery',
      },
    });

    expect(Object.fromEntries(fields.map((field) => [field.label, field.value]))).toEqual({
      'Supplier name': 'Baghdad Technical Services',
      'Supplier type': 'SUPPLIER',
      'Supplier phone': '+9647812345678',
      'Supplier email': 'service@example.test',
      'Supplier address': 'Karrada, Street 14',
      'Supplier notes': 'Call before delivery',
      'Supplier setup': 'Create new supplier with this record',
    });
  });

  it('shows the matched party identity without inventing missing data', () => {
    expect(partyPreviewFields({
      locale: 'ar',
      subject: 'PARTY',
      existing: { name: 'شركة الاختبار', phone: null },
      created: null,
    })).toEqual([
      { label: 'اسم الجهة', value: 'شركة الاختبار' },
      { label: 'هاتف الجهة', value: '—' },
    ]);
  });
});

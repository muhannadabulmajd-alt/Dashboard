import { describe, expect, it } from 'vitest';
import { inferCustomerCandidate, recoverCustomerCandidate } from '@/lib/customer-candidate';
import { AI_EXTRACTION_EVALUATION_CASES } from '@/lib/ai-evaluations';

describe('AI order customer inference', () => {
  it('prepares an unmatched Arabic name as a new customer', () => {
    expect(inferCustomerCandidate('نور عبداللطيف')).toEqual({
      nameAr: 'نور عبداللطيف',
      segment: 'NEW',
    });
  });

  it('prepares an unmatched English name as a new customer', () => {
    expect(inferCustomerCandidate('Saba Al-Bayati')).toEqual({
      nameEn: 'Saba Al-Bayati',
      segment: 'NEW',
    });
  });

  it('extracts and normalizes an Iraqi phone alongside the customer name', () => {
    expect(inferCustomerCandidate('لبنى عدنان +964 772 374 3551')).toEqual({
      nameAr: 'لبنى عدنان',
      phone: '+9647723743551',
      segment: 'NEW',
    });
  });

  it('allows a phone-only customer while rejecting a missing Atlas customer ID as a name', () => {
    expect(inferCustomerCandidate('07800501330')).toEqual({
      phone: '+9647800501330',
      segment: 'NEW',
    });
    expect(inferCustomerCandidate('LHB-CUS-260619-0039')).toBeNull();
  });

  it('recovers a submitted customer name after a product clarification round', () => {
    expect(recoverCustomerCandidate(
      { phone: '+9647707130864' },
      [
        '- العميل: نور عبداللطيف\n- المنتج: 2 x قهوة تركية\nاضف رقم العميل\n0770 713 0864',
        'lines.0.productQuery: LHB-TRK-CRD-225-TG-MD',
      ],
    )).toEqual({
      nameAr: 'نور عبداللطيف',
      phone: '+9647707130864',
      segment: 'NEW',
    });
  });

  it('preserves an unlabelled name, phone, and address from the same request', () => {
    expect(recoverCustomerCandidate(
      { phone: '0770 713 0864' },
      ['نور عبداللطيف\nبغداد مجمع بوابة العراق\n0770 713 0864\n\nقهوة تركية وسط بالهيل عدد اثنين'],
    )).toEqual({
      nameAr: 'نور عبداللطيف',
      phone: '+9647707130864',
      address1: 'بغداد مجمع بوابة العراق',
      segment: 'NEW',
    });
  });

  it('recovers every supplied customer contact and address field after clarification', () => {
    expect(recoverCustomerCandidate(
      { phone: '+9647707130864' },
      [
        'Customer: Noor Abdul Latif\nPhone: 0770 713 0864\nEmail: noor@example.com\nAddress: Iraq Gate Complex\nGovernorate: Baghdad\nStreet: Building 12\nNotes: Call before pickup',
        'lines.0.productQuery: LHB-TRK-CRD-225-TG-MD',
      ],
    )).toEqual({
      nameEn: 'Noor Abdul Latif',
      phone: '+9647707130864',
      email: 'noor@example.com',
      governorate: 'Baghdad',
      address1: 'Iraq Gate Complex',
      street: 'Building 12',
      notes: 'Call before pickup',
      segment: 'NEW',
    });
  });

  it('does not merge an unrelated customer from an older message', () => {
    expect(recoverCustomerCandidate(
      { phone: '0770 713 0864' },
      ['العميل: سلوى دحام\n0781 110 0140'],
    )).toEqual({ phone: '+9647707130864', segment: 'NEW' });
  });

  it('recovers at least 98 percent of 150-plus bilingual customer fixtures exactly', () => {
    const exact = AI_EXTRACTION_EVALUATION_CASES.filter((testCase) => {
      const actual = recoverCustomerCandidate(
        { phone: testCase.expectedCustomer.phone },
        [testCase.prompt],
      );
      try {
        expect(actual).toEqual(testCase.expectedCustomer);
        return true;
      } catch {
        return false;
      }
    }).length;
    expect(AI_EXTRACTION_EVALUATION_CASES.length).toBeGreaterThanOrEqual(150);
    expect(exact / AI_EXTRACTION_EVALUATION_CASES.length).toBeGreaterThanOrEqual(0.98);
  });
});

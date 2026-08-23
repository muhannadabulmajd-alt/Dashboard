import { describe, expect, it } from 'vitest';
import { inferCustomerCandidate } from '@/lib/customer-candidate';

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
});

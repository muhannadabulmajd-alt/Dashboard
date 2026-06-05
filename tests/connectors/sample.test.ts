import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { buildSampleOrdersCsv } from '@/server/connectors/sample-build';
import { parseOrders } from '@/server/ingestion/parsers';

describe('sample connector CSV', () => {
  it('produces orders the ingestion parser accepts', () => {
    const csv = buildSampleOrdersCsv(
      [
        { sku: 'LH-A', price: 10000 },
        { sku: 'LH-B', price: 12000 },
      ],
      ['C-1', 'C-2'],
      6,
      'TEST',
      new Date('2026-06-01T10:00:00Z'),
    );
    const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
    const { valid, errors } = parseOrders(rows);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(6); // 6 distinct order numbers
    expect(valid.every((o) => o.lines.length >= 1)).toBe(true);
    expect(valid[0].orderNumber).toBe('SAMPLE-TEST-1');
  });
});

import { TEMPLATES } from '@/server/ingestion/parsers';

export interface SampleProduct {
  sku: string;
  price: number;
}

const GOVS = ['BAGHDAD', 'ERBIL', 'BASRA', 'NAJAF'];

/**
 * Pure: build an order-export CSV (matching the import template) simulating a
 * batch of orders "pulled" from an external store. Tested in isolation.
 */
export function buildSampleOrdersCsv(
  products: SampleProduct[],
  customerExtIds: string[],
  count: number,
  batchTag: string,
  now: Date = new Date(),
): string {
  const headers = TEMPLATES.orders.headers;
  const lines = [headers.join(',')];
  const placedAt = now.toISOString();

  for (let i = 0; i < count; i++) {
    const orderNumber = `SAMPLE-${batchTag}-${i + 1}`;
    const cust = customerExtIds.length ? customerExtIds[i % customerExtIds.length] : '';
    const gov = GOVS[i % GOVS.length];
    const lineCount = (i % 2) + 1;
    for (let l = 0; l < lineCount; l++) {
      const p = products[(i + l) % products.length];
      const qty = (i % 3) + 1;
      lines.push(
        [
          orderNumber,
          placedAt,
          cust,
          'ONLINE_STORE',
          gov,
          'COURIER',
          'COMPLETED',
          p.sku,
          String(qty),
          String(p.price),
          '0',
          '4000',
          '5000',
        ].join(','),
      );
    }
  }
  return lines.join('\n');
}

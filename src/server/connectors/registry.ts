import 'server-only';
import type { ConnectorType } from '@prisma/client';
import { prisma } from '@/server/db/client';
import type { ImportDataset } from '@/server/ingestion/parsers';
import { buildSampleOrdersCsv } from './sample-build';

export interface ConnectorPayload {
  dataset: ImportDataset;
  csv: string;
}

/** The working sample connector: pulls a batch of orders from the live catalog. */
async function sampleOrdersSource(): Promise<ConnectorPayload> {
  const [products, customers] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, take: 12, select: { sku: true, sellingPrice: true } }),
    prisma.customer.findMany({ where: { externalId: { not: null } }, take: 20, select: { externalId: true } }),
  ]);
  const csv = buildSampleOrdersCsv(
    products.map((p) => ({ sku: p.sku, price: p.sellingPrice })),
    customers.map((c) => c.externalId!),
    6,
    String(Date.now()),
  );
  return { dataset: 'orders', csv };
}

/**
 * Resolve a connector type to a data source. Only SAMPLE is wired; real
 * integrations (Shopify/Odoo/POS/courier) throw until credentials/endpoints are
 * configured — they would slot in here behind the same payload interface.
 */
export async function resolveConnectorSource(type: ConnectorType): Promise<ConnectorPayload> {
  switch (type) {
    case 'SAMPLE':
      return sampleOrdersSource();
    default:
      throw new Error(`Connector "${type}" is not configured (no live credentials/endpoint).`);
  }
}

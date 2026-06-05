import 'server-only';
import type { ConnectorType } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { decryptSecret } from '@/server/crypto';
import { IMPORT_DATASETS, type ImportDataset } from '@/server/ingestion/parsers';
import { buildSampleOrdersCsv } from './sample-build';

export interface ConnectorPayload {
  dataset: ImportDataset;
  csv: string;
}

/** The built-in sample connector: pulls a batch of orders from the live catalog. */
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

interface HttpConfig {
  url?: string;
  dataset?: string;
  tokenEnc?: string;
}

/** Real credentialed connector: fetch a CSV from a configured URL (optional bearer token). */
async function httpCsvSource(config: HttpConfig): Promise<ConnectorPayload> {
  const dataset = config.dataset as ImportDataset | undefined;
  if (!config.url) throw new Error('connector has no URL configured');
  if (!dataset || !IMPORT_DATASETS.includes(dataset)) throw new Error(`invalid dataset "${config.dataset}"`);

  const headers: Record<string, string> = {};
  if (config.tokenEnc) headers.Authorization = `Bearer ${decryptSecret(config.tokenEnc)}`;

  const res = await fetch(config.url, { headers });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  return { dataset, csv: await res.text() };
}

/**
 * Resolve a connector to a data source. SAMPLE and HTTP_CSV are wired; other
 * integrations (Shopify/Odoo/POS/courier) throw until implemented behind this
 * same interface.
 */
export async function resolveConnectorSource(connector: {
  type: ConnectorType;
  config: unknown;
}): Promise<ConnectorPayload> {
  switch (connector.type) {
    case 'SAMPLE':
      return sampleOrdersSource();
    case 'HTTP_CSV':
      return httpCsvSource((connector.config ?? {}) as HttpConfig);
    default:
      throw new Error(`Connector "${connector.type}" is not configured (no live credentials/endpoint).`);
  }
}

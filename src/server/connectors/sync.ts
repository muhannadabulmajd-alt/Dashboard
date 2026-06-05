import 'server-only';
import { prisma } from '@/server/db/client';
import { ingestCsv } from '@/server/ingestion/ingest';
import { resolveConnectorSource } from './registry';

export interface SyncResult {
  connectorId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  inserted: number;
  updated: number;
  skipped: number;
  message?: string;
}

/** Run one connector: pull its payload and ingest it through the dedup path. */
export async function runConnectorSync(connectorId: string): Promise<SyncResult> {
  const connector = await prisma.connector.findUnique({ where: { id: connectorId } });
  if (!connector) throw new Error('connector not found');

  const run = await prisma.syncRun.create({ data: { connectorId, status: 'SUCCESS' } });
  try {
    if (connector.status !== 'ACTIVE') throw new Error('connector is paused');

    const { dataset, csv } = await resolveConnectorSource(connector.type);
    const summary = await ingestCsv(dataset, csv, {
      userId: null,
      branchId: null,
      fileName: `${connector.name} sync`,
    });
    const status = summary.errors.length ? 'PARTIAL' : 'SUCCESS';

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        rowsInserted: summary.inserted,
        rowsUpdated: summary.updated,
        rowsSkipped: summary.skipped,
        message: summary.errors.length ? `${summary.errors.length} row error(s)` : null,
      },
    });
    await prisma.connector.update({ where: { id: connector.id }, data: { lastSyncAt: new Date() } });

    return {
      connectorId,
      status,
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: summary.skipped,
      message: summary.errors.length ? `${summary.errors.length} errors` : undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'sync failed';
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: 'FAILED', message },
    });
    return { connectorId, status: 'FAILED', inserted: 0, updated: 0, skipped: 0, message };
  }
}

/** Run every active connector (used by the scheduled sync endpoint). */
export async function runAllActiveConnectors(): Promise<SyncResult[]> {
  const active = await prisma.connector.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  const results: SyncResult[] = [];
  for (const c of active) results.push(await runConnectorSync(c.id));
  return results;
}

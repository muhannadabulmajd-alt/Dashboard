import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { encryptSecret } from '@/server/crypto';

export interface ConfigureInput {
  url?: string;
  token?: string; // plaintext; encrypted before storage
  dataset?: string;
  status?: 'ACTIVE' | 'PAUSED';
}

/** Update a connector's config (encrypting any new secret) and status. */
export async function configureConnector(id: string, input: ConfigureInput): Promise<void> {
  const connector = await prisma.connector.findUnique({ where: { id } });
  if (!connector) throw new Error('connector not found');

  const config: Record<string, unknown> = { ...((connector.config as Record<string, unknown>) ?? {}) };
  if (input.url !== undefined) config.url = input.url;
  if (input.dataset !== undefined) config.dataset = input.dataset;
  if (input.token) config.tokenEnc = encryptSecret(input.token); // only re-encrypt when a new token is supplied

  const data: Prisma.ConnectorUpdateInput = { config: config as Prisma.InputJsonValue };
  if (input.status) data.status = input.status;

  await prisma.connector.update({ where: { id }, data });
}

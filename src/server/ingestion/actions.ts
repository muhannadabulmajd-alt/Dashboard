'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { ingestCsv } from './ingest';
import { IMPORT_DATASETS, type ImportDataset, type IngestSummary } from './parsers';

export type ImportState = { summary?: IngestSummary; error?: string } | undefined;

export async function importCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'upload:data')) return { error: 'forbidden' };

  const dataset = String(formData.get('dataset') ?? '') as ImportDataset;
  if (!IMPORT_DATASETS.includes(dataset)) return { error: 'invalid' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'nofile' };

  const text = await file.text();
  const summary = await ingestCsv(dataset, text, {
    userId: user.id,
    branchId: user.branchId,
    fileName: file.name,
  });

  revalidatePath('/[locale]/(dashboard)/admin/uploads', 'page');
  return { summary };
}

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { ingestCsv } from '@/server/ingestion/ingest';
import { IMPORT_DATASETS, type ImportDataset } from '@/server/ingestion/parsers';

// Programmatic CSV import (same core as the admin upload form): multipart form
// with `dataset` and a `file`. Returns the ingest summary as JSON.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'upload:data')) return new NextResponse('Forbidden', { status: 403 });

  const form = await req.formData();
  const dataset = String(form.get('dataset') ?? '') as ImportDataset;
  if (!IMPORT_DATASETS.includes(dataset)) return new NextResponse('Bad dataset', { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return new NextResponse('Missing file', { status: 400 });

  const summary = await ingestCsv(dataset, await file.text(), {
    userId: user.id,
    branchId: user.branchId,
    fileName: file.name,
  });
  return NextResponse.json(summary);
}

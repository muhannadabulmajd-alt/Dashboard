import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { TEMPLATES, IMPORT_DATASETS, type ImportDataset } from '@/server/ingestion/parsers';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'upload:data')) return new NextResponse('Forbidden', { status: 403 });

  const dataset = req.nextUrl.searchParams.get('dataset') as ImportDataset;
  if (!IMPORT_DATASETS.includes(dataset)) return new NextResponse('Bad dataset', { status: 400 });

  const { headers, example } = TEMPLATES[dataset];
  const csv = '﻿' + [headers.join(','), example.join(',')].join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="laheeb-template-${dataset}.csv"`,
    },
  });
}

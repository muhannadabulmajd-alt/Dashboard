import 'server-only';
import { NextResponse } from 'next/server';
import { can } from '@/lib/rbac';
import { getCurrentUser, type CurrentUser } from '@/server/auth/session';

export async function requireTelegramAdmin(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!['OWNER', 'ADMIN'].includes(user.role) || !can(user.role, 'manage:connectors')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return user;
}

export function isTelegramAdminResponse(value: CurrentUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

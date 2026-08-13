import 'server-only';
import { NextResponse } from 'next/server';
import { can } from '@/lib/rbac';
import { getCurrentUser, type CurrentUser } from '@/server/auth/session';
import { getAiAssistantConfig } from './config';

export async function requireAiApiUser(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!['OWNER', 'ADMIN'].includes(user.role) || !can(user.role, 'use:ai-assistant')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const config = getAiAssistantConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: 'assistant_disabled' }, { status: 503 });
  }
  if (!config.apiKeyConfigured) {
    return NextResponse.json({ error: 'assistant_not_configured' }, { status: 503 });
  }
  return user;
}

export function isHttpResponse(value: CurrentUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

import 'server-only';
import type { CurrentUser } from '@/server/auth/session';

const trustedCommandContexts = new WeakSet<object>();

export type TrustedCommandContext = {
  actor: CurrentUser;
};

export function createTrustedCommandContext(actor: CurrentUser): TrustedCommandContext {
  const context = { actor };
  trustedCommandContexts.add(context);
  return context;
}

export function getTrustedCommandActor(context?: TrustedCommandContext): CurrentUser | null {
  if (!context || !trustedCommandContexts.has(context)) return null;
  return context.actor;
}

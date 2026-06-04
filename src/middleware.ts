import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

// Locale resolution + [locale] prefixing. Authentication and role gating are
// enforced in the dashboard layout and per-page guards (server components), so
// no Node-only code runs in the edge middleware.
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

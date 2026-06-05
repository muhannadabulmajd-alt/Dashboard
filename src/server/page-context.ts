import 'server-only';
import { requireUser, requireCapability } from '@/server/auth/rbac';
import { buildBranchScope, rangeFor } from '@/server/filters/where-builder';
import { parseFilters } from '@/lib/filters';
import type { Capability } from '@/lib/rbac';
import type { AppLocale } from '@/lib/money';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Resolve locale, authenticated user, filters, branch scope and date range. */
export async function getPageContext(
  params: Params,
  searchParams: SearchParams,
  capability?: Capability,
) {
  const { locale } = await params;
  const sp = await searchParams;
  const user = capability ? await requireCapability(locale, capability) : await requireUser(locale);
  const filters = parseFilters(sp);
  const scope = buildBranchScope(user);
  const range = rangeFor(filters);
  return { locale: locale as AppLocale, user, filters, scope, range };
}

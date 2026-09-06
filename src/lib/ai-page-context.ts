import { z } from 'zod';

export const AI_PAGE_CONTEXT_MAX_LENGTH = 600;

export const AI_PAGE_CONTEXT_SECTIONS = [
  'dashboard',
  'sales',
  'orders',
  'products',
  'customers',
  'productBuyers',
  'inventory',
  'roastery',
  'delivery',
  'finance',
  'spending',
  'accounts',
  'dues',
  'ledger',
  'offers',
  'dashboards',
  'compare',
  'franchise',
  'administration',
] as const;

export type AiPageContextSection = typeof AI_PAGE_CONTEXT_SECTIONS[number];

export type AiPageContext = {
  path: string;
  section: AiPageContextSection;
};

const SAFE_QUERY_KEYS = new Set([
  'range',
  'from',
  'to',
  'channel',
  'governorate',
  'productLine',
  'grind',
  'roastLevel',
  'sizeLabel',
  'productGroup',
  'segment',
  'fulfillment',
  'sku',
  'branchId',
  'product',
  'query',
  'status',
  'tab',
]);

const ROUTE_SECTIONS: Array<{ path: string; section: AiPageContextSection }> = [
  { path: '/customers/product-buyers', section: 'productBuyers' },
  { path: '/admin/records/product-groups', section: 'products' },
  { path: '/admin/records/products', section: 'products' },
  { path: '/admin/records/customers', section: 'customers' },
  { path: '/admin/records/inventory', section: 'inventory' },
  { path: '/admin/records/batches', section: 'roastery' },
  { path: '/admin/records/orders', section: 'orders' },
  { path: '/finance/online-payments', section: 'finance' },
  { path: '/finance/shareholders', section: 'finance' },
  { path: '/finance/reports', section: 'finance' },
  { path: '/finance/accounts', section: 'accounts' },
  { path: '/finance/parties', section: 'finance' },
  { path: '/finance/ledger', section: 'ledger' },
  { path: '/finance/dues', section: 'dues' },
  { path: '/finance/spend', section: 'spending' },
  { path: '/dashboard-builder', section: 'dashboards' },
  { path: '/admin', section: 'administration' },
  { path: '/fulfillment', section: 'delivery' },
  { path: '/inventory', section: 'inventory' },
  { path: '/customers', section: 'customers' },
  { path: '/roastery', section: 'roastery' },
  { path: '/franchise', section: 'franchise' },
  { path: '/compare', section: 'compare' },
  { path: '/pnl', section: 'finance' },
  { path: '/finance', section: 'finance' },
  { path: '/offers', section: 'offers' },
  { path: '/sales', section: 'sales' },
  { path: '/', section: 'dashboard' },
];

function sectionForPath(pathname: string): AiPageContextSection | null {
  return ROUTE_SECTIONS.find((route) => (
    route.path === '/'
      ? pathname === '/'
      : pathname === route.path || pathname.startsWith(`${route.path}/`)
  ))?.section ?? null;
}

/** Normalize a same-application route while retaining only bounded dashboard filters. */
export function resolveAiPageContext(value: string | null | undefined): AiPageContext | null {
  if (!value || value.length > AI_PAGE_CONTEXT_MAX_LENGTH || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  if (/[\r\n\\]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, 'https://atlas.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://atlas.invalid') return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/^\/(?:ar|en)(?=\/|$)/, '') || '/';
  } catch {
    return null;
  }
  pathname = pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  if (!/^\/[A-Za-z0-9_/-]*$/.test(pathname)) return null;

  const section = sectionForPath(pathname);
  if (!section || pathname === '/ai-assistant' || pathname.startsWith('/ai-assistant/')) return null;

  const safeQuery = new URLSearchParams();
  let accepted = 0;
  for (const [key, queryValue] of url.searchParams) {
    if (accepted >= 12 || !SAFE_QUERY_KEYS.has(key) || !queryValue || queryValue.length > 120) continue;
    safeQuery.append(key, queryValue);
    accepted += 1;
  }
  safeQuery.sort();
  const query = safeQuery.toString();
  return { path: `${pathname}${query ? `?${query}` : ''}`, section };
}

export const AiPageContextPathSchema = z.string()
  .trim()
  .min(1)
  .max(AI_PAGE_CONTEXT_MAX_LENGTH)
  .refine((value) => resolveAiPageContext(value) !== null, 'Invalid Atlas page context.');

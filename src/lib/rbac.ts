import type { Role } from '@prisma/client';

// Capabilities are the single source of truth for what each role may see/do.
export type Capability =
  | 'view:dashboard'
  | 'view:sales'
  | 'view:inventory'
  | 'view:roastery'
  | 'view:customers'
  | 'view:financial' // P&L, COGS, margins, expenses, cash burn
  | 'manage:users'
  | 'upload:data'
  | 'export:data'
  | 'export:financial';

const ALL: Capability[] = [
  'view:dashboard',
  'view:sales',
  'view:inventory',
  'view:roastery',
  'view:customers',
  'view:financial',
  'manage:users',
  'upload:data',
  'export:data',
  'export:financial',
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  FINANCE: [
    'view:dashboard',
    'view:sales',
    'view:inventory',
    'view:roastery',
    'view:customers',
    'view:financial',
    'export:data',
    'export:financial',
  ],
  ROASTERY_OPS: ['view:dashboard', 'view:inventory', 'view:roastery', 'export:data'],
  SALES_CRM: ['view:dashboard', 'view:sales', 'view:customers', 'export:data'],
  BRANCH_MANAGER: ['view:dashboard', 'view:sales', 'view:inventory', 'export:data'],
  FRANCHISEE_VIEWER: ['view:dashboard', 'view:sales'],
  VIEWER: ['view:dashboard', 'view:sales', 'view:inventory'],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export interface NavItem {
  href: string;
  key: string; // i18n key under `nav`
  icon: string; // lucide icon name
  capability: Capability;
}

// Navigation for the MVP. Each entry is gated by a capability.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', key: 'executive', icon: 'LayoutDashboard', capability: 'view:dashboard' },
  { href: '/sales', key: 'sales', icon: 'ShoppingBag', capability: 'view:sales' },
  { href: '/inventory', key: 'inventory', icon: 'Package', capability: 'view:inventory' },
  { href: '/pnl', key: 'pnl', icon: 'TrendingUp', capability: 'view:financial' },
  { href: '/admin/users', key: 'users', icon: 'Users', capability: 'manage:users' },
];

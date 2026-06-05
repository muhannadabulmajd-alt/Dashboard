import type { Role } from '@prisma/client';

// Capabilities are the single source of truth for what each role may see/do.
export type Capability =
  | 'view:dashboard'
  | 'view:sales'
  | 'view:inventory'
  | 'view:roastery'
  | 'view:customers'
  | 'view:fulfillment'
  | 'view:offers'
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
  'view:fulfillment',
  'view:offers',
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
    'view:fulfillment',
    'view:offers',
    'view:financial',
    'export:data',
    'export:financial',
  ],
  ROASTERY_OPS: ['view:dashboard', 'view:inventory', 'view:roastery', 'view:fulfillment', 'export:data'],
  SALES_CRM: [
    'view:dashboard',
    'view:sales',
    'view:customers',
    'view:fulfillment',
    'view:offers',
    'export:data',
  ],
  BRANCH_MANAGER: ['view:dashboard', 'view:sales', 'view:inventory', 'view:fulfillment', 'export:data'],
  FRANCHISEE_VIEWER: ['view:dashboard', 'view:sales'],
  VIEWER: [
    'view:dashboard',
    'view:sales',
    'view:inventory',
    'view:customers',
    'view:fulfillment',
    'view:offers',
  ],
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

// Navigation. Each entry is gated by a capability.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', key: 'executive', icon: 'LayoutDashboard', capability: 'view:dashboard' },
  { href: '/sales', key: 'sales', icon: 'ShoppingBag', capability: 'view:sales' },
  { href: '/roastery', key: 'roastery', icon: 'Flame', capability: 'view:roastery' },
  { href: '/inventory', key: 'inventory', icon: 'Package', capability: 'view:inventory' },
  { href: '/customers', key: 'customers', icon: 'UsersRound', capability: 'view:customers' },
  { href: '/fulfillment', key: 'fulfillment', icon: 'Truck', capability: 'view:fulfillment' },
  { href: '/offers', key: 'offers', icon: 'Percent', capability: 'view:offers' },
  { href: '/pnl', key: 'pnl', icon: 'TrendingUp', capability: 'view:financial' },
  { href: '/compare', key: 'compare', icon: 'Scale', capability: 'view:dashboard' },
  { href: '/admin/uploads', key: 'uploads', icon: 'Upload', capability: 'upload:data' },
  { href: '/admin/users', key: 'users', icon: 'Users', capability: 'manage:users' },
];

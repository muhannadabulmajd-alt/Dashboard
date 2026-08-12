import type { Role } from '@prisma/client';

// Capabilities are the single source of truth for what each role may see/do.
export type Capability =
  | 'view:dashboard'
  | 'view:dashboard-builder'
  | 'manage:dashboards'
  | 'export:dashboards'
  | 'view:sales'
  | 'view:inventory'
  | 'view:roastery'
  | 'view:customers'
  | 'view:fulfillment'
  | 'view:offers'
  | 'view:franchise'
  | 'view:financial' // P&L, COGS, margins, expenses, cash burn
  | 'view:finance' // finance/accounting section
  | 'manage:finance' // record finance entries, accounts, parties
  | 'view:records' // back-office: browse/manage raw records
  | 'manage:products'
  | 'manage:customers'
  | 'manage:orders'
  | 'manage:inventory'
  | 'manage:batches'
  | 'manage:users'
  | 'manage:branches'
  | 'manage:connectors'
  | 'manage:lists'
  | 'upload:data'
  | 'export:data'
  | 'export:financial';

const ALL: Capability[] = [
  'view:dashboard',
  'view:dashboard-builder',
  'manage:dashboards',
  'export:dashboards',
  'view:sales',
  'view:inventory',
  'view:roastery',
  'view:customers',
  'view:fulfillment',
  'view:offers',
  'view:franchise',
  'view:financial',
  'view:finance',
  'manage:finance',
  'view:records',
  'manage:products',
  'manage:customers',
  'manage:orders',
  'manage:inventory',
  'manage:batches',
  'manage:users',
  'manage:branches',
  'manage:connectors',
  'manage:lists',
  'upload:data',
  'export:data',
  'export:financial',
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  FINANCE: [
    'view:dashboard',
    'view:dashboard-builder',
    'manage:dashboards',
    'export:dashboards',
    'view:sales',
    'view:inventory',
    'view:roastery',
    'view:customers',
    'view:fulfillment',
    'view:offers',
    'view:franchise',
    'view:financial',
    'view:finance',
    'manage:finance',
    'view:records',
    'manage:products',
    'manage:customers',
    'manage:orders',
    'manage:inventory',
    'manage:batches',
    'export:data',
    'export:financial',
  ],
  ROASTERY_OPS: [
    'view:dashboard',
    'view:dashboard-builder',
    'manage:dashboards',
    'export:dashboards',
    'view:inventory',
    'view:roastery',
    'view:fulfillment',
    'view:records',
    'manage:products',
    'manage:inventory',
    'manage:batches',
    'export:data',
  ],
  SALES_CRM: [
    'view:dashboard',
    'view:dashboard-builder',
    'manage:dashboards',
    'export:dashboards',
    'view:sales',
    'view:customers',
    'view:fulfillment',
    'view:offers',
    'view:records',
    'manage:products',
    'manage:customers',
    'manage:orders',
    'export:data',
  ],
  BRANCH_MANAGER: [
    'view:dashboard',
    'view:dashboard-builder',
    'manage:dashboards',
    'export:dashboards',
    'view:sales',
    'view:inventory',
    'view:fulfillment',
    'view:franchise',
    'view:records',
    'manage:customers',
    'manage:orders',
    'manage:inventory',
    'export:data',
  ],
  FRANCHISEE_VIEWER: ['view:dashboard', 'view:dashboard-builder', 'view:sales', 'view:franchise'],
  VIEWER: [
    'view:dashboard',
    'view:dashboard-builder',
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

export type NavGroupKey = 'overview' | 'sales' | 'operations' | 'finance' | 'admin';

export interface NavItem {
  href: string;
  key: string; // i18n key under `nav`
  icon: string; // lucide icon name
  capability: Capability;
  group: NavGroupKey;
}

// Sidebar groups, in display order. Every section starts collapsed so the
// navigation remains quick to scan on desktop and mobile.
export const NAV_GROUPS: { key: NavGroupKey; defaultOpen: boolean }[] = [
  { key: 'overview', defaultOpen: false },
  { key: 'sales', defaultOpen: false },
  { key: 'operations', defaultOpen: false },
  { key: 'finance', defaultOpen: false },
  { key: 'admin', defaultOpen: false },
];

// Navigation. Each entry is gated by a capability and lives in one group.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', key: 'executive', icon: 'LayoutDashboard', capability: 'view:dashboard', group: 'overview' },
  { href: '/dashboard-builder', key: 'dashboardBuilder', icon: 'FileBarChart2', capability: 'view:dashboard-builder', group: 'overview' },
  { href: '/compare', key: 'compare', icon: 'Scale', capability: 'view:dashboard', group: 'overview' },
  { href: '/franchise', key: 'franchise', icon: 'Store', capability: 'view:franchise', group: 'overview' },
  { href: '/sales', key: 'sales', icon: 'ShoppingBag', capability: 'view:sales', group: 'sales' },
  { href: '/customers', key: 'customers', icon: 'UsersRound', capability: 'view:customers', group: 'sales' },
  { href: '/offers', key: 'offers', icon: 'Percent', capability: 'view:offers', group: 'sales' },
  { href: '/fulfillment', key: 'fulfillment', icon: 'Truck', capability: 'view:fulfillment', group: 'sales' },
  { href: '/roastery', key: 'roastery', icon: 'Flame', capability: 'view:roastery', group: 'operations' },
  { href: '/inventory', key: 'inventory', icon: 'Package', capability: 'view:inventory', group: 'operations' },
  { href: '/pnl', key: 'pnl', icon: 'TrendingUp', capability: 'view:financial', group: 'finance' },
  { href: '/finance', key: 'finance', icon: 'Wallet', capability: 'view:finance', group: 'finance' },
  { href: '/finance/ledger', key: 'financeLedger', icon: 'FileBarChart2', capability: 'view:finance', group: 'finance' },
  { href: '/finance/ledger/new', key: 'financeNewRecord', icon: 'Upload', capability: 'manage:finance', group: 'finance' },
  { href: '/finance/dues', key: 'financeDues', icon: 'TrendingUp', capability: 'view:finance', group: 'finance' },
  { href: '/finance/accounts', key: 'financeAccounts', icon: 'Wallet', capability: 'view:finance', group: 'finance' },
  { href: '/finance/parties', key: 'financeParties', icon: 'UsersRound', capability: 'view:finance', group: 'finance' },
  { href: '/finance/shareholders', key: 'shareholders', icon: 'UsersRound', capability: 'view:finance', group: 'finance' },
  { href: '/finance/spend', key: 'financeSpend', icon: 'TrendingUp', capability: 'view:finance', group: 'finance' },
  { href: '/balance-sheet', key: 'balanceSheet', icon: 'FileBarChart2', capability: 'view:finance', group: 'finance' },
  { href: '/admin/records', key: 'records', icon: 'Database', capability: 'view:records', group: 'admin' },
  { href: '/admin/uploads', key: 'uploads', icon: 'Upload', capability: 'upload:data', group: 'admin' },
  { href: '/admin/connectors', key: 'connectors', icon: 'Cable', capability: 'manage:connectors', group: 'admin' },
  { href: '/admin/branches', key: 'branches', icon: 'Building2', capability: 'manage:branches', group: 'admin' },
  { href: '/admin/users', key: 'users', icon: 'Users', capability: 'manage:users', group: 'admin' },
  { href: '/admin/audit', key: 'audit', icon: 'History', capability: 'manage:users', group: 'admin' },
];

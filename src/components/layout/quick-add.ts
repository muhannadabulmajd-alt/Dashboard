import type { Role } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { can, type Capability } from '@/lib/rbac';

export type QuickAddItem = {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
};

const QUICK_ADD_ITEMS: Array<{
  key: string;
  href: string;
  capability: Capability;
  icon: string;
}> = [
  {
    key: 'order',
    href: '/admin/records/orders/new',
    capability: 'manage:orders',
    icon: 'ShoppingBag',
  },
  {
    key: 'customer',
    href: '/admin/records/customers/new',
    capability: 'manage:customers',
    icon: 'UserRoundPlus',
  },
  {
    key: 'record',
    href: '/finance/ledger/new',
    capability: 'manage:finance',
    icon: 'ReceiptText',
  },
  {
    key: 'product',
    href: '/admin/records/products/new',
    capability: 'manage:products',
    icon: 'PackagePlus',
  },
  {
    key: 'stock',
    href: '/admin/records/inventory/new',
    capability: 'manage:inventory',
    icon: 'Boxes',
  },
  {
    key: 'party',
    href: '/finance/parties/new',
    capability: 'manage:finance',
    icon: 'Building2',
  },
];

export async function getQuickAddItems(role: Role): Promise<QuickAddItem[]> {
  const t = await getTranslations('quickAdd');

  return QUICK_ADD_ITEMS.filter((item) => can(role, item.capability)).map((item) => ({
    key: item.key,
    href: item.href,
    icon: item.icon,
    label: t(`${item.key}.label`),
    description: t(`${item.key}.description`),
  }));
}

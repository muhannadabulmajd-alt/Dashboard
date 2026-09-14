import type { Role } from '@prisma/client';

const EXISTING_CUSTOMER_MANAGEMENT_ROLES: Role[] = [
  'OWNER',
  'ADMIN',
  'FINANCE',
  'SALES_CRM',
];

export function canManageExistingCustomer(role: Role): boolean {
  return EXISTING_CUSTOMER_MANAGEMENT_ROLES.includes(role);
}

export type OrderMetricRole = 'OPEN' | 'SALE' | 'RETURN' | 'CANCELED' | 'UNKNOWN';

const BUILTIN_STATUS_ROLES: Record<string, OrderMetricRole> = {
  PENDING: 'OPEN',
  COMPLETED: 'SALE',
  RETURNED: 'RETURN',
  REFUNDED: 'RETURN',
  CANCELLED: 'CANCELED',
  CANCELED: 'CANCELED',
};

export function orderStatusRole(status: string): OrderMetricRole {
  return BUILTIN_STATUS_ROLES[status] ?? 'UNKNOWN';
}

export function isCompletedSaleStatus(status: string): boolean {
  return orderStatusRole(status) === 'SALE';
}

export function isReturnStatus(status: string): boolean {
  return orderStatusRole(status) === 'RETURN';
}

import 'server-only';
import type { FulfillmentMethod } from '@prisma/client';
import { dateInputValue } from '@/lib/dates';
import { getListEntries } from '@/server/lists/resolver';

export type OrderOperationalDefaults = {
  placedAt: string;
  channel: string;
  governorate: string;
  fulfillmentMethod: FulfillmentMethod;
  status: string;
  financeMode: 'AUTO';
};

export async function getOrderOperationalDefaults(now = new Date()): Promise<OrderOperationalDefaults> {
  const [channels, governorates, fulfillment, statuses] = await Promise.all([
    getListEntries('channel'),
    getListEntries('governorate'),
    getListEntries('fulfillment'),
    getListEntries('orderStatus'),
  ]);
  const activeChannels = channels.filter((entry) => entry.isActive);
  const activeGovernorates = governorates.filter((entry) => entry.isActive);
  const activeFulfillment = fulfillment.filter((entry) => entry.isActive);
  const activeStatuses = statuses.filter((entry) => entry.isActive);
  const channel = activeChannels[0]?.code ?? 'WHATSAPP';
  const governorate = activeGovernorates.find((entry) => entry.code === 'BAGHDAD')?.code
    ?? activeGovernorates[0]?.code
    ?? 'BAGHDAD';
  const fulfillmentMethod = (activeFulfillment.find((entry) => entry.code === 'PICKUP')?.code
    ?? activeFulfillment[0]?.code
    ?? 'PICKUP') as FulfillmentMethod;
  const status = activeStatuses.find((entry) => entry.code === 'PENDING')?.code
    ?? activeStatuses.find((entry) => entry.metricRole === 'OPEN')?.code
    ?? activeStatuses[0]?.code
    ?? 'PENDING';
  return {
    placedAt: dateInputValue(now),
    channel,
    governorate,
    fulfillmentMethod,
    status,
    financeMode: 'AUTO',
  };
}

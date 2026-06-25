import { formatInTimeZone } from 'date-fns-tz';
import { TZ } from './dates';

export const ORDER_PREFIX = 'LHB-ORD';
export const CUSTOMER_PREFIX = 'LHB-CUS';

export function channelCodeForOrderNumber(channel: string): string {
  const normalized = channel.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'WHATSAPP' || normalized === 'WA' || normalized === 'SOCIAL') return 'WA';
  if (normalized === 'INSTAGRAM' || normalized === 'IG') return 'IG';
  if (normalized === 'ONLINE_STORE' || normalized === 'WEBSITE' || normalized === 'WEB') return 'WEB';
  if (normalized === 'POS' || normalized === 'CAFE' || normalized === 'WALK_IN' || normalized === 'WALKIN' || normalized === 'WIN') return 'WIN';
  if (normalized === 'PHONE' || normalized === 'PHONE_CALL' || normalized === 'CALL') return 'CALL';
  if (normalized === 'MANUAL' || normalized === 'MANUAL_INTERNAL_ORDER' || normalized === 'MAN') return 'MAN';
  if (normalized === 'RESELLERS' || normalized === 'RESELLER' || normalized === 'PARTNER' || normalized === 'RSL') return 'RSL';
  if (normalized === 'GIFT' || normalized === 'GFT') return 'GFT';
  return normalized.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'MAN';
}

export function laheebDateKey(date: Date): string {
  return formatInTimeZone(date, TZ, 'yyMMdd');
}

export function formatOrderNumber(date: Date, channel: string, sequence: number): string {
  return `${ORDER_PREFIX}-${laheebDateKey(date)}-${channelCodeForOrderNumber(channel)}-${String(sequence).padStart(4, '0')}`;
}

export function formatCustomerExternalId(date: Date, sequence: number): string {
  return `${CUSTOMER_PREFIX}-${laheebDateKey(date)}-${String(sequence).padStart(4, '0')}`;
}

import type { Currency } from '@prisma/client';
import { decimalNumber, type DecimalLike } from './decimal';

export type AppLocale = 'ar' | 'en';

// Minor units per currency. IQD is treated as having no fractional unit in
// practice; USD uses cents.
const MINOR_PER_UNIT: Record<Currency, number> = { IQD: 1, USD: 100 };
const FRACTION_DIGITS: Record<Currency, number> = { IQD: 0, USD: 2 };

/** Configurable display-only IQD -> USD rate (never used to merge currencies). */
export const USD_PER_IQD = Number(process.env.NEXT_PUBLIC_USD_PER_IQD ?? '0.00076');

function intlLocale(locale: AppLocale): string {
  return locale === 'ar' ? 'ar-IQ' : 'en-US';
}

/** Convert integer minor units to a major-unit number. */
export function toMajor(amountMinor: DecimalLike, currency: Currency): number {
  return decimalNumber(amountMinor) / MINOR_PER_UNIT[currency];
}

/** Convert a major-unit number to integer minor units. */
export function toMinor(amountMajor: number, currency: Currency): number {
  return Math.round(amountMajor * MINOR_PER_UNIT[currency]);
}

/** Format an integer minor-unit amount as a localized currency string. */
export function formatMoney(
  amountMinor: DecimalLike,
  currency: Currency,
  locale: AppLocale = 'en',
): string {
  const digits = FRACTION_DIGITS[currency];
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajor(amountMinor, currency));
}

/** Compact money format (e.g. "1.2M IQD") for dense KPI cards. */
export function formatMoneyCompact(
  amountMinor: DecimalLike,
  currency: Currency,
  locale: AppLocale = 'en',
): string {
  const value = toMajor(amountMinor, currency);
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} ${currency}`;
}

export function formatNumber(
  value: DecimalLike,
  locale: AppLocale = 'en',
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits }).format(decimalNumber(value));
}

export function formatQuantity(value: DecimalLike, locale: AppLocale = 'en'): string {
  const number = decimalNumber(value);
  const hasFraction = Math.abs(number % 1) > 0.0001;
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: hasFraction ? 3 : 0,
    maximumFractionDigits: 3,
  }).format(number);
}

/** Format a 0..1 ratio as a percentage string. */
export function formatPercent(ratio: number, locale: AppLocale = 'en', digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/** Convert an IQD amount (minor units = IQD) into USD minor units (cents). */
export function iqdToUsdMinor(iqdAmountMinor: number): number {
  return Math.round(iqdAmountMinor * USD_PER_IQD * 100);
}

/** Convert any amount (minor units) into IQD minor units at the given USD→IQD rate. */
export function convertToIqd(amountMinor: number, currency: Currency, usdToIqd: number): number {
  if (currency === 'IQD') return amountMinor;
  return Math.round((amountMinor / 100) * usdToIqd); // USD cents → dollars → IQD dinars
}

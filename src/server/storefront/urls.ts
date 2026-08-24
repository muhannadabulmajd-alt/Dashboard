export const WAYL_PAYMENT_LINK_EXPIRY = '15m' as const;
export const WAYL_PAYMENT_LINK_EXPIRY_MS = 15 * 60 * 1000;

export function storefrontCheckoutReturnUrl(input: {
  origin: string;
  locale: 'ar' | 'en';
  checkoutId: string;
}): string {
  return new URL(
    `/${input.locale}/checkout/return/${encodeURIComponent(input.checkoutId)}`,
    `${input.origin}/`,
  ).toString();
}

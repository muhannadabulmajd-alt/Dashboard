import { normalizeAssistantText } from '@/lib/ai-assistant';

export type InferredCustomerCandidate = {
  nameEn?: string;
  nameAr?: string;
  phone?: string;
  segment: 'NEW';
};

function asciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function extractIraqiMobile(value: string): { phone: string; start: number; length: number } | null {
  const match = /(?:00964|\+?964|0)?(?:[\s().-]*7)(?:[\s().-]*\d){9}/.exec(value);
  if (!match) return null;

  const digits = match[0].replace(/\D/g, '');
  const local = digits.startsWith('00964')
    ? digits.slice(5)
    : digits.startsWith('964')
      ? digits.slice(3)
      : digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  if (!/^7\d{9}$/.test(local)) return null;

  return { phone: `+964${local}`, start: match.index, length: match[0].length };
}

function resemblesAtlasCustomerId(value: string): boolean {
  const normalized = normalizeAssistantText(value);
  return /^lhb cus \d/.test(normalized) || /^cm[a-z0-9]{10,}$/i.test(value.trim());
}

/** Turn an unmatched user-facing name/phone into a safe new-customer candidate. */
export function inferCustomerCandidate(query: string): InferredCustomerCandidate | null {
  const value = asciiDigits(query).trim();
  if (!value || resemblesAtlasCustomerId(value)) return null;

  const mobile = extractIraqiMobile(value);
  const name = (mobile
    ? `${value.slice(0, mobile.start)} ${value.slice(mobile.start + mobile.length)}`
    : value)
    .replace(/[\s,;|/()[\]{}:=]+/g, ' ')
    .trim();
  const hasName = /\p{L}/u.test(name);
  if (!hasName && !mobile) return null;

  return {
    ...(hasName
      ? /[\u0600-\u06ff]/.test(name)
        ? { nameAr: name }
        : { nameEn: name }
      : {}),
    ...(mobile ? { phone: mobile.phone } : {}),
    segment: 'NEW',
  };
}

import { normalizeAssistantText } from '@/lib/ai-assistant';

export type InferredCustomerCandidate = {
  nameEn?: string;
  nameAr?: string;
  phone?: string;
  address1?: string;
  segment: 'NEW';
};

type CustomerCandidateSeed = Partial<Omit<InferredCustomerCandidate, 'segment'>>;

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

function cleanMessageLine(value: string): string {
  return asciiDigits(value)
    .replace(/\*\*/g, '')
    .replace(/^[\s\-•]+/, '')
    .trim();
}

function labeledValue(lines: string[], labels: string): string | undefined {
  const pattern = new RegExp(`^(?:${labels})\\s*[:：]\\s*(.+)$`, 'i');
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function plausibleUnlabelledName(value: string): boolean {
  if (!value || value.length > 70 || /[:：\d]/.test(value) || !/\p{L}/u.test(value)) return false;
  if (value.trim().split(/\s+/).length > 6) return false;
  const operationalTerms = /(?:طلب|منتج|قهوة|عدد|توصيل|كلفة|اجور|أجور|اجمالي|إجمالي|الدفع|القناة|الحالة|التجهيز|المحافظة|العنوان|شارع|مجمع|بغداد|اربيل|أربيل|البصرة|customer|order|product|delivery|total|address)/i;
  return !operationalTerms.test(value);
}

function candidateFromMessage(message: string): InferredCustomerCandidate | null {
  const value = asciiDigits(message);
  const lines = value.split(/\r?\n/).map(cleanMessageLine).filter(Boolean);
  const mobile = extractIraqiMobile(value);
  let name = labeledValue(lines, 'اسم العميل|اسم الزبون|العميل|الزبون|customer(?:\\s+name)?|name');
  let address1 = labeledValue(lines, 'عنوان العميل|عنوان الزبون|العنوان|customer\\s+address|address');

  if (!name && mobile) {
    const phoneLineIndex = lines.findIndex((line) => extractIraqiMobile(line)?.phone === mobile.phone);
    if (phoneLineIndex > 0) {
      name = lines.slice(0, phoneLineIndex).find(plausibleUnlabelledName);
      const lineBeforePhone = lines[phoneLineIndex - 1];
      if (lineBeforePhone && lineBeforePhone !== name && /\p{L}/u.test(lineBeforePhone)) {
        address1 = lineBeforePhone;
      }
    }
  }

  const normalizedName = name
    ?.replace(/[\s,;|/()[\]{}]+/g, ' ')
    .trim();
  if (!normalizedName && !mobile) return null;

  return {
    ...(normalizedName
      ? /[\u0600-\u06ff]/.test(normalizedName)
        ? { nameAr: normalizedName }
        : { nameEn: normalizedName }
      : {}),
    ...(mobile ? { phone: mobile.phone } : {}),
    ...(address1 ? { address1 } : {}),
    segment: 'NEW',
  };
}

function candidateName(candidate: CustomerCandidateSeed): string | undefined {
  return candidate.nameAr || candidate.nameEn;
}

function sameCandidate(left: CustomerCandidateSeed, right: CustomerCandidateSeed): boolean {
  if (left.phone && right.phone && left.phone === right.phone) return true;
  const leftName = candidateName(left);
  const rightName = candidateName(right);
  return Boolean(
    leftName
    && rightName
    && normalizeAssistantText(leftName) === normalizeAssistantText(rightName),
  );
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

/** Recover fields lost during a clarification round, anchored to the same name or phone. */
export function recoverCustomerCandidate(
  seed: CustomerCandidateSeed | null,
  recentUserMessages: string[],
): InferredCustomerCandidate | null {
  if (!seed) return null;
  let recovered: InferredCustomerCandidate = {
    ...seed,
    ...(seed.phone ? { phone: extractIraqiMobile(asciiDigits(seed.phone))?.phone ?? seed.phone } : {}),
    segment: 'NEW',
  };

  for (const message of [...recentUserMessages].reverse()) {
    const candidate = candidateFromMessage(message);
    if (!candidate || !sameCandidate(recovered, candidate)) continue;
    recovered = {
      ...candidate,
      ...recovered,
      phone: recovered.phone || candidate.phone,
      nameAr: recovered.nameAr || candidate.nameAr,
      nameEn: recovered.nameEn || candidate.nameEn,
      address1: recovered.address1 || candidate.address1,
      segment: 'NEW',
    };
  }

  return recovered;
}

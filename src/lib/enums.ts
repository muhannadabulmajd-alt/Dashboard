// Client-safe enum value lists + bilingual labels. Values mirror the Prisma
// enums exactly, but this module imports no server/Prisma runtime so it is safe
// in client components (filter bars, charts) and in unit tests.
import type { AppLocale } from './money';

export const CHANNELS = [
  'ONLINE_STORE',
  'POS',
  'CAFE',
  'WHOLESALE',
  'EVENTS',
  'SOCIAL',
  'RESELLERS',
  'CORPORATE',
] as const;

export const GOVERNORATES = [
  'BAGHDAD',
  'ERBIL',
  'BASRA',
  'NAJAF',
  'MOSUL',
  'SULAYMANIYAH',
  'KARBALA',
  'KIRKUK',
  'DUHOK',
  'OTHER',
] as const;

export const PRODUCT_LINES = [
  'TURKISH',
  'ESPRESSO',
  'FILTER',
  'DRIP_BAGS',
  'SINGLE_ORIGIN',
  'BLENDS',
  'ACCESSORIES',
] as const;

export const GRINDS = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'TURKISH', 'MOKA', 'NONE'] as const;

export const ROAST_LEVELS = ['LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'] as const;

export const CUSTOMER_SEGMENTS = [
  'NEW',
  'RETURNING',
  'LOYAL',
  'INACTIVE',
  'WHOLESALE',
  'CORPORATE',
  'FRANCHISE',
] as const;

export const FULFILLMENT_METHODS = [
  'PICKUP',
  'COURIER',
  'INTERNAL_DELIVERY',
  'B2B',
  'BRANCH_SALE',
] as const;

export const ORDER_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED', 'RETURNED', 'REFUNDED'] as const;

export const INVENTORY_CATEGORIES = [
  'GREEN_COFFEE',
  'ROASTED',
  'DRIP_BAGS',
  'PACKAGING',
  'ACCESSORY',
] as const;

export const EXPENSE_CATEGORY_TYPES = [
  'GREEN_COFFEE',
  'PACKAGING',
  'SHIPPING',
  'SALARIES',
  'RENT',
  'MARKETING',
  'UTILITIES',
  'TECH',
  'MAINTENANCE',
  'EQUIPMENT',
  'OVERHEAD',
] as const;

export const ROLES = [
  'OWNER',
  'ADMIN',
  'ROASTERY_OPS',
  'FINANCE',
  'SALES_CRM',
  'BRANCH_MANAGER',
  'FRANCHISEE_VIEWER',
  'VIEWER',
] as const;

// --- Bilingual labels -------------------------------------------------------

type Label = { en: string; ar: string };

export const ENUM_LABELS: Record<string, Label> = {
  // Channels
  ONLINE_STORE: { en: 'Online store', ar: 'المتجر الإلكتروني' },
  POS: { en: 'POS', ar: 'نقطة البيع' },
  CAFE: { en: 'Cafe', ar: 'المقهى' },
  WHOLESALE: { en: 'Wholesale', ar: 'الجملة' },
  EVENTS: { en: 'Events', ar: 'الفعاليات' },
  SOCIAL: { en: 'Social orders', ar: 'طلبات السوشيال' },
  RESELLERS: { en: 'Resellers', ar: 'الموزّعون' },
  CORPORATE: { en: 'Corporate', ar: 'الشركات' },
  // Governorates
  BAGHDAD: { en: 'Baghdad', ar: 'بغداد' },
  ERBIL: { en: 'Erbil', ar: 'أربيل' },
  BASRA: { en: 'Basra', ar: 'البصرة' },
  NAJAF: { en: 'Najaf', ar: 'النجف' },
  MOSUL: { en: 'Mosul', ar: 'الموصل' },
  SULAYMANIYAH: { en: 'Sulaymaniyah', ar: 'السليمانية' },
  KARBALA: { en: 'Karbala', ar: 'كربلاء' },
  KIRKUK: { en: 'Kirkuk', ar: 'كركوك' },
  DUHOK: { en: 'Duhok', ar: 'دهوك' },
  OTHER: { en: 'Other', ar: 'أخرى' },
  // Product lines
  TURKISH: { en: 'Turkish', ar: 'تركية' },
  ESPRESSO: { en: 'Espresso', ar: 'إسبريسو' },
  FILTER: { en: 'Filter', ar: 'فلتر' },
  DRIP_BAGS: { en: 'Drip bags', ar: 'أكياس التقطير' },
  SINGLE_ORIGIN: { en: 'Single origin', ar: 'أصل واحد' },
  BLENDS: { en: 'Blends', ar: 'خلطات' },
  ACCESSORIES: { en: 'Accessories', ar: 'مستلزمات' },
  // Grinds
  WHOLE_BEAN: { en: 'Whole bean', ar: 'حبوب كاملة' },
  MOKA: { en: 'Moka pot', ar: 'موكا' },
  NONE: { en: '—', ar: '—' },
  // Roast levels
  LIGHT: { en: 'Light', ar: 'فاتح' },
  MEDIUM: { en: 'Medium', ar: 'وسط' },
  MEDIUM_DARK: { en: 'Medium-dark', ar: 'وسط-غامق' },
  DARK: { en: 'Dark', ar: 'غامق' },
  // Customer segments
  NEW: { en: 'New', ar: 'جديد' },
  RETURNING: { en: 'Returning', ar: 'عائد' },
  LOYAL: { en: 'Loyal', ar: 'وفيّ' },
  INACTIVE: { en: 'Inactive', ar: 'غير نشط' },
  FRANCHISE: { en: 'Franchise', ar: 'امتياز' },
  // Fulfillment
  PICKUP: { en: 'Pickup', ar: 'استلام' },
  COURIER: { en: 'Courier', ar: 'مندوب' },
  INTERNAL_DELIVERY: { en: 'Internal delivery', ar: 'توصيل داخلي' },
  B2B: { en: 'B2B delivery', ar: 'توصيل الشركات' },
  BRANCH_SALE: { en: 'Branch sale', ar: 'بيع الفرع' },
  // Order status
  COMPLETED: { en: 'Completed', ar: 'مكتمل' },
  CANCELLED: { en: 'Cancelled', ar: 'ملغى' },
  RETURNED: { en: 'Returned', ar: 'مُرتجع' },
  REFUNDED: { en: 'Refunded', ar: 'مُسترد' },
  // Inventory categories
  GREEN_COFFEE: { en: 'Green coffee', ar: 'بن أخضر' },
  ROASTED: { en: 'Roasted coffee', ar: 'بن محمّص' },
  PACKAGING: { en: 'Packaging', ar: 'تغليف' },
  ACCESSORY: { en: 'Accessory', ar: 'مستلزم' },
  // Expense categories
  SHIPPING: { en: 'Shipping', ar: 'الشحن' },
  SALARIES: { en: 'Salaries', ar: 'الرواتب' },
  RENT: { en: 'Rent', ar: 'الإيجار' },
  MARKETING: { en: 'Marketing', ar: 'التسويق' },
  UTILITIES: { en: 'Utilities', ar: 'الخدمات' },
  TECH: { en: 'Technology', ar: 'التقنية' },
  MAINTENANCE: { en: 'Maintenance', ar: 'الصيانة' },
  EQUIPMENT: { en: 'Equipment', ar: 'المعدات' },
  OVERHEAD: { en: 'Overhead', ar: 'نفقات عامة' },
  // Roles
  OWNER: { en: 'Owner', ar: 'المالك' },
  ADMIN: { en: 'Admin', ar: 'مشرف' },
  ROASTERY_OPS: { en: 'Roastery Ops', ar: 'عمليات التحميص' },
  SALES_CRM: { en: 'Sales / CRM', ar: 'المبيعات' },
  BRANCH_MANAGER: { en: 'Branch Manager', ar: 'مدير الفرع' },
  FRANCHISEE_VIEWER: { en: 'Franchisee', ar: 'صاحب الامتياز' },
  VIEWER: { en: 'Viewer', ar: 'مشاهد' },
  PENDING: { en: 'Pending', ar: 'قيد الانتظار' },
};

export function enumLabel(value: string | null | undefined, locale: AppLocale = 'en'): string {
  if (!value) return '—';
  return ENUM_LABELS[value]?.[locale] ?? value;
}

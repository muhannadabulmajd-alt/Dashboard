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
  'WASIT',
  'DIYALA',
  'DHI_QAR',
  'ANBAR',
  'BABYLON',
  'MAYSAN',
  'MUTHANNA',
  'DIWANIYAH',
  'SALAHUDDIN',
  'HALABJA',
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

// CR-6: customer acquisition sources. Plain strings (not a DB enum) so the list
// can grow without a migration; the value is stored as-is in campaignSource.
export const CUSTOMER_SOURCES = [
  'Instagram',
  'Facebook',
  'Website',
  'WhatsApp',
  'Referral',
  'Offline',
  'Manual',
  'Other',
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

export const CURRENCIES = ['IQD', 'USD'] as const;

export const SHIPMENT_STATUSES = ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED'] as const;

export const ACCOUNT_TYPES = ['CASH', 'BANK', 'DIGITAL_WALLET', 'PAYMENT_GATEWAY', 'OTHER'] as const;

export const PARTY_TYPES = [
  'SUPPLIER',
  'RETAILER',
  'DISTRIBUTOR',
  'PARTNER',
  'CUSTOMER',
  'SHAREHOLDER',
  'EMPLOYEE',
  'SERVICE_PROVIDER',
  'OTHER',
] as const;

export const FINANCE_TYPES = [
  'EXPENSE',
  'PURCHASE',
  'INCOME',
  'PAYMENT_IN',
  'PAYMENT_OUT',
  'CAPITAL_IN',
  'DRAWING',
  'TRANSFER',
] as const;

export const OBLIGATION_KINDS = ['PAYABLE', 'RECEIVABLE'] as const;

export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'POS',
  'ZAIN_CASH',
  'FASTPAY',
  'ASIAHAWALA',
  'ONLINE_PAYMENT',
  'CREDIT',
  'MIXED',
  'OTHER',
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
  WASIT: { en: 'Wasit', ar: 'واسط' },
  DIYALA: { en: 'Diyala', ar: 'ديالى' },
  DHI_QAR: { en: 'Dhi Qar', ar: 'ذي قار' },
  ANBAR: { en: 'Anbar', ar: 'الأنبار' },
  BABYLON: { en: 'Babylon', ar: 'بابل' },
  MAYSAN: { en: 'Maysan', ar: 'ميسان' },
  MUTHANNA: { en: 'Muthanna', ar: 'المثنى' },
  DIWANIYAH: { en: 'Diwaniyah', ar: 'الديوانية' },
  SALAHUDDIN: { en: 'Saladin', ar: 'صلاح الدين' },
  HALABJA: { en: 'Halabja', ar: 'حلبجة' },
  OTHER: { en: 'Other', ar: 'أخرى' },
  // Payment methods
  BANK_TRANSFER: { en: 'Bank transfer', ar: 'تحويل مصرفي' },
  ZAIN_CASH: { en: 'Zain Cash', ar: 'زين كاش' },
  FASTPAY: { en: 'FastPay', ar: 'فاست بي' },
  ASIAHAWALA: { en: 'AsiaHawala', ar: 'آسيا حوالة' },
  ONLINE_PAYMENT: { en: 'Online payment', ar: 'دفع إلكتروني' },
  CREDIT: { en: 'Credit / unpaid', ar: 'آجل / غير مدفوع' },
  MIXED: { en: 'Mixed payment', ar: 'دفع مختلط' },
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
  // Shipment status
  DISPATCHED: { en: 'Dispatched', ar: 'تم الإرسال' },
  IN_TRANSIT: { en: 'In transit', ar: 'قيد التوصيل' },
  DELIVERED: { en: 'Delivered', ar: 'تم التوصيل' },
  FAILED: { en: 'Failed', ar: 'فشل التوصيل' },
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
  // Finance — account types
  CASH: { en: 'Cash', ar: 'نقد' },
  BANK: { en: 'Bank', ar: 'بنك' },
  DIGITAL_WALLET: { en: 'Digital wallet', ar: 'محفظة إلكترونية' },
  PAYMENT_GATEWAY: { en: 'Payment gateway', ar: 'بوابة دفع' },
  // Finance — party types
  SUPPLIER: { en: 'Supplier', ar: 'مورّد' },
  RETAILER: { en: 'Retailer', ar: 'بائع تجزئة' },
  DISTRIBUTOR: { en: 'Distributor', ar: 'موزّع' },
  PARTNER: { en: 'Partner', ar: 'شريك' },
  CUSTOMER: { en: 'Customer', ar: 'عميل' },
  SHAREHOLDER: { en: 'Shareholder', ar: 'مساهم' },
  EMPLOYEE: { en: 'Employee', ar: 'موظف' },
  SERVICE_PROVIDER: { en: 'Service provider', ar: 'مزود خدمة' },
  // Finance — entry types
  EXPENSE: { en: 'Expense', ar: 'مصروف' },
  PURCHASE: { en: 'Purchase', ar: 'شراء' },
  INCOME: { en: 'Income', ar: 'إيراد' },
  PAYMENT_IN: { en: 'Payment received', ar: 'دفعة واردة' },
  PAYMENT_OUT: { en: 'Payment made', ar: 'دفعة صادرة' },
  CAPITAL_IN: { en: 'Capital contribution', ar: 'مساهمة رأس مال' },
  DRAWING: { en: 'Withdrawal', ar: 'سحب' },
  TRANSFER: { en: 'Transfer', ar: 'تحويل' },
  // Finance — obligation kinds
  PAYABLE: { en: 'Payable', ar: 'ذمم دائنة' },
  RECEIVABLE: { en: 'Receivable', ar: 'ذمم مدينة' },
};

export function enumLabel(value: string | null | undefined, locale: AppLocale = 'en'): string {
  if (!value) return '—';
  return ENUM_LABELS[value]?.[locale] ?? value;
}

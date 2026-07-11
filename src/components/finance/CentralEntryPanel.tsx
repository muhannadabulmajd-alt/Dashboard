'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { enumLabel, EXPENSE_CATEGORY_TYPES, INVENTORY_CATEGORIES, PARTY_TYPES, PAYMENT_METHODS } from '@/lib/enums';
import { MEASUREMENT_UNITS } from '@/lib/units';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

type Option = { value: string; label: string; type?: string };
type InventoryOption = Option & { unit: string; category: string; name: string };
type QuickCreateResult = { ok: true; id: string; label: string } | { ok: false; error: string };
type CreateAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type QuickAction = (fd: FormData) => Promise<QuickCreateResult>;
type LineType = 'INVENTORY' | 'ASSET' | 'EXPENSE' | 'SERVICE' | 'OTHER';

export type LedgerLineRow = {
  id: string;
  type: LineType;
  itemName: string;
  inventoryItemMode: 'existing' | 'new';
  inventoryItemId: string;
  newItemNameEn: string;
  newItemNameAr: string;
  newItemCategory: string;
  categoryType: string;
  assetKey: string;
  assetCategory: string;
  unit: string;
  quantity: string;
  unitCost: string;
  discount: string;
  extra: string;
  notes: string;
};

export type CentralEntryInitial = {
  recordKind?: RecordKind;
  date?: string;
  amount?: string;
  currency?: string;
  rate?: string;
  accountId?: string;
  branchId?: string;
  partyId?: string;
  paymentMode?: string;
  paidAmount?: string;
  paymentDate?: string;
  dueDate?: string;
  paymentMethod?: string;
  reference?: string;
  description?: string;
  attachmentUrl?: string;
  lines?: Partial<LedgerLineRow>[];
};

export type RecordKind =
  | 'MONEY_IN'
  | 'MONEY_OUT'
  | 'STOCK_PURCHASE'
  | 'ASSET_PURCHASE'
  | 'CUSTOMER_DUE'
  | 'SUPPLIER_DUE'
  | 'TRANSFER'
  | 'CAPITAL_IN'
  | 'DRAWING';

const input =
  'min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-roast outline-none focus:border-primary focus:bg-card';
const label = 'text-xs font-semibold text-muted-foreground';

let lineSeed = 1;

function makeLine(overrides: Partial<LedgerLineRow> = {}): LedgerLineRow {
  const id = `l${lineSeed++}`;
  const cleanOverrides = { ...overrides };
  delete cleanOverrides.id;
  return {
    id,
    type: 'INVENTORY',
    itemName: '',
    inventoryItemMode: 'existing',
    inventoryItemId: '',
    newItemNameEn: '',
    newItemNameAr: '',
    newItemCategory: 'PACKAGING',
    categoryType: 'OVERHEAD',
    assetKey: '',
    assetCategory: 'Equipment',
    unit: 'unit',
    quantity: '1.000',
    unitCost: '',
    discount: '',
    extra: '',
    notes: '',
    ...cleanOverrides,
  };
}

function moneyNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function lineTotal(row: LedgerLineRow): number {
  const total = moneyNumber(row.quantity) * moneyNumber(row.unitCost) - moneyNumber(row.discount) + moneyNumber(row.extra);
  return Math.max(0, total);
}

const KIND_LABELS: Record<RecordKind, { en: string; ar: string; hint: { en: string; ar: string } }> = {
  MONEY_IN: { en: 'Money in', ar: 'مال داخل', hint: { en: 'Cash or bank money received now.', ar: 'مبلغ استلمته الآن نقداً أو في البنك.' } },
  MONEY_OUT: { en: 'Money out', ar: 'مال خارج', hint: { en: 'A payment or normal expense.', ar: 'دفعة أو مصروف عادي.' } },
  STOCK_PURCHASE: { en: 'Vendor invoice / purchase', ar: 'فاتورة مورد / شراء', hint: { en: 'Record one invoice with stock, service, and expense lines together.', ar: 'سجل فاتورة واحدة تحتوي مخزوناً وخدمات ومصاريف معاً.' } },
  ASSET_PURCHASE: { en: 'Bought equipment / asset', ar: 'شراء معدّة / أصل', hint: { en: 'Tracks equipment in a simple asset list.', ar: 'يسجل المعدّة في قائمة أصول بسيطة.' } },
  CUSTOMER_DUE: { en: 'Customer owes us', ar: 'عميل عليه مبلغ لنا', hint: { en: 'Record money to collect later.', ar: 'مبلغ سنحصله لاحقاً.' } },
  SUPPLIER_DUE: { en: 'We owe supplier', ar: 'علينا مبلغ لمورّد', hint: { en: 'Record a bill to pay later.', ar: 'فاتورة سندفعها لاحقاً.' } },
  TRANSFER: { en: 'Move money', ar: 'نقل مال', hint: { en: 'Move money between accounts.', ar: 'نقل مبلغ بين حسابين.' } },
  CAPITAL_IN: { en: 'Owner money in', ar: 'مال من المالك', hint: { en: 'Owner/shareholder adds money.', ar: 'إضافة مال من المالك أو المساهم.' } },
  DRAWING: { en: 'Owner withdrawal', ar: 'سحب مالك', hint: { en: 'Owner/shareholder takes money out.', ar: 'سحب من المالك أو المساهم.' } },
};

const COPY = {
  en: {
    choose: 'What are you adding?',
    date: 'Date',
    amount: 'Total price / amount',
    currency: 'Currency',
    rate: 'USD to IQD rate',
    account: 'Paid from / received in',
    fromAccount: 'From account',
    toAccount: 'To account',
    branch: 'Branch',
    party: 'Person or company',
    supplier: 'Supplier',
    customer: 'Customer',
    shareholder: 'Shareholder',
    addParty: 'Add person/company',
    addCustomer: 'Add customer',
    addShareholder: 'Add shareholder',
    paymentMode: 'Payment status',
    paidNow: 'Paid now',
    payLater: 'Pay later',
    partial: 'Partially paid',
    paidAmount: 'Amount paid',
    paymentMethod: 'Payment method',
    paymentDate: 'Payment date',
    dueDate: 'Due date',
    category: 'What was this for?',
    reference: 'Invoice / reference',
    note: 'Note',
    stockItem: 'Stock item',
    lines: 'Invoice lines',
    lineType: 'Line type',
    inventoryLine: 'Inventory item',
    expenseLine: 'Expense',
    serviceLine: 'Service',
    otherLine: 'Other',
    assetLine: 'Equipment / asset',
    existingItem: 'Use existing item',
    newItem: 'Create new item',
    itemNameEn: 'Item name',
    itemNameAr: 'Arabic item name',
    itemCategory: 'Item type',
    reorderPoint: 'Reorder reminder',
    quantity: 'Total quantity',
    unit: 'Unit',
    expiryDate: 'Expiry date',
    unitCost: 'Unit price',
    discount: 'Discount',
    extra: 'Extra cost',
    lineTotal: 'Line total',
    addLine: 'Add line',
    duplicate: 'Duplicate',
    moveUp: 'Up',
    moveDown: 'Down',
    remove: 'Remove',
    total: 'Total',
    remaining: 'Remaining',
    attachment: 'Attachment link',
    assetName: 'Asset name',
    assetCategory: 'Asset type',
    assetKey: 'Asset reference',
    changeReason: 'Reason for change',
    save: 'Save changes',
    submit: 'Add record',
    cancel: 'Cancel',
    invalid: 'Please check the required fields.',
    forbidden: 'You do not have permission for this action.',
    popupName: 'Name',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    popupType: 'Type',
    savePopup: 'Save and select',
    close: 'Close',
  },
  ar: {
    choose: 'ماذا تريد أن تضيف؟',
    date: 'التاريخ',
    amount: 'المبلغ / السعر الكلي',
    currency: 'العملة',
    rate: 'سعر الدولار بالدينار',
    account: 'الحساب',
    fromAccount: 'من حساب',
    toAccount: 'إلى حساب',
    branch: 'الفرع',
    party: 'الشخص أو الشركة',
    supplier: 'المورّد',
    customer: 'العميل',
    shareholder: 'المساهم',
    addParty: 'إضافة شخص/شركة',
    addCustomer: 'إضافة عميل',
    addShareholder: 'إضافة مساهم',
    paymentMode: 'حالة الدفع',
    paidNow: 'مدفوع الآن',
    payLater: 'دفع لاحق',
    partial: 'مدفوع جزئياً',
    paidAmount: 'المبلغ المدفوع',
    paymentMethod: 'طريقة الدفع',
    paymentDate: 'تاريخ الدفع',
    dueDate: 'تاريخ الاستحقاق',
    category: 'ما الغرض من هذا؟',
    reference: 'رقم الفاتورة / المرجع',
    note: 'ملاحظة',
    stockItem: 'صنف المخزون',
    lines: 'سطور الفاتورة',
    lineType: 'نوع السطر',
    inventoryLine: 'صنف مخزون',
    expenseLine: 'مصروف',
    serviceLine: 'خدمة',
    otherLine: 'أخرى',
    assetLine: 'معدّة / أصل',
    existingItem: 'استخدام صنف موجود',
    newItem: 'إنشاء صنف جديد',
    itemNameEn: 'اسم الصنف',
    itemNameAr: 'اسم الصنف بالعربية',
    itemCategory: 'نوع الصنف',
    reorderPoint: 'تنبيه إعادة الطلب',
    quantity: 'الكمية الكلية',
    unit: 'الوحدة',
    expiryDate: 'تاريخ الانتهاء',
    unitCost: 'سعر الوحدة',
    discount: 'خصم',
    extra: 'تكلفة إضافية',
    lineTotal: 'مجموع السطر',
    addLine: 'إضافة سطر',
    duplicate: 'تكرار',
    moveUp: 'أعلى',
    moveDown: 'أسفل',
    remove: 'حذف',
    total: 'المجموع',
    remaining: 'المتبقي',
    attachment: 'رابط المرفق',
    assetName: 'اسم الأصل',
    assetCategory: 'نوع الأصل',
    assetKey: 'مرجع الأصل',
    changeReason: 'سبب التعديل',
    save: 'حفظ التعديلات',
    submit: 'إضافة السجل',
    cancel: 'إلغاء',
    invalid: 'يرجى مراجعة الحقول المطلوبة.',
    forbidden: 'ليست لديك صلاحية لهذا الإجراء.',
    popupName: 'الاسم',
    phone: 'الهاتف',
    email: 'البريد',
    address: 'العنوان',
    popupType: 'النوع',
    savePopup: 'حفظ واختيار',
    close: 'إغلاق',
  },
} as const;

function Field({
  name,
  labelText,
  type = 'text',
  required,
  value,
  onChange,
  placeholder,
  step,
}: {
  name: string;
  labelText: string;
  type?: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${name}-field`} className={label}>
        {labelText}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <input
        id={`${name}-field`}
        name={name}
        type={type}
        required={required}
        value={onChange ? value : undefined}
        defaultValue={!onChange ? value : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        step={step}
        className={input}
      />
    </div>
  );
}

function SelectField({
  name,
  labelText,
  options,
  required,
  value,
  onChange,
  empty = true,
}: {
  name: string;
  labelText: string;
  options: Option[];
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  empty?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${name}-field`} className={label}>
        {labelText}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <select
        id={`${name}-field`}
        name={name}
        required={required}
        value={onChange ? value : undefined}
        defaultValue={!onChange ? value : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={input}
      >
        {empty ? <option value="">—</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CentralEntryPanel({
  action,
  createParty,
  createCustomer,
  locale,
  today,
  accounts,
  parties,
  inventoryItems,
  branches,
  cancelHref,
  initial,
  lockKind = false,
  editMode = false,
}: {
  action: CreateAction;
  createParty: QuickAction;
  createCustomer: QuickAction;
  locale: 'ar' | 'en';
  today: string;
  accounts: Option[];
  parties: Option[];
  inventoryItems: InventoryOption[];
  branches: Option[];
  cancelHref: string;
  initial?: CentralEntryInitial;
  lockKind?: boolean;
  editMode?: boolean;
}) {
  const c = COPY[locale];
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [recordKind, setRecordKind] = useState<RecordKind>(initial?.recordKind ?? 'MONEY_IN');
  const [currency, setCurrency] = useState(initial?.currency ?? 'IQD');
  const [paymentMode, setPaymentMode] = useState(initial?.paymentMode ?? 'PAID');
  const [paidAmount, setPaidAmount] = useState(initial?.paidAmount ?? '');
  const [lines, setLines] = useState<LedgerLineRow[]>(() => initial?.lines?.length
    ? initial.lines.map((line) => makeLine(line))
    : [
      makeLine(),
      makeLine({ type: 'EXPENSE', itemName: 'Delivery fee', categoryType: 'SHIPPING', quantity: '1.000', unit: 'unit' }),
    ]);
  const [partyOptions, setPartyOptions] = useState<Option[]>(parties);
  const [partyId, setPartyId] = useState(initial?.partyId ?? '');
  const [popup, setPopup] = useState<'party' | 'customer' | null>(null);
  const [quickPending, startQuick] = useTransition();
  const [quickError, setQuickError] = useState('');
  const [popupData, setPopupData] = useState({ name: '', nameAr: '', type: 'SUPPLIER', phone: '', email: '', address: '' });

  const selectedKind = KIND_LABELS[recordKind];
  const categoryOptions = useMemo(
    () => EXPENSE_CATEGORY_TYPES.map((value) => ({ value, label: enumLabel(value, locale) })),
    [locale],
  );
  const inventoryCategoryOptions = useMemo(
    () => INVENTORY_CATEGORIES.map((value) => ({ value, label: enumLabel(value, locale) })),
    [locale],
  );
  const partyTypeOptions = useMemo(
    () => PARTY_TYPES.map((value) => ({ value, label: enumLabel(value, locale) })),
    [locale],
  );
  const unitOptions = MEASUREMENT_UNITS.map((value) => ({ value, label: value }));
  const paymentMethodOptions = useMemo(
    () => PAYMENT_METHODS.map((value) => ({ value, label: enumLabel(value, locale) })),
    [locale],
  );
  const purchaseTotal = useMemo(() => lines.reduce((sum, row) => sum + lineTotal(row), 0), [lines]);
  const paidNow = paymentMode === 'PAID' ? purchaseTotal : moneyNumber(paidAmount);
  const remaining = paymentMode === 'CREDIT' ? purchaseTotal : Math.max(0, purchaseTotal - paidNow);
  const paidTooMuch = paymentMode === 'PARTIAL' && paidNow >= purchaseTotal && purchaseTotal > 0;
  const shareholderRecord = ['CAPITAL_IN', 'DRAWING'].includes(recordKind);
  const partyKind = shareholderRecord
    ? 'SHAREHOLDER'
    : recordKind === 'CUSTOMER_DUE'
      ? 'CUSTOMER'
      : ['STOCK_PURCHASE', 'ASSET_PURCHASE', 'SUPPLIER_DUE'].includes(recordKind)
        ? 'SUPPLIER'
        : null;
  const visiblePartyOptions = partyKind
    ? partyOptions.filter((option) => !option.type || option.type === partyKind)
    : partyOptions;
  const showPaidAccount = !['CUSTOMER_DUE', 'SUPPLIER_DUE'].includes(recordKind) && (recordKind !== 'STOCK_PURCHASE' && recordKind !== 'ASSET_PURCHASE' || paymentMode === 'PAID' || paymentMode === 'PARTIAL');
  const showParty = ['STOCK_PURCHASE', 'ASSET_PURCHASE', 'CUSTOMER_DUE', 'SUPPLIER_DUE', 'MONEY_IN', 'MONEY_OUT', 'CAPITAL_IN', 'DRAWING'].includes(recordKind);

  function updateLine(id: string, patch: Partial<LedgerLineRow>) {
    setLines((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function duplicateLine(id: string) {
    const row = lines.find((entry) => entry.id === id);
    if (!row) return;
    setLines((current) => [...current, makeLine(row)]);
  }

  function moveLine(id: string, direction: -1 | 1) {
    setLines((current) => {
      const index = current.findIndex((row) => row.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      const [row] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, row);
      return copy;
    });
  }

  function removeLine(id: string) {
    setLines((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));
  }

  function savePopup() {
    const fd = new FormData();
    for (const [key, value] of Object.entries(popupData)) fd.set(key, value);
    startQuick(async () => {
      setQuickError('');
      const result = popup === 'customer' ? await createCustomer(fd) : await createParty(fd);
      if (!result.ok) {
        setQuickError(result.error);
        return;
      }
      const createdType = popup === 'customer' ? 'CUSTOMER' : popupData.type;
      setPartyOptions((current) => [...current, { value: result.id, label: result.label, type: createdType }].sort((a, b) => a.label.localeCompare(b.label)));
      setPartyId(result.id);
      setPopup(null);
      setPopupData({ name: '', nameAr: '', type: 'SUPPLIER', phone: '', email: '', address: '' });
    });
  }

  function openPartyPopup(type = 'SUPPLIER') {
    setPopupData((data) => ({ ...data, type }));
    setPopup('party');
  }

  function selectRecordKind(kind: RecordKind) {
    setRecordKind(kind);
    if (kind !== recordKind) setPartyId('');
  }

  return (
    <>
      <form action={formAction} className="space-y-5 rounded-[var(--radius)] border border-border/80 bg-card p-4 shadow-[0_1px_0_rgba(83,45,31,0.05)]">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="recordKind" value={recordKind} />
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{c.choose}</p>
            <p className="text-xs leading-5 text-muted-foreground">{selectedKind.hint[locale]}</p>
          </div>
          <div className={cn('grid gap-2 md:grid-cols-3 xl:grid-cols-4', lockKind && 'hidden')}>
            {(Object.keys(KIND_LABELS) as RecordKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => selectRecordKind(kind)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-start text-sm font-semibold transition',
                  recordKind === kind ? 'border-primary bg-primary text-primary-foreground' : 'border-border/80 bg-background hover:bg-linen/45',
                )}
              >
                {KIND_LABELS[kind][locale]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field name="date" labelText={c.date} type="date" required value={initial?.date ?? today} />
          {recordKind === 'STOCK_PURCHASE' ? null : (
            <Field name="amount" labelText={c.amount} type="number" required step="0.01" placeholder="0" value={initial?.amount} />
          )}
          <SelectField
            name="currency"
            labelText={c.currency}
            options={[
              { value: 'IQD', label: 'IQD' },
              { value: 'USD', label: 'USD' },
            ]}
            value={currency}
            onChange={setCurrency}
            empty={false}
          />
          {currency === 'USD' ? <Field name="rate" labelText={c.rate} type="number" required step="1" value={initial?.rate} /> : null}

          {recordKind === 'TRANSFER' ? (
            <>
              <SelectField name="accountId" labelText={c.fromAccount} options={accounts} required value={initial?.accountId} />
              <SelectField name="toAccountId" labelText={c.toAccount} options={accounts} required />
            </>
          ) : showPaidAccount ? (
            <SelectField name="accountId" labelText={c.account} options={accounts} required={paymentMode !== 'CREDIT'} value={initial?.accountId} />
          ) : null}

          <SelectField name="branchId" labelText={c.branch} options={branches} value={initial?.branchId} />

          {['STOCK_PURCHASE', 'ASSET_PURCHASE'].includes(recordKind) ? (
            <>
              <SelectField
                name="paymentMode"
                labelText={c.paymentMode}
                options={[
                  { value: 'PAID', label: c.paidNow },
                  { value: 'CREDIT', label: c.payLater },
                  { value: 'PARTIAL', label: c.partial },
                ]}
                value={paymentMode}
                onChange={setPaymentMode}
                empty={false}
              />
              {paymentMode === 'PARTIAL' ? (
                <>
                  <Field name="paidAmount" labelText={c.paidAmount} type="number" required step="0.01" value={paidAmount} onChange={setPaidAmount} placeholder="0" />
                  <Field name="paymentDate" labelText={c.paymentDate} type="date" value={initial?.paymentDate ?? today} />
                </>
              ) : null}
              {paymentMode !== 'PAID' ? <Field name="dueDate" labelText={c.dueDate} type="date" value={initial?.dueDate ?? today} /> : null}
            </>
          ) : null}

          {(recordKind === 'STOCK_PURCHASE' || recordKind === 'ASSET_PURCHASE') && (paymentMode === 'PAID' || paymentMode === 'PARTIAL') ? (
            <SelectField name="paymentMethod" labelText={c.paymentMethod} options={paymentMethodOptions} empty={false} value={initial?.paymentMethod} />
          ) : null}

          {['CUSTOMER_DUE', 'SUPPLIER_DUE'].includes(recordKind) ? <Field name="dueDate" labelText={c.dueDate} type="date" value={today} /> : null}

          {['MONEY_OUT', 'SUPPLIER_DUE'].includes(recordKind) ? (
            <SelectField name="categoryType" labelText={c.category} options={categoryOptions} />
          ) : null}
        </div>

        {showParty ? (
          <div className="grid gap-3 rounded-lg border border-border/80 bg-background/55 p-3 md:grid-cols-[1fr_auto_auto]">
            <SelectField
              name="partyId"
              labelText={recordKind === 'CUSTOMER_DUE' ? c.customer : shareholderRecord ? c.shareholder : recordKind === 'SUPPLIER_DUE' || recordKind === 'STOCK_PURCHASE' ? c.supplier : c.party}
              options={visiblePartyOptions}
              value={partyId}
              onChange={setPartyId}
              required={['CUSTOMER_DUE', 'SUPPLIER_DUE', 'CAPITAL_IN', 'DRAWING'].includes(recordKind)}
            />
            <button type="button" onClick={() => openPartyPopup(partyKind ?? 'SUPPLIER')} className="self-end rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted max-md:w-full">
              <Plus className="me-1 inline size-4" />
              {shareholderRecord ? c.addShareholder : c.addParty}
            </button>
            {shareholderRecord ? null : (
              <button type="button" onClick={() => setPopup('customer')} className="self-end rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted max-md:w-full">
                <Plus className="me-1 inline size-4" />
                {c.addCustomer}
              </button>
            )}
          </div>
        ) : null}

        {recordKind === 'STOCK_PURCHASE' ? (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-linen/25 p-3">
            <input type="hidden" name="lineIds" value={lines.map((row) => row.id).join(',')} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{c.lines}</h3>
                <p className="text-xs text-muted-foreground">{selectedKind.hint[locale]}</p>
              </div>
              <button
                type="button"
                onClick={() => setLines((current) => [...current, makeLine()])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 text-sm font-semibold hover:bg-muted"
              >
                <Plus className="size-4" />
                {c.addLine}
              </button>
            </div>
            <div className="space-y-3">
              {lines.map((row, index) => {
                const prefix = `line_${row.id}_`;
                const selectedInventory = inventoryItems.find((item) => item.value === row.inventoryItemId);
                return (
                  <div key={row.id} className="rounded-lg border border-border/80 bg-card p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">#{index + 1}</span>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => moveLine(row.id, -1)} className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-muted">
                          {c.moveUp}
                        </button>
                        <button type="button" onClick={() => moveLine(row.id, 1)} className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-muted">
                          {c.moveDown}
                        </button>
                        <button type="button" onClick={() => duplicateLine(row.id)} className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-muted">
                          {c.duplicate}
                        </button>
                        <button type="button" onClick={() => removeLine(row.id)} className="rounded-lg border px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-soft">
                          {c.remove}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <SelectField
                        name={`${prefix}type`}
                        labelText={c.lineType}
                        value={row.type}
                        onChange={(value) => updateLine(row.id, { type: value as LineType })}
                        options={[
                          { value: 'INVENTORY', label: c.inventoryLine },
                          { value: 'ASSET', label: c.assetLine },
                          { value: 'EXPENSE', label: c.expenseLine },
                          { value: 'SERVICE', label: c.serviceLine },
                          { value: 'OTHER', label: c.otherLine },
                        ]}
                        empty={false}
                      />
                      {row.type === 'INVENTORY' ? (
                        <>
                          <SelectField
                            name={`${prefix}inventoryItemMode`}
                            labelText={c.stockItem}
                            value={row.inventoryItemMode}
                            onChange={(value) => updateLine(row.id, { inventoryItemMode: value === 'new' ? 'new' : 'existing' })}
                            options={[
                              { value: 'existing', label: c.existingItem },
                              { value: 'new', label: c.newItem },
                            ]}
                            empty={false}
                          />
                          {row.inventoryItemMode === 'existing' ? (
                            <SelectField
                              name={`${prefix}inventoryItemId`}
                              labelText={c.stockItem}
                              value={row.inventoryItemId}
                              onChange={(value) => {
                                const item = inventoryItems.find((entry) => entry.value === value);
                                updateLine(row.id, { inventoryItemId: value, unit: item?.unit ?? row.unit, itemName: item?.name ?? row.itemName });
                              }}
                              options={inventoryItems}
                              required
                            />
                          ) : (
                            <>
                              <Field name={`${prefix}newItemNameEn`} labelText={c.itemNameEn} required value={row.newItemNameEn} onChange={(value) => updateLine(row.id, { newItemNameEn: value, itemName: value })} />
                              <Field name={`${prefix}newItemNameAr`} labelText={c.itemNameAr} value={row.newItemNameAr} onChange={(value) => updateLine(row.id, { newItemNameAr: value })} />
                              <SelectField
                                name={`${prefix}newItemCategory`}
                                labelText={c.itemCategory}
                                value={row.newItemCategory}
                                onChange={(value) => updateLine(row.id, { newItemCategory: value })}
                                options={inventoryCategoryOptions}
                                required
                                empty={false}
                              />
                            </>
                          )}
                        </>
                      ) : row.type === 'ASSET' ? (
                        <>
                          <Field name={`${prefix}itemName`} labelText={c.assetName} required value={row.itemName} onChange={(value) => updateLine(row.id, { itemName: value })} />
                          <Field name={`${prefix}assetCategory`} labelText={c.assetCategory} required value={row.assetCategory} onChange={(value) => updateLine(row.id, { assetCategory: value })} />
                          <Field name={`${prefix}assetKey`} labelText={c.assetKey} value={row.assetKey} onChange={(value) => updateLine(row.id, { assetKey: value })} />
                        </>
                      ) : (
                        <>
                          <Field name={`${prefix}itemName`} labelText={c.itemNameEn} required value={row.itemName} onChange={(value) => updateLine(row.id, { itemName: value })} />
                          <SelectField
                            name={`${prefix}categoryType`}
                            labelText={c.category}
                            value={row.categoryType}
                            onChange={(value) => updateLine(row.id, { categoryType: value })}
                            options={categoryOptions}
                            required
                            empty={false}
                          />
                        </>
                      )}
                      {row.type === 'INVENTORY' ? (
                        <input type="hidden" name={`${prefix}itemName`} value={row.itemName || selectedInventory?.name || ''} />
                      ) : null}
                      <Field name={`${prefix}quantity`} labelText={c.quantity} type="number" required step="0.001" value={row.quantity} onChange={(value) => updateLine(row.id, { quantity: value })} placeholder="0.000" />
                      <SelectField name={`${prefix}unit`} labelText={c.unit} options={unitOptions} required value={row.unit} onChange={(value) => updateLine(row.id, { unit: value })} empty={false} />
                      <Field name={`${prefix}unitCost`} labelText={c.unitCost} type="number" required step="0.01" value={row.unitCost} onChange={(value) => updateLine(row.id, { unitCost: value })} placeholder="0" />
                      <Field name={`${prefix}discount`} labelText={c.discount} type="number" step="0.01" value={row.discount} onChange={(value) => updateLine(row.id, { discount: value })} placeholder="0" />
                      <Field name={`${prefix}extra`} labelText={c.extra} type="number" step="0.01" value={row.extra} onChange={(value) => updateLine(row.id, { extra: value })} placeholder="0" />
                      <Field name={`${prefix}notes`} labelText={c.note} value={row.notes} onChange={(value) => updateLine(row.id, { notes: value })} />
                      <div className="flex flex-col justify-end gap-1">
                        <span className={label}>{c.lineTotal}</span>
                        <div className="min-h-10 rounded-lg border border-border/80 bg-muted/45 px-3 py-2 text-sm font-semibold text-foreground">
                          {lineTotal(row).toLocaleString(locale === 'ar' ? 'ar-IQ' : 'en-US')} {currency}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-3 rounded-lg border border-border/80 bg-background/70 p-3 text-sm font-semibold md:grid-cols-3">
              <div>{c.total}: {purchaseTotal.toLocaleString(locale === 'ar' ? 'ar-IQ' : 'en-US')} {currency}</div>
              <div>{c.paidAmount}: {paidNow.toLocaleString(locale === 'ar' ? 'ar-IQ' : 'en-US')} {currency}</div>
              <div>{c.remaining}: {remaining.toLocaleString(locale === 'ar' ? 'ar-IQ' : 'en-US')} {currency}</div>
              {paidTooMuch ? <p className="text-danger md:col-span-3">{c.invalid}</p> : null}
            </div>
          </div>
        ) : null}

        {recordKind === 'ASSET_PURCHASE' ? (
          <div className="grid gap-4 rounded-lg border border-primary/20 bg-linen/25 p-3 md:grid-cols-2 xl:grid-cols-3">
            <Field name="assetName" labelText={c.assetName} required />
            <Field name="assetCategory" labelText={c.assetCategory} placeholder="Equipment" />
            <Field name="quantity" labelText={c.quantity} type="number" required step="0.001" placeholder="1.000" />
            <SelectField name="unit" labelText={c.unit} options={unitOptions} required empty={false} />
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Field name="reference" labelText={c.reference} value={initial?.reference} />
          <Field name="description" labelText={c.note} value={initial?.description} />
          <Field name="attachmentUrl" labelText={c.attachment} type="url" value={initial?.attachmentUrl} />
          {editMode ? <Field name="changeReason" labelText={c.changeReason} required /> : null}
        </div>

        {state?.error ? (
          <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            {state.error === 'forbidden' ? c.forbidden : c.invalid}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-border/80 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90 disabled:opacity-60 max-sm:w-full"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editMode ? c.save : c.submit}
          </button>
          <Link href={cancelHref} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border/80 bg-card px-4 py-2 text-sm font-semibold text-roast hover:bg-linen/45 max-sm:w-full">
            {c.cancel}
          </Link>
        </div>
      </form>

      {popup ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius)] border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{popup === 'customer' ? c.addCustomer : c.addParty}</h2>
              <button type="button" onClick={() => setPopup(null)} className="rounded-lg border p-2 hover:bg-muted" aria-label={c.close}>
                <X className="size-4" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field name="quickName" labelText={c.popupName} required value={popupData.name} onChange={(value) => setPopupData((data) => ({ ...data, name: value }))} />
              {popup === 'customer' ? (
                <Field name="quickNameAr" labelText={c.itemNameAr} value={popupData.nameAr} onChange={(value) => setPopupData((data) => ({ ...data, nameAr: value }))} />
              ) : (
                <SelectField
                  name="quickType"
                  labelText={c.popupType}
                  options={partyTypeOptions}
                  value={popupData.type}
                  onChange={(value) => setPopupData((data) => ({ ...data, type: value }))}
                  empty={false}
                />
              )}
              <Field name="quickPhone" labelText={c.phone} value={popupData.phone} onChange={(value) => setPopupData((data) => ({ ...data, phone: value }))} />
              <Field name="quickEmail" labelText={c.email} type="email" value={popupData.email} onChange={(value) => setPopupData((data) => ({ ...data, email: value }))} />
              <div className="md:col-span-2">
                <Field name="quickAddress" labelText={c.address} value={popupData.address} onChange={(value) => setPopupData((data) => ({ ...data, address: value }))} />
              </div>
            </div>
            {quickError ? <p className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">{quickError}</p> : null}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPopup(null)} className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted">
                {c.cancel}
              </button>
              <button type="button" onClick={savePopup} disabled={quickPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {quickPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {c.savePopup}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

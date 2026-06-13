'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { enumLabel, EXPENSE_CATEGORY_TYPES, INVENTORY_CATEGORIES, PARTY_TYPES } from '@/lib/enums';
import { MEASUREMENT_UNITS } from '@/lib/units';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

type Option = { value: string; label: string };
type InventoryOption = Option & { unit: string; category: string };
type QuickCreateResult = { ok: true; id: string; label: string } | { ok: false; error: string };
type CreateAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type QuickAction = (fd: FormData) => Promise<QuickCreateResult>;

type RecordKind =
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

const KIND_LABELS: Record<RecordKind, { en: string; ar: string; hint: { en: string; ar: string } }> = {
  MONEY_IN: { en: 'Money in', ar: 'مال داخل', hint: { en: 'Cash or bank money received now.', ar: 'مبلغ استلمته الآن نقداً أو في البنك.' } },
  MONEY_OUT: { en: 'Money out', ar: 'مال خارج', hint: { en: 'A payment or normal expense.', ar: 'دفعة أو مصروف عادي.' } },
  STOCK_PURCHASE: { en: 'Bought stock', ar: 'شراء مخزون', hint: { en: 'Adds inventory, cost, and ledger record together.', ar: 'يضيف المخزون والكلفة والسجل معاً.' } },
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
    addParty: 'Add person/company',
    addCustomer: 'Add customer',
    paymentMode: 'Payment status',
    paidNow: 'Paid now',
    payLater: 'Pay later',
    dueDate: 'Due date',
    category: 'What was this for?',
    reference: 'Invoice / reference',
    note: 'Note',
    stockItem: 'Stock item',
    existingItem: 'Use existing item',
    newItem: 'Create new item',
    itemNameEn: 'Item name',
    itemNameAr: 'Arabic item name',
    itemCategory: 'Item type',
    reorderPoint: 'Reorder reminder',
    quantity: 'Total quantity',
    unit: 'Unit',
    expiryDate: 'Expiry date',
    assetName: 'Asset name',
    assetCategory: 'Asset type',
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
    addParty: 'إضافة شخص/شركة',
    addCustomer: 'إضافة عميل',
    paymentMode: 'حالة الدفع',
    paidNow: 'مدفوع الآن',
    payLater: 'دفع لاحق',
    dueDate: 'تاريخ الاستحقاق',
    category: 'ما الغرض من هذا؟',
    reference: 'رقم الفاتورة / المرجع',
    note: 'ملاحظة',
    stockItem: 'صنف المخزون',
    existingItem: 'استخدام صنف موجود',
    newItem: 'إنشاء صنف جديد',
    itemNameEn: 'اسم الصنف',
    itemNameAr: 'اسم الصنف بالعربية',
    itemCategory: 'نوع الصنف',
    reorderPoint: 'تنبيه إعادة الطلب',
    quantity: 'الكمية الكلية',
    unit: 'الوحدة',
    expiryDate: 'تاريخ الانتهاء',
    assetName: 'اسم الأصل',
    assetCategory: 'نوع الأصل',
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
}) {
  const c = COPY[locale];
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [recordKind, setRecordKind] = useState<RecordKind>('MONEY_IN');
  const [currency, setCurrency] = useState('IQD');
  const [paymentMode, setPaymentMode] = useState('PAID');
  const [inventoryItemMode, setInventoryItemMode] = useState('existing');
  const [partyOptions, setPartyOptions] = useState<Option[]>(parties);
  const [partyId, setPartyId] = useState('');
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
  const showPaidAccount = !['CUSTOMER_DUE', 'SUPPLIER_DUE'].includes(recordKind) && (recordKind !== 'STOCK_PURCHASE' && recordKind !== 'ASSET_PURCHASE' || paymentMode === 'PAID');
  const showParty = ['STOCK_PURCHASE', 'ASSET_PURCHASE', 'CUSTOMER_DUE', 'SUPPLIER_DUE', 'MONEY_IN', 'MONEY_OUT'].includes(recordKind);

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
      setPartyOptions((current) => [...current, { value: result.id, label: result.label }].sort((a, b) => a.label.localeCompare(b.label)));
      setPartyId(result.id);
      setPopup(null);
      setPopupData({ name: '', nameAr: '', type: 'SUPPLIER', phone: '', email: '', address: '' });
    });
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
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
            {(Object.keys(KIND_LABELS) as RecordKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setRecordKind(kind)}
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
          <Field name="date" labelText={c.date} type="date" required value={today} />
          <Field name="amount" labelText={c.amount} type="number" required step="0.01" placeholder="0" />
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
          {currency === 'USD' ? <Field name="rate" labelText={c.rate} type="number" required step="1" /> : null}

          {recordKind === 'TRANSFER' ? (
            <>
              <SelectField name="accountId" labelText={c.fromAccount} options={accounts} required />
              <SelectField name="toAccountId" labelText={c.toAccount} options={accounts} required />
            </>
          ) : showPaidAccount ? (
            <SelectField name="accountId" labelText={c.account} options={accounts} required={paymentMode !== 'CREDIT'} />
          ) : null}

          <SelectField name="branchId" labelText={c.branch} options={branches} />

          {['STOCK_PURCHASE', 'ASSET_PURCHASE'].includes(recordKind) ? (
            <>
              <SelectField
                name="paymentMode"
                labelText={c.paymentMode}
                options={[
                  { value: 'PAID', label: c.paidNow },
                  { value: 'CREDIT', label: c.payLater },
                ]}
                value={paymentMode}
                onChange={setPaymentMode}
                empty={false}
              />
              {paymentMode === 'CREDIT' ? <Field name="dueDate" labelText={c.dueDate} type="date" value={today} /> : null}
            </>
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
              labelText={recordKind === 'CUSTOMER_DUE' ? c.customer : recordKind === 'SUPPLIER_DUE' || recordKind === 'STOCK_PURCHASE' ? c.supplier : c.party}
              options={partyOptions}
              value={partyId}
              onChange={setPartyId}
              required={['CUSTOMER_DUE', 'SUPPLIER_DUE'].includes(recordKind)}
            />
            <button type="button" onClick={() => setPopup('party')} className="self-end rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted">
              <Plus className="me-1 inline size-4" />
              {c.addParty}
            </button>
            <button type="button" onClick={() => setPopup('customer')} className="self-end rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted">
              <Plus className="me-1 inline size-4" />
              {c.addCustomer}
            </button>
          </div>
        ) : null}

        {recordKind === 'STOCK_PURCHASE' ? (
          <div className="grid gap-4 rounded-lg border border-primary/20 bg-linen/25 p-3 md:grid-cols-2 xl:grid-cols-3">
            <SelectField
              name="inventoryItemMode"
              labelText={c.stockItem}
              options={[
                { value: 'existing', label: c.existingItem },
                { value: 'new', label: c.newItem },
              ]}
              value={inventoryItemMode}
              onChange={setInventoryItemMode}
              empty={false}
            />
            {inventoryItemMode === 'existing' ? (
              <SelectField name="inventoryItemId" labelText={c.stockItem} options={inventoryItems} required />
            ) : (
              <>
                <Field name="newItemNameEn" labelText={c.itemNameEn} required />
                <Field name="newItemNameAr" labelText={c.itemNameAr} />
                <SelectField name="newItemCategory" labelText={c.itemCategory} options={inventoryCategoryOptions} required />
                <Field name="newItemReorderPoint" labelText={c.reorderPoint} type="number" step="0.001" />
              </>
            )}
            <Field name="quantity" labelText={c.quantity} type="number" required step="0.001" placeholder="0.000" />
            <SelectField name="unit" labelText={c.unit} options={unitOptions} required empty={false} />
            <Field name="expiryDate" labelText={c.expiryDate} type="date" />
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

        <div className="grid gap-4 md:grid-cols-2">
          <Field name="reference" labelText={c.reference} />
          <Field name="description" labelText={c.note} />
        </div>

        {state?.error ? (
          <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            {state.error === 'forbidden' ? c.forbidden : c.invalid}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border/80 pt-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90 disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {c.submit}
          </button>
          <Link href={cancelHref} className="inline-flex min-h-10 items-center rounded-lg border border-border/80 bg-card px-4 py-2 text-sm font-semibold text-roast hover:bg-linen/45">
            {c.cancel}
          </Link>
        </div>
      </form>

      {popup ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius)] border bg-card p-4 shadow-xl">
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
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPopup(null)} className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted">
                {c.cancel}
              </button>
              <button type="button" onClick={savePopup} disabled={quickPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
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

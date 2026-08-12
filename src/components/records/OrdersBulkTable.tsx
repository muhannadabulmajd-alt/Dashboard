'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

export type BulkOrderRow = {
  id: string;
  orderNumber: string;
  date: string;
  customer: string;
  channel: string;
  total: string;
  totalValue: number;
  paymentStatus: string;
  status: string;
};

type Option = { value: string; label: string };
type BulkAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const control = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function OrdersBulkTable({
  rows,
  action,
  locale,
  statuses,
  saleStatusValues,
  accounts,
  providers,
  paymentMethods,
  labels,
}: {
  rows: BulkOrderRow[];
  action: BulkAction;
  locale: string;
  statuses: Option[];
  saleStatusValues: string[];
  accounts: Option[];
  providers: Option[];
  paymentMethods: Option[];
  labels: Record<string, string>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [operation, setOperation] = useState('STATUS');
  const [selectedStatus, setSelectedStatus] = useState(statuses[0]?.value ?? '');
  const [completionMode, setCompletionMode] = useState('AUTO');
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const selectedTotal = selectedRows.reduce((sum, row) => sum + row.totalValue, 0);
  const allSelected = rows.length > 0 && selected.length === rows.length;

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const selectAll = () => setSelected(allSelected ? [] : rows.map((row) => row.id));

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-card p-2.5">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={allSelected} onChange={selectAll} className="size-5 accent-primary" />
          {labels.selectAll}
        </label>
        <span className="text-xs text-muted-foreground">{labels.selected.replace('{count}', String(selected.length))}</span>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border/80 bg-card md:block">
        <table className="w-full min-w-[920px] text-sm">
          <thead><tr className="border-b bg-linen/40 text-start text-xs uppercase tracking-[0.08em] text-muted-foreground">
            <th className="px-3 py-3"><span className="sr-only">{labels.select}</span></th>
            <th className="px-3 py-3 text-start">{labels.order}</th><th className="px-3 py-3 text-start">{labels.date}</th>
            <th className="px-3 py-3 text-start">{labels.customer}</th><th className="px-3 py-3 text-start">{labels.channel}</th>
            <th className="px-3 py-3 text-end">{labels.total}</th><th className="px-3 py-3 text-start">{labels.payment}</th>
            <th className="px-3 py-3 text-start">{labels.status}</th><th className="px-3 py-3" />
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-linen/20">
            <td className="px-3 py-3"><input aria-label={`${labels.select} ${row.orderNumber}`} type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} className="size-5 accent-primary" /></td>
            <td className="px-3 py-3 font-semibold">{row.orderNumber}</td><td className="px-3 py-3">{row.date}</td>
            <td className="px-3 py-3">{row.customer}</td><td className="px-3 py-3">{row.channel}</td>
            <td className="px-3 py-3 text-end font-semibold tabular-nums">{row.total}</td>
            <td className="px-3 py-3"><span className="rounded-full bg-linen px-2 py-1 text-xs font-semibold">{row.paymentStatus}</span></td>
            <td className="px-3 py-3"><span className="rounded-full bg-linen px-2 py-1 text-xs font-semibold">{row.status}</span></td>
            <td className="px-3 py-3 text-end"><Link href={`/admin/records/orders/${row.id}`} className="font-semibold text-primary hover:underline">{labels.open}</Link></td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">{rows.map((row) => <label key={row.id} className="grid cursor-pointer gap-3 rounded-lg border border-border/80 bg-card p-4 shadow-sm">
        <span className="flex items-start gap-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span className="min-w-0 flex-1"><span className="block break-all font-bold">{row.orderNumber}</span><span className="block text-xs text-muted-foreground">{row.date} · {row.customer}</span></span></span>
        <span className="grid grid-cols-2 gap-2 text-sm"><span><span className="block text-xs text-muted-foreground">{labels.total}</span><strong className="tabular-nums">{row.total}</strong></span><span><span className="block text-xs text-muted-foreground">{labels.status}</span>{row.status}</span></span>
        <span className="flex items-center justify-between gap-3 border-t pt-3"><span className="text-xs font-semibold">{row.paymentStatus}</span><Link href={`/admin/records/orders/${row.id}`} className="font-semibold text-primary">{labels.open}</Link></span>
      </label>)}</div>

      {selected.length ? <div className="sticky bottom-3 z-30 mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-card p-3 shadow-xl">
        <div className="min-w-0"><strong className="block text-sm">{labels.selected.replace('{count}', String(selected.length))}</strong><span className="block truncate text-xs text-muted-foreground">{labels.reviewTotal}: {new Intl.NumberFormat(locale).format(selectedTotal)} IQD</span></div>
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">{labels.bulkActions}</button>
      </div> : null}

      {open ? <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true">
        <form action={formAction} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card p-4 shadow-2xl sm:max-w-lg sm:rounded-xl">
          <input type="hidden" name="locale" value={locale} /><input type="hidden" name="orderIds" value={JSON.stringify(selected)} />
          <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold">{labels.bulkActions}</h2><p className="text-xs text-muted-foreground">{labels.selected.replace('{count}', String(selected.length))}</p></div><button type="button" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-lg border"><X className="size-5" /></button></div>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold">{labels.action}<select name="operation" value={operation} onChange={(event) => setOperation(event.target.value)} className={control}><option value="STATUS">{labels.updateStatus}</option><option value="RECORD_PAID">{labels.recordPaid}</option><option value="ASSIGN_PROVIDER">{labels.assignProvider}</option></select></label>
            {operation === 'STATUS' ? (
              <>
                <label className="grid gap-1 text-sm font-semibold">
                  {labels.status}
                  <select
                    name="status"
                    value={selectedStatus}
                    onChange={(event) => setSelectedStatus(event.target.value)}
                    className={control}
                  >
                    {statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {saleStatusValues.includes(selectedStatus) ? (
                  <>
                    <div className="rounded-lg border border-warning/25 bg-warning-soft p-3 text-xs leading-5 text-foreground">
                      {labels.completionPaymentHint}
                    </div>
                    <label className="grid gap-1 text-sm font-semibold">
                      {labels.completionMode}
                      <select
                        name="completionMode"
                        value={completionMode}
                        onChange={(event) => setCompletionMode(event.target.value)}
                        className={control}
                      >
                        <option value="AUTO">{labels.automaticPayment}</option>
                        <option value="DIRECT">{labels.directPayment}</option>
                        <option value="PROVIDER">{labels.providerCollection}</option>
                      </select>
                    </label>
                    {completionMode === 'DIRECT' ? (
                      <label className="grid gap-1 text-sm font-semibold">
                        {labels.account}
                        <select name="accountId" className={control}>
                          <option value="">—</option>
                          {accounts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {completionMode === 'PROVIDER' ? (
                      <label className="grid gap-1 text-sm font-semibold">
                        {labels.provider}
                        <select name="providerKey" className={control}>
                          <option value="">—</option>
                          {providers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {completionMode !== 'AUTO' ? (
                      <>
                        <label className="grid gap-1 text-sm font-semibold">
                          {labels.paymentMethod}
                          <select name="paymentMethod" className={control}>
                            {paymentMethods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm font-semibold">
                          {labels.date}
                          <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={control} />
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {operation === 'RECORD_PAID' ? <><label className="grid gap-1 text-sm font-semibold">{labels.account}<select name="accountId" className={control}>{accounts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">{labels.paymentMethod}<select name="paymentMethod" className={control}>{paymentMethods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">{labels.date}<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={control} /></label></> : null}
            {operation === 'ASSIGN_PROVIDER' ? <><label className="grid gap-1 text-sm font-semibold">{labels.provider}<select name="providerKey" className={control}><option value="">—</option>{providers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">{labels.paymentMethod}<select name="paymentMethod" className={control}>{paymentMethods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">{labels.date}<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={control} /></label></> : null}
            {state?.error ? <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-sm font-semibold text-danger">{labels[`${state.error}Error`] ?? labels[state.error] ?? state.error}</p> : null}
            {state?.ok ? <p role="status" className="rounded-lg border border-success/20 bg-success-soft p-3 text-sm font-semibold text-success">{labels.success}</p> : null}
            <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-60">{pending ? <Loader2 className="size-4 animate-spin" /> : null}{labels.apply}</button>
          </div>
        </form>
      </div> : null}
    </div>
  );
}

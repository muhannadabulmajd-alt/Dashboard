import 'server-only';
import type { Currency, Prisma } from '@prisma/client';
import type { DashboardFilters } from '@/lib/filters';
import { convertToIqd } from '@/lib/money';
import { accountBalance, financeTotals, netCash, unassignedCash, type FinanceEntryLike } from '@/lib/metrics/finance';
import { stockRow } from '@/lib/metrics/inventory';
import { prisma } from '@/server/db/client';
import { getUsdToIqd } from '@/server/settings';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import {
  buildFinanceAccountScopeWhere,
  buildFinanceEntryScopeWhere,
  type DataScope,
} from '@/server/filters/where-builder';

type Scope = DataScope;

export interface BalanceSheetCurrencyRow {
  currency: Currency;
  accounts: { id: string; name: string; balance: number }[];
  unassignedCash: number;
  cashBank: number;
  receivables: number;
  inventory: number;
  fixedAssets: number;
  totalAssets: number;
  payables: number;
  capital: number;
  retained: number;
  totalEquity: number;
}

export interface BalanceSheetSnapshot {
  asOf: Date;
  currencies: BalanceSheetCurrencyRow[];
  combinedIqd: Omit<BalanceSheetCurrencyRow, 'currency' | 'accounts' | 'unassignedCash'>;
}

export async function getBalanceSheetSnapshot(options: {
  scope: Scope;
  filters?: DashboardFilters;
  asOf?: Date;
}): Promise<BalanceSheetSnapshot> {
  const asOf = options.asOf ?? new Date();
  const ids = options.scope.branchId ? [options.scope.branchId] : options.filters?.branchId ?? [];
  const entityBranch = ids.length ? { branchId: ids.length === 1 ? ids[0] : { in: ids } } : {};
  const accountScope = options.scope.locationIds !== undefined || options.scope.branchId
    ? buildFinanceAccountScopeWhere(options.scope)
    : entityBranch;
  const entryScope: Prisma.FinanceEntryWhereInput = options.scope.locationIds !== undefined || options.scope.branchId
    ? buildFinanceEntryScopeWhere(options.scope)
    : entityBranch;
  const inventoryFilters: DashboardFilters = options.filters ?? { range: 'all' };

  const [accounts, entriesRaw, inventoryItems, fixedAssets, rate] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true, ...accountScope }, orderBy: { name: 'asc' } }),
    prisma.financeEntry.findMany({
      where: { date: { lte: asOf }, archivedAt: null, reversedAt: null, reversalOfId: null, ...entryScope },
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
        archivedAt: true, reversedAt: true, reversalOfId: true, isOpeningBalance: true,
      },
    }),
    getInventoryItems(
      inventoryFilters,
      options.scope,
      { start: new Date(0), end: asOf },
    ),
    prisma.fixedAsset.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        purchaseDate: { lte: asOf },
        ...(options.scope.locationIds !== undefined ? { id: { in: [] } } : entityBranch),
        OR: [{ financeEntryId: null }, { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } }],
      },
      select: { totalCost: true },
    }),
    getUsdToIqd(),
  ]);

  const entries = entriesRaw as FinanceEntryLike[];
  const inventoryValue = inventoryItems.reduce((sum, item) => sum + stockRow(item).value, 0);
  const fixedAssetValue = fixedAssets.reduce((sum, asset) => sum + asset.totalCost, 0);
  const currencyCodes = Array.from(new Set([...accounts.map((account) => account.currency), ...entries.map((entry) => entry.currency)]));
  if (!currencyCodes.length) currencyCodes.push('IQD');

  const currencies = currencyCodes.map((currency): BalanceSheetCurrencyRow => {
    const currencyEntries = entries.filter((entry) => entry.currency === currency);
    const currencyAccounts = accounts.filter((account) => account.currency === currency);
    const totals = financeTotals(currencyEntries);
    const cashBank = netCash(currencyAccounts, currencyEntries);
    const inventory = currency === 'IQD' ? inventoryValue : 0;
    const assets = currency === 'IQD' ? fixedAssetValue : 0;
    const totalAssets = cashBank + totals.outstandingReceivable + inventory + assets;
    const retained = totalAssets - totals.outstandingPayable - totals.capitalIn;
    return {
      currency,
      accounts: currencyAccounts.map((account) => ({ id: account.id, name: account.name, balance: accountBalance(account, currencyEntries) })),
      unassignedCash: unassignedCash(currencyEntries),
      cashBank,
      receivables: totals.outstandingReceivable,
      inventory,
      fixedAssets: assets,
      totalAssets,
      payables: totals.outstandingPayable,
      capital: totals.capitalIn,
      retained,
      totalEquity: totals.capitalIn + retained,
    };
  });

  const combinedIqd = currencies.reduce((combined, row) => {
    const convert = (value: number) => convertToIqd(value, row.currency, rate);
    combined.cashBank += convert(row.cashBank);
    combined.receivables += convert(row.receivables);
    combined.inventory += convert(row.inventory);
    combined.fixedAssets += convert(row.fixedAssets);
    combined.totalAssets += convert(row.totalAssets);
    combined.payables += convert(row.payables);
    combined.capital += convert(row.capital);
    combined.retained += convert(row.retained);
    combined.totalEquity += convert(row.totalEquity);
    return combined;
  }, { cashBank: 0, receivables: 0, inventory: 0, fixedAssets: 0, totalAssets: 0, payables: 0, capital: 0, retained: 0, totalEquity: 0 });

  return { asOf, currencies, combinedIqd };
}

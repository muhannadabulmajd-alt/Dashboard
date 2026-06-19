import 'server-only';
import { prisma } from '@/server/db/client';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import {
  parseBatches,
  parseCapital,
  parseCustomers,
  parseInventory,
  parseOrders,
  parseProducts,
  parsePurchases,
  parseShipments,
  type ImportDataset,
  type RowError,
} from './parsers';

type Raw = Record<string, string>;

function duplicateErrors(values: string[], label: string): RowError[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].map((value) => ({ row: 0, message: `duplicate ${label} ${value}` }));
}

export async function preflightImport(dataset: ImportDataset, rows: Raw[]): Promise<RowError[]> {
  if (dataset === 'products') return parseProducts(rows).errors;
  if (dataset === 'inventory') return parseInventory(rows).errors;
  if (dataset === 'purchases') return parsePurchases(rows).errors;
  if (dataset === 'capital') return parseCapital(rows).errors;

  if (dataset === 'customers') {
    const parsed = parseCustomers(rows);
    return [...parsed.errors, ...duplicateErrors(parsed.valid.map((customer) => customer.externalId), 'customer key')];
  }

  if (dataset === 'orders') {
    const parsed = parseOrders(rows);
    const errors = [...parsed.errors];
    const customerKeys = [...new Set(parsed.valid.map((order) => order.customerExternalId).filter(Boolean) as string[])];
    const skus = [...new Set(parsed.valid.flatMap((order) => order.lines.map((line) => line.sku)))];
    const partyKeys = [...new Set(parsed.valid.map((order) => order.paymentPartyKey).filter(Boolean) as string[])];
    const accountKeys = [...new Set(parsed.valid.map((order) => order.paymentAccountKey).filter(Boolean) as string[])];
    const customers = customerKeys.length
      ? await prisma.customer.findMany({ where: { externalId: { in: customerKeys } }, select: { externalId: true } })
      : [];
    const products = skus.length
      ? await prisma.product.findMany({ where: { sku: { in: skus }, isActive: true }, select: { sku: true } })
      : [];
    const parties = partyKeys.length
      ? await prisma.party.findMany({ where: { externalKey: { in: partyKeys }, isActive: true }, select: { externalKey: true } })
      : [];
    const accounts = accountKeys.length
      ? await prisma.financeAccount.findMany({ where: { externalKey: { in: accountKeys }, isActive: true }, select: { externalKey: true } })
      : [];
    const foundCustomers = new Set(customers.map((customer) => customer.externalId));
    const foundProducts = new Set(products.map((product) => product.sku));
    const foundParties = new Set(parties.map((party) => party.externalKey).filter(Boolean));
    const foundAccounts = new Set(accounts.map((account) => account.externalKey).filter(Boolean));
    for (const key of customerKeys) if (!foundCustomers.has(key)) errors.push({ row: 0, message: `unknown customer ${key}` });
    for (const sku of skus) if (!foundProducts.has(sku)) errors.push({ row: 0, message: `unknown or inactive SKU ${sku}` });
    for (const key of partyKeys) if (!foundParties.has(key)) errors.push({ row: 0, message: `unknown payment party ${key}` });
    for (const key of accountKeys) if (!foundAccounts.has(key)) errors.push({ row: 0, message: `unknown payment account ${key}` });

    const roles = await getOrderStatusRoleMap();
    for (const order of parsed.valid) {
      const role = roles.get(order.status) ?? 'UNKNOWN';
      if (role !== 'SALE' && order.paymentMode !== 'NONE') {
        errors.push({ row: 0, message: `${order.orderNumber}: non-sale status must use paymentMode NONE` });
      }
      if (order.paymentMode === 'PAID' && !order.paymentAccountKey) {
        errors.push({ row: 0, message: `${order.orderNumber}: paid order is missing paymentAccountKey` });
      }
      if (order.paymentMode === 'CREDIT' && !order.paymentPartyKey) {
        errors.push({ row: 0, message: `${order.orderNumber}: credit order is missing paymentPartyKey` });
      }
    }
    return errors;
  }

  if (dataset === 'shipments') {
    const parsed = parseShipments(rows);
    const errors = [
      ...parsed.errors,
      ...duplicateErrors(parsed.valid.map((shipment) => shipment.orderNumber), 'shipment order'),
    ];
    const orderNumbers = [...new Set(parsed.valid.map((shipment) => shipment.orderNumber))];
    const partyKeys = [...new Set(parsed.valid.map((shipment) => shipment.courierPartyKey).filter(Boolean) as string[])];
    const orders = await prisma.order.findMany({ where: { orderNumber: { in: orderNumbers } }, select: { orderNumber: true } });
    const parties = partyKeys.length
      ? await prisma.party.findMany({ where: { externalKey: { in: partyKeys }, isActive: true }, select: { externalKey: true } })
      : [];
    const foundOrders = new Set(orders.map((order) => order.orderNumber));
    const foundParties = new Set(parties.map((party) => party.externalKey).filter(Boolean));
    for (const key of orderNumbers) if (!foundOrders.has(key)) errors.push({ row: 0, message: `unknown order ${key}` });
    for (const key of partyKeys) if (!foundParties.has(key)) errors.push({ row: 0, message: `unknown courier party ${key}` });
    for (const shipment of parsed.valid) {
      if (shipment.financeMode === 'PAYABLE' && shipment.status === 'DELIVERED' && !shipment.courierPartyKey) {
        errors.push({ row: 0, message: `${shipment.orderNumber}: payable shipment is missing courierPartyKey` });
      }
    }
    return errors;
  }

  const parsed = parseBatches(rows);
  const errors = [...parsed.errors, ...duplicateErrors(parsed.valid.map((batch) => batch.batchNumber), 'batch number')];
  const keys = [...new Set(parsed.valid.flatMap((batch) => [batch.greenInventoryKey, batch.roastedInventoryKey]).filter(Boolean) as string[])];
  const items = keys.length
    ? await prisma.inventoryItem.findMany({ where: { externalKey: { in: keys }, isActive: true }, select: { externalKey: true } })
    : [];
  const found = new Set(items.map((item) => item.externalKey).filter(Boolean));
  for (const key of keys) if (!found.has(key)) errors.push({ row: 0, message: `unknown inventory key ${key}` });
  for (const batch of parsed.valid) {
    if (!batch.greenInventoryKey || !batch.roastedInventoryKey) {
      errors.push({ row: 0, message: `${batch.batchNumber}: both inventory keys are required` });
    }
    if (!batch.roastedOutputGrams || batch.roastedOutputGrams > batch.greenInputGrams) {
      errors.push({ row: 0, message: `${batch.batchNumber}: invalid roasted output` });
    }
  }
  return errors;
}

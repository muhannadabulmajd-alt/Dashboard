import { PrismaClient, type Prisma } from '@prisma/client';
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';
import { formatProductBarcode, formatRetailBarcode } from '../src/lib/barcode';
import { subDays, addDays, startOfMonth, eachMonthOfInterval } from 'date-fns';

const prisma = new PrismaClient();
faker.seed(20260604);

const NOW = new Date();
const START = subDays(NOW, 75);
const DEMO_PASSWORD = 'laheeb1234';

function pick<T>(arr: readonly T[]): T {
  return faker.helpers.arrayElement(arr);
}
function weighted<T>(pairs: { value: T; weight: number }[]): T {
  return faker.helpers.weightedArrayElement(pairs);
}
function at(date: Date, hour: number, minute = faker.number.int({ min: 0, max: 59 })): Date {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function clear() {
  // Delete in dependency order.
  await prisma.auditLog.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.order.deleteMany();
  await prisma.batchSkuLink.deleteMany();
  await prisma.roastBatch.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.uploadBatch.deleteMany();
  await prisma.syncRun.deleteMany();
  await prisma.connector.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
}

async function seedConnectors() {
  await prisma.connector.createMany({
    data: [
      {
        name: 'Online Store (sample)',
        type: 'SAMPLE',
        dataset: 'ORDERS',
        status: 'ACTIVE',
        config: { note: 'Generates sample orders from the live catalog on each sync.' },
      },
      {
        name: 'External CSV feed',
        type: 'HTTP_CSV',
        dataset: 'PRODUCTS',
        status: 'PAUSED',
        config: { dataset: 'products', note: 'Set the endpoint URL and token, then activate.' },
      },
      {
        name: 'Odoo ERP',
        type: 'ODOO',
        dataset: 'PRODUCTS',
        status: 'PAUSED',
        config: { note: 'Configure API credentials to enable.' },
      },
      {
        name: 'Courier API',
        type: 'COURIER',
        dataset: 'SHIPMENTS',
        status: 'PAUSED',
        config: { note: 'Configure courier endpoint to enable.' },
      },
    ],
  });
}

// ---------------------------------------------------------------------------

async function seedBranchesAndUsers() {
  const hq = await prisma.branch.create({
    data: { code: 'HQ', nameEn: 'Laheeb Roastery (HQ)', nameAr: 'محمصة لهيب (الرئيسي)', governorate: 'BAGHDAD' },
  });
  const karada = await prisma.branch.create({
    data: {
      code: 'CAFE-KRD',
      nameEn: 'Laheeb Cafe — Karada',
      nameAr: 'مقهى لهيب — الكرادة',
      governorate: 'BAGHDAD',
      isFranchise: true,
    },
  });
  const erbil = await prisma.branch.create({
    data: {
      code: 'CAFE-ERB',
      nameEn: 'Laheeb Cafe — Erbil',
      nameAr: 'مقهى لهيب — أربيل',
      governorate: 'ERBIL',
      isFranchise: true,
    },
  });

  const hashedPassword = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const users: Prisma.UserCreateManyInput[] = [
    { email: 'owner@laheeb.coffee', name: 'Laheeb Owner', role: 'OWNER', hashedPassword, branchId: hq.id },
    { email: 'admin@laheeb.coffee', name: 'System Admin', role: 'ADMIN', hashedPassword, branchId: hq.id },
    { email: 'finance@laheeb.coffee', name: 'Finance Lead', role: 'FINANCE', hashedPassword, branchId: hq.id },
    { email: 'ops@laheeb.coffee', name: 'Roastery Ops', role: 'ROASTERY_OPS', hashedPassword, branchId: hq.id },
    { email: 'sales@laheeb.coffee', name: 'Sales & CRM', role: 'SALES_CRM', hashedPassword, branchId: hq.id },
    { email: 'manager@laheeb.coffee', name: 'Karada Manager', role: 'BRANCH_MANAGER', hashedPassword, branchId: karada.id },
    { email: 'franchisee@laheeb.coffee', name: 'Erbil Franchisee', role: 'FRANCHISEE_VIEWER', hashedPassword, branchId: erbil.id },
    { email: 'viewer@laheeb.coffee', name: 'Read-only Viewer', role: 'VIEWER', hashedPassword, branchId: hq.id },
  ];
  await prisma.user.createMany({ data: users });
  const ops = await prisma.user.findUnique({ where: { email: 'ops@laheeb.coffee' } });
  return { hq, branches: [hq, karada, erbil], opsId: ops!.id };
}

// ---------------------------------------------------------------------------

interface SeededProduct {
  id: string;
  sku: string;
  sellingPrice: number;
  cogsPerUnit: number;
  productLine: string;
}

const COFFEES = [
  { code: 'ESPSPRING', en: 'Espresso Spring', ar: 'إسبريسو الربيع', line: 'ESPRESSO', roast: 'MEDIUM_DARK', blend: true, origin: 'Blend', price: 13000 },
  { code: 'ESPNIGHT', en: 'Espresso Midnight', ar: 'إسبريسو منتصف الليل', line: 'ESPRESSO', roast: 'DARK', blend: true, origin: 'Blend', price: 13500 },
  { code: 'TURMED', en: 'Turkish Medium', ar: 'قهوة تركية وسط', line: 'TURKISH', roast: 'MEDIUM', blend: true, origin: 'Blend', price: 11000 },
  { code: 'ETHGUJI', en: 'Ethiopia Guji', ar: 'إثيوبيا قوجي', line: 'SINGLE_ORIGIN', roast: 'LIGHT', blend: false, origin: 'Ethiopia', price: 18000 },
  { code: 'COLHUILA', en: 'Colombia Huila', ar: 'كولومبيا هويلا', line: 'SINGLE_ORIGIN', roast: 'MEDIUM', blend: false, origin: 'Colombia', price: 17000 },
  { code: 'BRZSANTOS', en: 'Brazil Santos', ar: 'برازيل سانتوس', line: 'SINGLE_ORIGIN', roast: 'MEDIUM', blend: false, origin: 'Brazil', price: 15000 },
  { code: 'FILHOUSE', en: 'Filter House', ar: 'فلتر البيت', line: 'FILTER', roast: 'MEDIUM', blend: true, origin: 'Blend', price: 14000 },
  { code: 'BLDHOUSE', en: 'House Blend', ar: 'خلطة البيت', line: 'BLENDS', roast: 'MEDIUM_DARK', blend: true, origin: 'Blend', price: 12500 },
] as const;

const SIZES = [
  { code: '250', label: '250g', mult: 1 },
  { code: '1KG', label: '1kg', mult: 3.6 },
] as const;

const GRIND_BY_LINE: Record<string, { code: string; enum: string }[]> = {
  ESPRESSO: [{ code: 'WB', enum: 'WHOLE_BEAN' }, { code: 'ESP', enum: 'ESPRESSO' }],
  TURKISH: [{ code: 'TUR', enum: 'TURKISH' }],
  FILTER: [{ code: 'FIL', enum: 'FILTER' }, { code: 'WB', enum: 'WHOLE_BEAN' }],
  SINGLE_ORIGIN: [{ code: 'WB', enum: 'WHOLE_BEAN' }, { code: 'FIL', enum: 'FILTER' }],
  BLENDS: [{ code: 'WB', enum: 'WHOLE_BEAN' }, { code: 'ESP', enum: 'ESPRESSO' }],
};

async function seedProducts(): Promise<SeededProduct[]> {
  const data: Prisma.ProductCreateManyInput[] = [];
  let n = 0;

  for (const c of COFFEES) {
    const grinds = GRIND_BY_LINE[c.line];
    for (const size of SIZES) {
      // 1kg only in whole bean to keep the catalog realistic
      const sizeGrinds = size.code === '1KG' ? grinds.filter((g) => g.code === 'WB') : grinds;
      for (const g of sizeGrinds) {
        n += 1;
        const price = Math.round((c.price * size.mult) / 250) * 250;
        data.push({
          id: `prod_${n}`,
          sku: `LH-${c.code}-${size.code}-${g.code}`,
          barcodeValue: formatProductBarcode(n),
          retailBarcode: formatRetailBarcode(n),
          nameEn: `${c.en} ${size.label}`,
          nameAr: `${c.ar} ${size.label}`,
          productLine: c.line as Prisma.ProductCreateManyInput['productLine'],
          sizeGrams: size.code === '1KG' ? 1000 : 250,
          sizeLabel: size.label,
          grind: g.enum as Prisma.ProductCreateManyInput['grind'],
          roastLevel: c.roast as Prisma.ProductCreateManyInput['roastLevel'],
          origin: c.origin,
          isBlend: c.blend,
          sellingPrice: price,
          cogsPerUnit: Math.round((price * 0.45) / 100) * 100,
        });
      }
    }
  }

  // Drip bags
  for (const v of [
    { code: 'ETHGUJI', en: 'Ethiopia Guji Drip', ar: 'دريب إثيوبيا قوجي', price: 9000 },
    { code: 'HOUSE', en: 'House Drip Variety', ar: 'دريب خلطة البيت', price: 8500 },
  ]) {
    n += 1;
    data.push({
      id: `prod_${n}`,
      sku: `LH-DRIP-${v.code}-10-NA`,
      barcodeValue: formatProductBarcode(n),
      retailBarcode: formatRetailBarcode(n),
      nameEn: `${v.en} (10 sachets)`,
      nameAr: `${v.ar} (10 أكياس)`,
      productLine: 'DRIP_BAGS',
      sizeLabel: '10 sachets',
      grind: 'NONE',
      roastLevel: 'MEDIUM',
      origin: 'Blend',
      sellingPrice: v.price,
      cogsPerUnit: Math.round((v.price * 0.5) / 100) * 100,
    });
  }

  // Accessories
  for (const a of [
    { code: 'V60', en: 'V60 Dripper', ar: 'قمع V60', price: 15000, cogs: 9000 },
    { code: 'FILTERS', en: 'Paper Filters (100)', ar: 'فلاتر ورقية (100)', price: 6000, cogs: 3000 },
    { code: 'MOKA3', en: 'Moka Pot (3 cup)', ar: 'موكا (3 أكواب)', price: 22000, cogs: 14000 },
  ]) {
    n += 1;
    data.push({
      id: `prod_${n}`,
      sku: `LH-ACC-${a.code}-NA-NA`,
      barcodeValue: formatProductBarcode(n),
      retailBarcode: formatRetailBarcode(n),
      nameEn: a.en,
      nameAr: a.ar,
      productLine: 'ACCESSORIES',
      sizeLabel: '—',
      grind: 'NONE',
      sellingPrice: a.price,
      cogsPerUnit: a.cogs,
    });
  }

  await prisma.product.createMany({ data });
  return data.map((d) => ({
    id: d.id as string,
    sku: d.sku,
    sellingPrice: d.sellingPrice,
    cogsPerUnit: d.cogsPerUnit,
    productLine: String(d.productLine),
  }));
}

// ---------------------------------------------------------------------------

const GOVERNORATES = [
  { value: 'BAGHDAD' as const, weight: 45 },
  { value: 'ERBIL' as const, weight: 20 },
  { value: 'BASRA' as const, weight: 12 },
  { value: 'NAJAF' as const, weight: 8 },
  { value: 'MOSUL' as const, weight: 8 },
  { value: 'SULAYMANIYAH' as const, weight: 7 },
];

async function seedCustomers(count: number): Promise<string[]> {
  const data: Prisma.CustomerCreateManyInput[] = [];
  for (let i = 1; i <= count; i++) {
    data.push({
      id: `cust_${i}`,
      externalId: `C-${1000 + i}`,
      phone: `+9647${faker.string.numeric(9)}`,
      governorate: weighted(GOVERNORATES.map((g) => ({ value: g.value, weight: g.weight }))),
      segment: 'NEW',
      campaignSource: faker.helpers.maybe(() => pick(['instagram', 'tiktok', 'referral', 'google']), {
        probability: 0.4,
      }),
    });
  }
  await prisma.customer.createMany({ data });
  return data.map((d) => d.id as string);
}

// ---------------------------------------------------------------------------

async function seedOffers() {
  const data: Prisma.OfferCreateManyInput[] = [
    { id: 'offer_1', name: 'New customer 10%', code: 'WELCOME10', discountType: 'PERCENT', discountValue: 10 },
    { id: 'offer_2', name: 'Seasonal 15%', code: 'SEASON15', discountType: 'PERCENT', discountValue: 15 },
    { id: 'offer_3', name: 'Free shipping', code: 'FREESHIP', isAutomatic: true, discountType: 'FIXED', discountValue: 4000 },
  ];
  await prisma.offer.createMany({ data });
  return data.map((d) => d.id as string);
}

// ---------------------------------------------------------------------------

const CHANNELS = [
  { value: 'ONLINE_STORE' as const, weight: 45 },
  { value: 'POS' as const, weight: 14 },
  { value: 'SOCIAL' as const, weight: 16 },
  { value: 'WHOLESALE' as const, weight: 10 },
  { value: 'CAFE' as const, weight: 6 },
  { value: 'CORPORATE' as const, weight: 5 },
  { value: 'RESELLERS' as const, weight: 4 },
];

function fulfillmentFor(channel: string): Prisma.OrderCreateManyInput['fulfillmentMethod'] {
  if (channel === 'POS' || channel === 'CAFE') return 'PICKUP';
  if (channel === 'WHOLESALE' || channel === 'CORPORATE') return 'B2B';
  return weighted([
    { value: 'COURIER' as const, weight: 70 },
    { value: 'INTERNAL_DELIVERY' as const, weight: 20 },
    { value: 'PICKUP' as const, weight: 10 },
  ]);
}

async function seedOrders(
  products: SeededProduct[],
  customerIds: string[],
  offerIds: string[],
  branches: { value: string; weight: number }[],
) {
  const orders: Prisma.OrderCreateManyInput[] = [];
  const lines: Prisma.OrderLineCreateManyInput[] = [];
  const shipments: Prisma.ShipmentCreateManyInput[] = [];
  const custStats = new Map<string, { count: number; first: Date; last: Date }>();

  let orderN = 0;
  const days = Math.round((NOW.getTime() - START.getTime()) / 86_400_000);

  for (let d = 0; d <= days; d++) {
    const date = addDays(START, d);
    const dow = date.getDay(); // 5,6 = Fri/Sat weekend in Iraq
    const weekendBoost = dow === 5 || dow === 6 ? 1.5 : 1;
    const ordersToday = Math.round(faker.number.int({ min: 6, max: 16 }) * weekendBoost);

    for (let o = 0; o < ordersToday; o++) {
      orderN += 1;
      const id = `ord_${orderN}`;
      const channel = weighted(CHANNELS.map((c) => ({ value: c.value, weight: c.weight })));
      const governorate = weighted(GOVERNORATES.map((g) => ({ value: g.value, weight: g.weight })));
      const fulfillmentMethod = fulfillmentFor(channel);
      const status = weighted([
        { value: 'COMPLETED' as const, weight: 86 },
        { value: 'CANCELLED' as const, weight: 4 },
        { value: 'RETURNED' as const, weight: 6 },
        { value: 'REFUNDED' as const, weight: 4 },
      ]);
      const hour = weighted([
        { value: 10, weight: 2 },
        { value: 12, weight: 3 },
        { value: 14, weight: 3 },
        { value: 17, weight: 4 },
        { value: 19, weight: 5 },
        { value: 21, weight: 3 },
      ]);
      const placedAt = at(date, hour);
      const customerId = pick(customerIds);

      // 1-4 lines
      const lineCount = faker.number.int({ min: 1, max: 4 });
      let gross = 0;
      for (let l = 0; l < lineCount; l++) {
        const p = pick(products);
        const qty = faker.number.int({ min: 1, max: channel === 'WHOLESALE' ? 12 : 3 });
        const lineNet = p.sellingPrice * qty;
        gross += lineNet;
        lines.push({
          orderId: id,
          productId: p.id,
          sku: p.sku,
          quantity: qty,
          unitGrossPrice: p.sellingPrice,
          lineDiscount: 0,
          lineNet,
          unitCogsSnapshot: p.cogsPerUnit,
        });
      }

      // Offer / discount on ~22% of orders
      let offerId: string | null = null;
      let discount = 0;
      if (faker.datatype.boolean({ probability: 0.22 })) {
        offerId = pick(offerIds);
        discount = offerId === 'offer_3' ? 4000 : Math.round((gross * pick([10, 15])) / 100);
      }
      const refund = status === 'RETURNED' || status === 'REFUNDED' ? Math.round(gross - discount) : 0;
      const isDelivery = ['COURIER', 'INTERNAL_DELIVERY', 'B2B'].includes(fulfillmentMethod);
      const deliveryFee = isDelivery ? pick([0, 3000, 4000, 5000]) : 0;
      const deliveryCost = isDelivery ? faker.number.int({ min: 3000, max: 6000 }) : 0;

      orders.push({
        id,
        orderNumber: `LH-O-${String(orderN).padStart(5, '0')}`,
        placedAt,
        customerId,
        branchId: weighted(branches),
        channel,
        governorate,
        fulfillmentMethod,
        status,
        grossAmount: gross,
        discountAmount: discount,
        refundAmount: refund,
        deliveryFee,
        deliveryCost,
        offerId,
      });

      // Customer statistics use the same completed-sale contract as reports.
      if (status === 'COMPLETED') {
        const s = custStats.get(customerId);
        if (!s) custStats.set(customerId, { count: 1, first: placedAt, last: placedAt });
        else {
          s.count += 1;
          if (placedAt < s.first) s.first = placedAt;
          if (placedAt > s.last) s.last = placedAt;
        }
      }

      // shipment for delivery orders
      if (isDelivery && status !== 'CANCELLED') {
        const shipStatus = weighted([
          { value: 'DELIVERED' as const, weight: 82 },
          { value: 'IN_TRANSIT' as const, weight: 6 },
          { value: 'FAILED' as const, weight: 6 },
          { value: 'RETURNED' as const, weight: 6 },
        ]);
        const dispatchedAt = at(date, hour + 1 > 23 ? 23 : hour + 1);
        shipments.push({
          orderId: id,
          courier: pick(['Laheeb Express', 'Toshka', 'Al-Sayer', 'Internal Rider']),
          status: shipStatus,
          dispatchedAt,
          deliveredAt:
            shipStatus === 'DELIVERED' ? addDays(dispatchedAt, faker.number.int({ min: 1, max: 3 })) : null,
          shippingCost: deliveryCost,
          governorate,
          failureReason: shipStatus === 'FAILED' ? 'Customer unreachable' : null,
        });
      }
    }
  }

  // Insert in chunks
  await prisma.order.createMany({ data: orders });
  for (let i = 0; i < lines.length; i += 1000) {
    await prisma.orderLine.createMany({ data: lines.slice(i, i + 1000) });
  }
  await prisma.shipment.createMany({ data: shipments });

  const seedCashAccount = await prisma.financeAccount.upsert({
    where: { externalKey: 'SEED_CASH_ON_HANDS' },
    update: { isActive: true },
    create: {
      externalKey: 'SEED_CASH_ON_HANDS',
      name: 'Seed cash on hands',
      type: 'CASH',
      currency: 'IQD',
      branchId: branches[0]?.value,
    },
  });
  const completedPayments: Prisma.FinanceEntryCreateManyInput[] = orders
    .filter((order) => order.status === 'COMPLETED')
    .map((order): Prisma.FinanceEntryCreateManyInput => ({
      date: order.placedAt,
      type: 'INCOME',
      amount: Math.max(
        0,
        (order.grossAmount ?? 0) -
          (order.discountAmount ?? 0) -
          (order.refundAmount ?? 0) +
          (order.deliveryFee ?? 0) +
          (order.extraCharges ?? 0),
      ),
      currency: 'IQD',
      obligation: false,
      accountId: seedCashAccount.id,
      branchId: order.branchId,
      orderId: order.id,
      paymentMethod: 'Cash',
      importKey: `SEED:ORDER:${order.id}:PAID`,
      reference: order.orderNumber,
      description: `Seed payment for ${order.orderNumber}`,
    }))
    .filter((entry) => entry.amount > 0);
  for (let i = 0; i < completedPayments.length; i += 1000) {
    await prisma.financeEntry.createMany({ data: completedPayments.slice(i, i + 1000) });
  }

  // Update customer aggregates + segment
  await Promise.all(
    customerIds.map((cid) => {
      const s = custStats.get(cid);
      const count = s?.count ?? 0;
      const segment = count === 0 ? 'INACTIVE' : count >= 5 ? 'LOYAL' : count >= 2 ? 'RETURNING' : 'NEW';
      return prisma.customer.update({
        where: { id: cid },
        data: {
          ordersCount: count,
          firstOrderAt: s?.first ?? null,
          lastOrderAt: s?.last ?? null,
          segment,
        },
      });
    }),
  );

  return { orderCount: orders.length, lineCount: lines.length };
}

// ---------------------------------------------------------------------------

async function seedRoastBatches(products: SeededProduct[], opsId: string, branchId: string) {
  const roastedProducts = products.filter((p) =>
    ['ESPRESSO', 'FILTER', 'SINGLE_ORIGIN', 'BLENDS', 'TURKISH'].includes(p.productLine),
  );
  const links: Prisma.BatchSkuLinkCreateManyInput[] = [];
  const batches: Prisma.RoastBatchCreateManyInput[] = [];
  const roastLevels = ['LIGHT', 'MEDIUM', 'MEDIUM_DARK', 'DARK'] as const;

  for (let i = 1; i <= 45; i++) {
    const id = `batch_${i}`;
    const green = faker.number.int({ min: 20, max: 60 }) * 1000;
    const yieldPct = faker.number.float({ min: 0.82, max: 0.88 });
    const roasted = Math.round(green * yieldPct);
    const roastDate = faker.date.between({ from: START, to: NOW });
    batches.push({
      id,
      batchNumber: `LH-2026-${String(i).padStart(4, '0')}`,
      roastDate,
      packagingDate: addDays(roastDate, 1),
      origin: pick(['Ethiopia', 'Colombia', 'Brazil', 'Blend']),
      roastLevel: pick(roastLevels),
      greenInputGrams: green,
      roastedOutputGrams: roasted,
      qcScore: faker.number.float({ min: 80, max: 92, fractionDigits: 1 }),
      qcNotes: pick(['Balanced, sweet finish', 'Bright acidity', 'Heavy body, low acidity', 'Clean cup']),
      operatorId: opsId,
      branchId,
    });
    const p = pick(roastedProducts);
    links.push({ batchId: id, productId: p.id, allocatedGrams: roasted });
  }
  await prisma.roastBatch.createMany({ data: batches });
  await prisma.batchSkuLink.createMany({ data: links });
  return batches.length;
}

// ---------------------------------------------------------------------------

async function seedInventory(branchId: string) {
  const items: Prisma.InventoryItemCreateManyInput[] = [];
  const movements: Prisma.StockMovementCreateManyInput[] = [];
  let itemN = 0;

  function addItem(opts: {
    category: Prisma.InventoryItemCreateManyInput['category'];
    nameEn: string;
    nameAr: string;
    unit: string;
    unitCost: number;
    reorderPoint: number;
    avgDailyUsage: number;
    opening: number;
    belowReorder?: boolean;
    expiring?: boolean;
  }) {
    itemN += 1;
    const id = `inv_${itemN}`;
    items.push({
      id,
      category: opts.category,
      nameEn: opts.nameEn,
      nameAr: opts.nameAr,
      unit: opts.unit,
      unitCost: opts.unitCost,
      reorderPoint: opts.reorderPoint,
      avgDailyUsage: opts.avgDailyUsage,
      branchId,
    });
    // opening
    movements.push({ inventoryItemId: id, occurredAt: START, reason: 'OPENING', quantity: opts.opening });
    // purchases / production in
    let runningIn = 0;
    const inEvents = faker.number.int({ min: 2, max: 5 });
    for (let i = 0; i < inEvents; i++) {
      const qty = faker.number.int({ min: Math.round(opts.opening * 0.2), max: Math.round(opts.opening * 0.6) });
      runningIn += qty;
      movements.push({
        inventoryItemId: id,
        occurredAt: faker.date.between({ from: START, to: NOW }),
        reason: opts.category === 'ROASTED' ? 'PRODUCTION_IN' : 'PURCHASE',
        quantity: qty,
        reference: opts.category === 'ROASTED' ? `LH-2026-${faker.string.numeric(4)}` : `PO-${faker.string.numeric(4)}`,
        expiryDate: opts.expiring && i === 0 ? addDays(NOW, faker.number.int({ min: 6, max: 20 })) : null,
      });
    }
    // outflows: target a final level near/below reorder if requested
    const target = opts.belowReorder
      ? Math.round(opts.reorderPoint * 0.7)
      : Math.round(opts.reorderPoint * faker.number.float({ min: 1.5, max: 3 }));
    let toRemove = opts.opening + runningIn - target;
    const outEvents = faker.number.int({ min: 3, max: 7 });
    for (let i = 0; i < outEvents && toRemove > 0; i++) {
      const last = i === outEvents - 1;
      const qty = last ? toRemove : faker.number.int({ min: 1, max: Math.max(1, Math.round(toRemove / 2)) });
      toRemove -= qty;
      movements.push({
        inventoryItemId: id,
        occurredAt: faker.date.between({ from: START, to: NOW }),
        reason: weighted([
          { value: 'SOLD' as const, weight: 70 },
          { value: 'SAMPLED' as const, weight: 12 },
          { value: 'WASTED' as const, weight: 10 },
          { value: 'INTERNAL' as const, weight: 8 },
        ]),
        quantity: -qty,
      });
    }
  }

  // Green coffee (grams)
  addItem({ category: 'GREEN_COFFEE', nameEn: 'Green — Ethiopia Guji', nameAr: 'أخضر — إثيوبيا قوجي', unit: 'g', unitCost: 13, reorderPoint: 40000, avgDailyUsage: 1800, opening: 220000 });
  addItem({ category: 'GREEN_COFFEE', nameEn: 'Green — Colombia Huila', nameAr: 'أخضر — كولومبيا هويلا', unit: 'g', unitCost: 12, reorderPoint: 40000, avgDailyUsage: 1500, opening: 180000, belowReorder: true });
  addItem({ category: 'GREEN_COFFEE', nameEn: 'Green — Brazil Santos', nameAr: 'أخضر — برازيل سانتوس', unit: 'g', unitCost: 10, reorderPoint: 35000, avgDailyUsage: 1400, opening: 160000 });
  addItem({ category: 'GREEN_COFFEE', nameEn: 'Green — Blend base', nameAr: 'أخضر — أساس الخلطة', unit: 'g', unitCost: 11, reorderPoint: 50000, avgDailyUsage: 2600, opening: 320000 });
  // Roasted (grams, expiring)
  addItem({ category: 'ROASTED', nameEn: 'Roasted — Espresso Spring', nameAr: 'محمّص — إسبريسو الربيع', unit: 'g', unitCost: 22, reorderPoint: 15000, avgDailyUsage: 1200, opening: 60000, expiring: true });
  addItem({ category: 'ROASTED', nameEn: 'Roasted — House Blend', nameAr: 'محمّص — خلطة البيت', unit: 'g', unitCost: 20, reorderPoint: 15000, avgDailyUsage: 1100, opening: 55000, expiring: true });
  // Drip bags (sachets)
  addItem({ category: 'DRIP_BAGS', nameEn: 'Drip sachets', nameAr: 'أكياس التقطير', unit: 'sachet', unitCost: 350, reorderPoint: 800, avgDailyUsage: 40, opening: 4000 });
  // Packaging (units)
  addItem({ category: 'PACKAGING', nameEn: 'Stand-up bags 250g', nameAr: 'أكياس 250غ', unit: 'unit', unitCost: 250, reorderPoint: 1500, avgDailyUsage: 70, opening: 8000 });
  addItem({ category: 'PACKAGING', nameEn: 'Shipping boxes', nameAr: 'صناديق الشحن', unit: 'unit', unitCost: 500, reorderPoint: 500, avgDailyUsage: 25, opening: 3000, belowReorder: true });
  addItem({ category: 'PACKAGING', nameEn: 'Labels', nameAr: 'ملصقات', unit: 'unit', unitCost: 40, reorderPoint: 2000, avgDailyUsage: 90, opening: 12000 });

  await prisma.inventoryItem.createMany({ data: items });
  for (let i = 0; i < movements.length; i += 1000) {
    await prisma.stockMovement.createMany({ data: movements.slice(i, i + 1000) });
  }
  return items.length;
}

// ---------------------------------------------------------------------------

async function seedExpenses(branchId: string) {
  const categories: { type: Prisma.ExpenseCategoryCreateManyInput['type']; en: string; ar: string }[] = [
    { type: 'GREEN_COFFEE', en: 'Green coffee', ar: 'بن أخضر' },
    { type: 'PACKAGING', en: 'Packaging', ar: 'تغليف' },
    { type: 'SHIPPING', en: 'Shipping', ar: 'شحن' },
    { type: 'SALARIES', en: 'Salaries', ar: 'رواتب' },
    { type: 'RENT', en: 'Rent', ar: 'إيجار' },
    { type: 'MARKETING', en: 'Marketing', ar: 'تسويق' },
    { type: 'UTILITIES', en: 'Utilities', ar: 'خدمات' },
    { type: 'TECH', en: 'Technology', ar: 'تقنية' },
    { type: 'MAINTENANCE', en: 'Maintenance', ar: 'صيانة' },
    { type: 'EQUIPMENT', en: 'Equipment', ar: 'معدات' },
    { type: 'OVERHEAD', en: 'Overhead', ar: 'نفقات عامة' },
  ];
  await prisma.expenseCategory.createMany({
    data: categories.map((c) => ({ type: c.type, nameEn: c.en, nameAr: c.ar })),
  });
  const cats = await prisma.expenseCategory.findMany();
  const catId = (t: string) => cats.find((c) => c.type === t)!.id;

  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const months = eachMonthOfInterval({ start: startOfMonth(START), end: NOW });
  for (const m of months) {
    const monthDate = m < START ? START : m;
    expenses.push(
      { categoryId: catId('SALARIES'), incurredAt: monthDate, amount: 6_500_000, note: 'Monthly payroll', branchId },
      { categoryId: catId('RENT'), incurredAt: monthDate, amount: 2_000_000, note: 'Roastery rent', branchId },
      { categoryId: catId('UTILITIES'), incurredAt: monthDate, amount: faker.number.int({ min: 350_000, max: 550_000 }), branchId },
      { categoryId: catId('TECH'), incurredAt: monthDate, amount: 250_000, note: 'Software & hosting', branchId },
    );
    // variable spend through the month
    for (let i = 0; i < 6; i++) {
      const when = faker.date.between({ from: m, to: addDays(m, 27) });
      if (when > NOW) continue;
      expenses.push({
        categoryId: catId(pick(['GREEN_COFFEE', 'PACKAGING', 'SHIPPING', 'MARKETING', 'MAINTENANCE'])),
        incurredAt: when,
        amount: faker.number.int({ min: 300_000, max: 3_500_000 }),
        vendor: faker.company.name(),
        branchId,
      });
    }
  }
  await prisma.expense.createMany({ data: expenses });
  return expenses.length;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('Clearing existing data…');
  await clear();

  console.log('Seeding branches and users…');
  const { hq, branches, opsId } = await seedBranchesAndUsers();
  // HQ takes the bulk of orders; the two franchise cafes share the rest.
  const branchWeights = [
    { value: branches[0].id, weight: 68 },
    { value: branches[1].id, weight: 20 },
    { value: branches[2].id, weight: 12 },
  ];

  console.log('Seeding products…');
  const products = await seedProducts();
  console.log(`  ${products.length} SKUs`);

  console.log('Seeding customers and offers…');
  const customerIds = await seedCustomers(160);
  const offerIds = await seedOffers();

  console.log('Seeding orders (this can take a moment)…');
  const { orderCount, lineCount } = await seedOrders(products, customerIds, offerIds, branchWeights);
  console.log(`  ${orderCount} orders, ${lineCount} lines`);

  console.log('Seeding roast batches…');
  const batches = await seedRoastBatches(products, opsId, hq.id);
  console.log(`  ${batches} batches`);

  console.log('Seeding inventory…');
  const items = await seedInventory(hq.id);
  console.log(`  ${items} inventory items`);

  console.log('Seeding expenses…');
  const expenses = await seedExpenses(hq.id);
  console.log(`  ${expenses} expense entries`);

  console.log('Seeding connectors…');
  await seedConnectors();

  console.log('\nDone. Sign in with any of:');
  console.log('  owner@laheeb.coffee / laheeb1234 (full access)');
  console.log('  finance@laheeb.coffee / laheeb1234 (P&L access)');
  console.log('  manager@laheeb.coffee / laheeb1234 (Karada branch only)');
  console.log('  franchisee@laheeb.coffee / laheeb1234 (Erbil franchise only)');
  console.log('  viewer@laheeb.coffee / laheeb1234 (read-only, no P&L)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

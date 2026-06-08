# Laheeb Atlas — Products Variations Module (BRD)

> Source: uploaded BRD (2026-06-08). This module lets each product expose
> multiple sellable variations (size / grind / roast / flavor / origin /
> packaging) with their own price, cost, measurement, inventory impact, and
> reporting — selected during order creation and snapshotted onto orders.

## How it maps to the current system (implementation note)

The existing `Product` already behaves as a **sellable variation**: it has
`sizeLabel`/`sizeGrams`, `grind`, `roastLevel`, `origin`, `sellingPrice`,
`cogsPerUnit`, and an immutable unique `sku`; `OrderLine` already snapshots
`sku` + `unitGrossPrice` + `unitCogsSnapshot` (historical price/cost protection).
The chosen architecture therefore introduces a **parent `ProductGroup`** above
the existing products (the products become the variations), reusing the mature
pricing/cost-snapshot/order-editor/invoice/reports/search infrastructure rather
than duplicating it. The variation ID is the existing SKU (unique, immutable,
searchable, already on orders/invoices/reports).

---

## 1–5. Purpose, objective, problem, goals, scope
A product (parent) can have many sellable variations. Each variation has its own
price, optional cost logic, measurement unit, invoice display, inventory impact,
and reporting. Must be a core component affecting orders, invoices, costs,
inventory, sales/profit reports, dashboards, customer history. Scope: variation
creation, types/attributes, units, pricing, cost logic, inventory impact, order
+ invoice integration, reports/dashboards, historical price/cost protection,
search/filter/sort, permissions + audit, import/export, validation.

## 6. Product structure
- **Main product (parent):** e.g. "Espresso Spring".
- **Variation (sellable):** e.g. "Espresso Spring — 500g — Whole Bean".
- **Sellable unit:** the exact selected variation is saved on the order, invoice,
  reports, and customer history (not just the parent name).

## 7. Variation types
Size · Grind · Roast level · Flavor/Add-on · Origin · Packaging type · Pack
quantity · Weight per unit · Product format · Custom (extensible without dev).

## 8. Measurement units
Gram, Kilogram, Piece, Sachet, Box, Bag, Pack, Bundle, Cup, Liter, mL. Each
variation: unit type, value, label, optional conversion (e.g. Box=1 sell unit,
10 sachets × 15g = 150g).

## 9. Required variation fields
Basic (id, parent, name, display name, type, status, description, notes) ·
Measurement (unit, value, total weight, conversion, pack qty, weight/item) ·
Pricing (selling, discount eligibility, min/wholesale/channel price, effective
dates, status) · Cost (direct / component / batch, total, effective date,
history, margin) · Inventory (linkage, track y/n, deduction logic for product/
raw/packaging, batch linkage, low-stock threshold) · Order/invoice (show on
invoice, display name, price override, allow discount/extras) · Reporting
(sales/product category, line, channel, dashboard visibility, grouping).

## 10. Variation ID
Unique, immutable after creation, searchable, on admin tables, linked to orders/
invoices/inventory/reports/dashboards. Format dev-decided → **use existing SKU**.

## 11–13. Creation, order + edit integration
Create variations from the parent product's Variations tab → unique ID generated
→ active variations selectable in order creation. Order/edit: pick parent → see
its active variations → pick one, qty, discount, extras, notes; totals auto-calc;
exact variation stored; edits recalc invoice/reports/inventory/profit/history and
are audited.

## 14–15. Pricing + historical price protection
Price is per variation (not shared across the parent). Features: price history,
effective-date pricing, deactivate/schedule prices, optional wholesale/channel/
promo price, permissioned manual override. On sale, snapshot variation id/name/
unit price/discount/final price/cost. **Updating a price never changes past
orders/reports.** (Already satisfied: OrderLine snapshots price + cost.)

## 16–17. Cost logic + historical cost protection
Per-variation cost: (A) direct, (B) component-based (beans + cardamom + bag +
label + overhead), (C) batch-based. On sale/production, snapshot the cost used.
Future cost changes affect only future orders/batches; cost history visible per
variation. (Already satisfied for sales via `unitCogsSnapshot`; component/batch
costing is a later phase.)

## 18. Inventory impact
Per-variation behaviour: finished-stock deduction / raw-material deduction /
batch-based deduction / no tracking. Fields: track y/n, linked inventory item +
raw + packaging, deduction qty/unit, batch logic, low-stock alert, negative-stock
permission.

## 19. Invoices
Show parent + variation name, qty, unit price, discount, extras, line total,
notes — the exact selected variation, not just the parent.

## 20. Dashboards
Best-selling parent & variation, revenue/quantity/profit/avg-price by variation,
stock + low-stock + slow-moving + high-margin by variation, discount usage,
sales by city/segment/variation, trend by variation.

## 21. Reports
Sales / revenue / gross profit / margin / quantity / inventory consumption /
customer purchases / city / channel / discount / cost-change-impact / price-
history / stock-movement / batch-consumption — all by variation. Variation
detail in customer/order/inventory/financial statements where relevant.

## 22. Search / filter / sort
By variation id, parent id, name, size, grind, roast, origin, packaging, price,
status, unit; filters incl. price/cost/stock range; sort by name/price/cost/
margin/stock/newest/best-selling/revenue/profit.

## 23. Status
Draft / Active / Inactive / Archived. Only Active appears in new orders; archived
stay in historical reports; old orders keep archived variations unchanged.

## 24. Validation
Unique non-empty variation; parent required; price required before activation;
unit required when relevant; flag duplicates under same product; non-negative
cost/price/deduction; archived not selectable in new orders; deletes don't break
old orders.

## 25–26. Permissions + audit
Role-gated: view / create / edit basic / edit price / edit cost / edit inventory
logic / activate / archive / override price / view cost+profit / export. Audit
every create/edit/price/cost/status/inventory/archive/override with user + time +
old→new values.

## 27. Import / export
Bulk CSV import (parent, name, type, unit, price, cost, inventory linkage,
status); export all/active/price-list/cost-list/stock-list/performance.

## 28. API / integration readiness
Stable variation IDs callable by store/POS/accounting/inventory/CRM/loyalty/
delivery/app/website.

## 29. Recommended DB logic
Product · Variation · VariationAttribute · VariationPrice · VariationCost ·
OrderItem (with product+variation name/price/cost **snapshots**). Adapted here:
`ProductGroup` (parent) + existing `Product` (variation) + existing snapshotting
OrderLine; price/cost-history tables are Priority-2/3.

## 32. Critical business rules
1 product → many variations; variation → one parent; own price/cost/inventory;
only Active in new orders; archived visible in history; old orders keep their
variation snapshot; future price/cost changes never touch history; variation IDs
unique + never edited; invoice shows the variation; dashboards/reports support
product- and variation-level analysis.

## 34. Development priority
- **P1 — Core:** variation data structure, ID, parent linkage, pricing, order +
  invoice integration, historical price snapshot.
- **P2 — Financial/operational:** variation cost logic, historical cost snapshot,
  inventory impact, reports + dashboards, audit log.
- **P3 — Scale/advanced:** import/export, channel + wholesale pricing, scheduled
  prices, advanced filters, API, external integrations.

## 33/35. Acceptance + final note
Admin creates variations per product; each has its own price/units/attributes;
active variations appear in orders; order total auto-calcs from variation price;
invoice shows the exact variation; reports/profit/inventory work at variation
level; historical price/cost protected; variation IDs unique+immutable; search/
filter/sort + audit present; archived stay in old records; scales to new products
without redesign.

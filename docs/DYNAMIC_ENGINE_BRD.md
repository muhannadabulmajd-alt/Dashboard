# Laheeb Atlas — Dynamic Data Movement, Centralized Calculation & Automated Inventory-Cost Engine (BRD Addendum)

> Source: uploaded BRD addendum (2026-06-08). Goal: one transaction
> automatically updates every related module — inventory, cost, profit,
> customers, reports, dashboards, statements — so Laheeb Atlas is the single
> source of truth.

## Status map (what already exists vs. new — implementation note)

**Already live** (built earlier): order → inventory deduction from a variation's
linked finished-goods item with reverse+reapply on edit (§10–11); per-order-line
**price + COGS snapshots** = historical protection (§13); product **cost recipe**
(BOM → cogsPerUnit) (§6, free-text components); reports/dashboards recompute live
from orders/snapshots (§14–15); **audit log + viewer** (§22); customer/product
metrics computed live.

**New engine pieces this addendum adds:**
1. **Recipe ↔ inventory linkage** — recipe components reference real InventoryItems
   so cost is dynamic, orders deduct the actual components, and capacity is known.
2. **FIFO cost layers** (§8) — per-purchase cost layers, consume oldest first,
   active-layer cost drives product cost, auto-switch when a layer empties.
3. **Green → roasted bean costing** (§5) — roast-yield % → roasted cost/kg → /size.
4. **Production capacity & availability** (§7, §16) — max producible units, limiting
   component, can/cannot-produce status.
5. **Cost-change notifications & alerts** (§9, §17) — layer switch, margin drop,
   low/zero stock, cannot-produce, sold-below-cost, with severity levels.
6. **Status-aware deduction / cancel reversal** (§11.3, §12) — cancelled/returned
   orders reverse their stock + impact via reversal records, not deletes.
7. (Concept) **Centralized transaction ledger** (§4) unifying stock/cost/financial
   movement.

---

## 1–4. Principle & architecture
One transaction triggers all related calculations. Build around a centralized
transaction ledger (id, type, date, module, item/product/customer/order, qty in/out,
unit cost, total, user, source doc, notes, status, audit). Single source of truth:
product cost is **calculated** from components, never hand-typed. A dynamic
recalculation engine updates dependent values on each relevant transaction.

## 5. Green → roasted bean cost
Capture green-bean landed cost (purchase + shipping + handling + customs → cost/kg).
Per-bean roast-yield assumptions by roast type (e.g. Light 88%, Medium 85%, Dark 82%,
admin-editable). **Roasted cost/kg = green cost/kg ÷ yield (+ roasting cost/kg).**
Auto-compute estimated roasted cost per roast type and per size (g, 200/250/500g, 1kg),
available to product cost.

## 6. Product cost from BOM
Each variation has a recipe (component, qty, unit). **Product cost = Σ component
costs/unit.** Show components, qtys, unit costs, total cost, price, gross profit,
margin, last-calc date, cost method, active version, history.

## 7. Production capacity
Per component: **possible units = available qty ÷ required qty**; producible = the
**minimum** across components (the limiting component). Show producible qty, limiting
component, sufficient vs insufficient components, and shortfall to hit a target qty.

## 8. Inventory cost layers (FIFO)
New stock at a new cost creates a **separate cost layer**, not an overwrite. Consume
**oldest layer first**; when a layer hits zero, auto-switch to the next; product cost
uses the active layer; history keeps the cost used at sale time. FIFO is the
recommended method (vs weighted-average).

## 9 & 17. Cost-change notifications & alerts
Notify admins on: new stock at a different cost; old layer about to finish; layer
switch; product cost change; margin below threshold; price too low vs new cost;
product unprofitable; key component low; product unproducible (missing component);
negative-stock attempt; order edit changing stock/profit; manual adjustment; recipe
change. Severity: Low / Medium / High / Critical. Channels: in-app, dashboard alert,
email (optional), external (future).

## 10–12. Order impact, edit & reversal
Order create updates order/invoice, customer history (count, spend, last order,
purchased products/variations, segment), product + variation performance, inventory
(finished goods or components, correct FIFO layers, low-stock), reports, dashboards,
statements — with price/cost/discount snapshots. Edit reverses + recomputes. Cancel
marks cancelled, **reverses** inventory/sales/spend/profit via reversal transactions,
keeps the historical record + audit (never hard-delete important transactions).

## 13. Historical protection
Per order item, snapshot: product/variation id + name, unit price, discount, final
price, **cost**, component-cost breakdown, FIFO layers used, qty, line cost, gross
profit/margin. Never recompute old profit with new costs unless an intentional,
permissioned correction is run.

## 14–16. Dashboards, reports, availability
Dashboards/reports/statements derive from transactions + snapshots and refresh after
each related transaction. Widgets: inventory value, available green/roasted/packaging/
finished, producible-today, blocked-by-missing-component, low stock, cost-increase &
margin-drop alerts, best sellers, today's revenue/profit/orders/customers, consumption,
capacity, current cost & margin per product. Availability status per variation:
Available / Low stock / Can produce / Cannot produce / Missing component / Cost needs
review / Inactive.

## 18–19. Dependency map & calculation flows
Documents the per-action flows (green-bean purchase, roasting batch, packaging
purchase, product creation, order creation) and the dependency graph (product cost ←
green/roast/packaging/labor/overhead/recipe; order profit ← price/discount/cost
snapshots/qty; inventory ← purchases/production/orders/returns/waste/adjustments).

## 20–22. Automation, overrides, audit
Automate cost/inventory/FIFO/capacity/margin/alerts/dashboards/reports/history/invoice/
movements/audit. Manual overrides only with permission + audit (reason, old→new,
recalc, protect history). Audit every important change (who/what/when/old/new/reason +
related order/item/product/customer).

## 23. Recommended data structure
InventoryItem · InventoryTransaction · **InventoryCostLayer** (item, purchase txn,
starting/remaining qty, unit cost, date, status) · ProductRecipe (variation, component
item, required qty, unit, deduction method, required?) · ProductCostSnapshot · OrderItem
snapshot (incl. component-cost breakdown + FIFO layers consumed).

## 24. Example (FIFO)
Old 50 bags @300 + new 1,000 @400 → two layers; product cost stays 300 until the 50
finish, then auto-switches to 400; cost + margin update; admin notified; future orders
use 400; old orders unchanged.

## 25. Acceptance
Green→roasted auto-costs; roasting updates roasted inventory + cost; packaging creates
layers; product cost from components; producible-units shown; orders auto-deduct +
update customers/products/invoices/reports/dashboards/statements; edit/cancel reverse +
recompute; history protected; new cost auto-activates when old stock consumed; admins
notified on margin-affecting cost changes; everything audited; no manual multi-area
updates; one connected engine.

# Laheeb Atlas — BRD Addendum

## Product Management, Variations UX, System Lists, Branches & Section Guidance

### 1. Purpose
Improve the data-management experience around Products, Product groups, Product
variations, System lists, Branches/franchises, and per-section user guidance.
The split between **Products** and **Product Groups** confuses users (where to
start, where the main product vs. variation goes, how pricing/costing/inventory
connect). Make the system easier, smoother, more flexible and comprehensive
while staying scalable for expansion, branches, franchise, reporting, automation.

### 2. Strategic objective
Simple enough for daily users, strong enough for complex product structures,
branches, lists, inventory, orders, invoices, reports. Guide the user step by
step; they should not need to understand the internal DB structure.

### 3. Merge Products and Product Groups
Merge into one unified section: **Products & Variations** (the place to manage
both main products and their sellable variations).

### 4. New product-management structure
One place for: product list, creation, variations, prices, costs, inventory
linkage, recipes/BOM, product status, variation status, reports summary, usage
in orders, info/guidance.

### 5. Recommended guided flow
1. **Create main product** (e.g. Turkish Coffee). Fields: name EN/AR, category,
   description, status, image (optional), code (auto-gen), type.
2. **Add variations** (e.g. 200g Plain Medium / 200g Cardamom / 500g / 1kg).
   Each: name, type, unit, size/qty, selling price, cost logic, inventory
   connection, status.
3. **Define cost components** (roasted beans 250g + bag + label + sticker +
   optional labor) → auto-calculate cost.
4. **Define inventory behavior** (deduct finished stock / raw / roasted /
   packaging / production batch / none).
5. **Make available for orders** — only active, configured variations appear.

### 6. Product & Variation page layout (tabs)
1. **Overview** — name, code, category, status, description, #active variations,
   sales summary, inventory status.
2. **Variations** — rows: id, name, type, unit, price, cost, margin, stock,
   active/inactive, edit.
3. **Pricing** — current price, price history, scheduled prices, wholesale,
   channel price.
4. **Cost & Recipe** — components/BOM, roasted-bean/packaging/labels/labor,
   total cost, gross margin, cost history.
5. **Inventory** — linked items, available stock, producible qty, missing
   components, low-stock alerts, FIFO cost layers.
6. **Order Usage** — available in orders?, order-screen appearance, invoice
   display name, allow discount?, allow price override?
7. **Reports Summary** — qty sold, revenue, gross profit, best/slow sellers,
   margin performance.
8. **Activity Log** — created/var-created/price/cost/inventory/status changes,
   user, timestamp.

### 7. Product creation wizard
Steps: (1) basic details, (2) variation setup, (3) pricing, (4) cost & recipe,
(5) inventory behavior, (6) review & activate (summary → save Draft / Active /
Inactive).

### 8. Simplicity requirement
Powerful but not complicated. Avoid technical terms (parent/child product, DB
relation, SKU hierarchy). Use: main product, product variation, selling price,
cost elements, inventory items used, available in orders, show on invoice.

### 9–11. System Lists management
Owner & Admin manage list values directly (add/edit/rename/translate/
deactivate/archive/reorder/remove-when-safe; EN+AR labels). Applies to:
channels, governorates, cities, product categories, product types, variation
types, units, grinds, roast levels, packaging types, customer sources, order
statuses, payment statuses, inventory categories, branch types, etc.

**Protection rules:** only Owner/Admin edit; values used in history are
archived/deactivated, not deleted; renames keep history understandable; block
delete of in-use values unless a safe replacement/merge is chosen; audit every
change. (e.g. "Online Store" used in old orders → rename/deactivate/archive/
merge, never hard-delete.)

**Page UI:** per-list table with search, add, edit, AR/EN label, internal code,
status, sort order, used-count, archive, audit history.

### 12–15. Branches & Franchises management
Owner & Admin manage branch details fully (add/edit/remove-when-safe/archive/
activate/deactivate, franchise status, governorate, names EN/AR, code [unique,
protected after use], contact, address, franchise/ownership details).

**Fields:** Basic (id, code, name EN/AR, type HQ/Company-owned/Franchise,
status, governorate, city, address, street, notes); Contact (phone, email,
manager name/phone/email); Franchise (owner name/phone/email, agreement
start/end, status, notes); Operational (opening date, hours, delivery, POS,
inventory tracking, warehouse).

**Protection rules:** unique non-duplicate code; branches with linked orders/
inventory/customers/users are archived not deleted; history keeps original
linkage; franchise users see only their branch; HQ users see all per permission.

**Permissions:** Owner = all branches/franchise/HQ/reports/lists; Admin = per
permission; Franchise = own branch/orders/customers/inventory/reports only.

### 16–19. Per-section information/guidance
Each data-management section gets an independent **info/guide** (collapsible
"How to use this section" box at top + field-level helper text + tooltips).
Guides per section: Products & Variations, Orders, Customers, Inventory, Roast
Batches, Branches & Franchises, System Lists (each explaining purpose, what to
enter, why it matters, cross-system impact, steps, required/optional fields,
common mistakes, examples). Field helper text for product code, variation type,
unit, cost components, branch code, system-list value, etc.

### 20. Data-management home cards
Products & Variations · Orders · Customers · Inventory · Roast Batches ·
Branches & Franchises · System Lists (with one-line descriptions).

### 21–22. UX principles & change-impact messages
Guided not technical; simple business language; clear next steps; group related
actions; warnings before dangerous actions; confirmations after; show impact
before saving. Examples: editing variation cost → "affects future calculations
only; historical orders unchanged"; archiving branch → "no longer available for
new orders, history stays linked"; deleting used list value → "already used,
cannot delete; deactivate or merge"; editing recipe → "may update future cost
and production capacity."

### 23. Acceptance criteria
Products+Groups merged into one clear **Products & Variations**; create products
& variations from one place; guided flow; easier variation price/cost/inventory;
smooth variation selection in orders; Owner/Admin manage system lists & branch
details; used list values & branches protected from unsafe deletion; each
section has its own guide; helper text on important fields; impact warnings on
dangerous changes; easier without losing depth.

### 24. Priority
- **P1 (critical UX & structure):** merge Products + Groups; unified Products &
  Variations; improve variation creation flow; smooth variation use in orders.
- **P2 (admin control):** Owner/Admin edit system lists; Owner/Admin edit branch
  details; safe archive/deactivate logic.
- **P3 (guidance):** per-section info sections; field helper text; change-impact
  warnings.

### 25. Strategic note
Don't force users to think like developers. Guide the business workflow: add
product → add variations → add price → add cost components → link inventory →
use in orders → auto-update invoices/inventory/reports/dashboards/statements.

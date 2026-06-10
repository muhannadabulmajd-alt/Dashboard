# Laheeb Atlas — BRD Addendum

## Simple Accounting, Finance Dashboard, P&L, Balance Sheet & Dynamic Sync

### 1–4. Purpose & philosophy
Upgrade Finance from basic money-tracking into a **simple but useful accounting
module** — easy for a non-accountant, strong enough for reliable reports. Simple
business terms in the UI (Money In/Out, Expenses, Purchases, Payables,
Receivables, Accounts, Parties, Shareholders, Reports, P&L, Balance Sheet);
structured accounting logic in the backend. **One business transaction updates
all related financial records automatically.**

### 5. Section structure
Finance Dashboard · Record Entry Wizard · Ledger · Money In · Money Out ·
Expenses · Purchases · Payables · Receivables · Accounts · Parties ·
Shareholders & Capital · P&L · Balance Sheet · Cash Flow Summary · Reports ·
Finance Settings · Guided Help.

### 6. Dashboard
Cards: cash on hand, bank balance, total balance, revenue, expenses, net &
gross profit, COGS, payables, receivables, capital, inventory value, net cash
movement, overdue payables/receivables. Widgets: revenue (today/week/month, by
channel/branch/product/variation); expenses (by category/supplier/branch, fixed
vs variable, trend); cash (in/out/net/runway); dues (due soon, overdue, top
parties); profitability (gross/contribution margin, operating profit, profit by
product/variation/branch/channel).

### 7–8. Record Entry Wizard
"What do you want to record?" → guided form per type: sales income, customer
payment received, expense paid, expense to pay later, supplier purchase paid,
supplier purchase on credit, supplier payment, customer receivable, capital
contribution, owner withdrawal, bank transfer, cash adjustment, refund,
order-related payment, inventory purchase, other. Each type has defined system
impact (cash/bank, revenue, payables, receivables, inventory, cost layer, P&L,
statements). Detailed per-type field + impact specs in §8.1–8.10.

### 9. Accounts
Create money accounts (cash on hand, bank, POS, Zain Cash, FastPay,
AsiaHawala, gateway, branch cash box). Fields: id, name, type (Cash/Bank/Digital
wallet/Gateway/Other), currency, opening balance, current balance, branch,
status, notes. Show balance movement per account.

### 10. Parties
Types: supplier, customer, retailer, distributor, shareholder, employee,
service provider, other. Fields: id, name, type, phone, email, address, branch,
opening balance, payables balance, receivables balance, statement, notes.

### 11–12. Payables & Receivables
Payables = we owe; Receivables = owed to us. Fields: id, party/customer, date,
due date, amount, currency, category, related purchase/expense/order, branch,
status (unpaid/partial/paid/overdue), notes. Reports: totals, by party, by due
date, overdue, aging, partial-payment history.

### 13. Expenses
Categories editable via System Lists (rent, salaries, utilities, delivery,
marketing, packaging, maintenance, software, office, transport, fuel, internet,
bank fees, cleaning, franchise support, other). Fields: id, date, category,
subcategory, amount, currency, payment status, paid-from account, party, branch,
notes, attachment/receipt, recurring.

### 14. Revenue streams
Online store, social, POS, cafe, wholesale, resellers, corporate, events,
franchise, other — auto from order channel where possible; editable via System
Lists.

### 15. Dynamic sync (the heart of it)
- **Orders:** create order → record revenue; receivable if unpaid; cash/bank if
  paid; COGS from cost snapshots; gross profit; customer statement; product/
  variation profitability; P&L; dashboard.
- **Inventory purchase:** qty + value up; cash down if paid; payable if unpaid;
  cost layer; balance sheet.
- **Product cost:** sale → COGS from snapshot → margin → profitability → P&L.
- **Customer:** pay-later → receivable; payment received → receivable down,
  cash up; statement.
- **Supplier:** credit purchase → payable + statement; payment → payable down,
  cash down, statement.
- **Branch:** every transaction supports branch tagging for branch/governorate/
  channel reports.

### 16. P&L
Revenue (gross, discounts, refunds, net) → COGS (product/bean/packaging/
production/direct) → Gross profit (+ %) → Operating expenses → Operating profit.
Filter by date, branch, channel, product, variation, customer type, stream.

### 17. Balance Sheet (auto-generated)
Assets (cash, bank, receivables, inventory value, equipment, other) ·
Liabilities (supplier payables, expense payables, loans, other) · Equity
(capital contributed, owner withdrawals, retained earnings).

### 18. Cash Flow Summary
Cash In (sales collected, receivables collected, capital, other) − Cash Out
(supplier payments, expenses paid, withdrawals, inventory paid, other) = net.
Filter by date/account/branch/party.

### 19. Ledger
Every money movement: date, txn id, type, description, money in, money out,
account, party, category, branch, related order/invoice/purchase, created by,
notes. Search/filter/sort/export/attachment/edit-with-permission/reversal.

### 20–21. Guided help & field helper text
Per-subsection guides (dashboard, record entry, ledger, payables, receivables,
accounts, parties, P&L, balance sheet). Field helper text (payment status,
account, party, category, due date, branch).

### 22. Backend accounting logic
Each transaction auto-classified into Asset/Liability/Equity/Revenue/COGS/
Expense without the user managing it. E.g. "inventory purchase on credit" → user
sees supplier/item/qty/cost/due; system increases inventory asset + payables.

### 23. Reversal & audit
No direct delete of important records: edit-before-approval, reverse, or
correction entry. Audit log: who created/edited, what changed, old/new value,
timestamp, reason, related entity.

### 24. Currency & exchange rate
IQD main reporting currency; USD when needed; **save fx snapshot per
transaction** (changing today's rate never alters old transactions); reports in
IQD; detail shows original + converted.

### 25. Reports
Basic (revenue, expense, cash movement, payables, receivables, account balance,
ledger). Management (P&L, balance sheet, cash flow, gross margin, product/branch/
channel profitability, expense category, supplier/customer/shareholder
statement). Aging (payables, receivables). Export PDF + CSV.

### 26. Permissions
view dashboard, record txn, edit txn, reverse txn, view P&L, view balance sheet,
view cost/profit, view cash accounts, manage accounts, manage parties, manage
shareholders, export, change exchange rate, approve corrections. Sensitive
reports → Owner + authorized Admin.

### 27. Home screen layout
Top (date/branch/currency/rate/record button) · summary cards · alerts (overdue
dues, low cash, negative margin, unpaid invoices, large expense) · quick actions
· main sections.

### 28. Acceptance criteria
Record without accounting knowledge; orders auto-update revenue/receivables/
cash/COGS/profit; inventory purchases auto-update value/cash/payables; expenses
in P&L; payables/receivables tracked; statements auto-generated; P&L + balance
sheet auto-generated; balances dynamic; fx snapshots saved; per-section guides;
understandable/filterable/exportable reports; simple UI, reliable backend.

### 29. Priority
- **P1 — Core engine:** Record Entry Wizard · Ledger · Accounts · Parties ·
  Payables · Receivables · Order & inventory sync.
- **P2 — Management reports:** P&L · Balance Sheet · Cash Flow · product/branch
  profitability · customer/supplier statements.
- **P3 — Usability/control:** guided help · field helper text · alerts · export
  · permissions · audit & reversal.

### 30. Strategic note
Not complicated accounting software — a simple financial command center that
answers: how much did we sell/spend, how much cash, who owes us / we owe,
which products/branches are profitable, are we making profit, what's our
financial position — by syncing finance with orders, inventory, products,
customers, suppliers, branches, reports.

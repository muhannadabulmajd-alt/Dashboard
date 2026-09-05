# AI Assistant Phase 2 Regression Matrix

This matrix is a permanent release gate for web AI and Telegram mutations. Database tests run only against local CI Postgres or a temporary database explicitly marked with `AI_PHASE2_DATABASE_ISOLATED=true`.

| Previous failure or risk | Permanent assertion |
| --- | --- |
| Order reported as created but missing from Atlas | The order, execution receipt, audit reference, and persisted PDF share the same record ID. A replay returns that stored result. |
| Order save failed after creating a customer | Every in-transaction checkpoint is failed independently; each attempt leaves no customer, order, finance row, or inventory movement. |
| Customer name, phone, or address disappeared during clarification | 160 English, Arabic, Iraqi-dialect, and mixed prompts must retain at least 98% exact structured customer records. |
| Phone number displayed as the customer name | Preview and persisted invoice fixtures assert independent name and normalized-phone fields. |
| Repeated confirmation created duplicate customers or orders | Concurrent and repeated confirmations must resolve to one customer, one order, one receipt, and one PDF. |
| Product mismatch or stale price/stock | Confirmation reloads and locks product state; changed product state marks the action stale with no write. |
| Missing or invalid payment account | Finance preconditions reject the action before mutation. User defaults are used only when explicitly configured. |
| Unauthorized or revoked Telegram confirmation | Cross-user and revoked-identity confirmation attempts leave the pending action and business data unchanged. |
| Branch-scoped Telegram order escaped its branch | The canonical order command stores the authenticated actor's active branch. |
| Multi-line spending lost classifications or decimals | Canonical finance fixtures assert line totals, three-decimal quantities, OPEX treatment, ledger rows, party, and account. |
| Spending partially committed | Every party, entry, line, payment, audit, cost-sync, and final-hook checkpoint is failed independently and rolls back the party, finance entry, ledger lines, stock layers, movements, and assets. |
| Raw structured tool data appeared in chat | Narrative and tool-contract tests prohibit untrusted structured payloads from being rendered as assistant prose. |
| False success or false “no data changed” after commit | Once the receipt exists, confirmation recovery returns the persisted success result even if a later delivery attempt fails. |
| Missing order/invoice link | Successful order results assert direct record, invoice, and document links. |
| Incomplete PDF | Invoice data and generated PDF fixtures assert customer name, phone, full address, items, totals, and a valid persisted PDF checksum. |
| Telegram PDF delivery failed or replayed twice | Outbox tests assert exact-once destination rows, delivery state, and user-scoped replay. |
| Expired action executed | Expired confirmation marks the action expired and creates no business record. |
| Prompt or attachment bypass | Unit suites cover tool allowlists, strict schemas, MIME sniffing, size limits, ownership, and injection-resistant attachment text. |

Release is blocked by any duplicate write, partial transaction, authorization failure, missing mutation PDF, reconciliation difference, or extraction score below 98%.

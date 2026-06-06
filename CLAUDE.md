# CLAUDE.md

Guidance for working in this repository.

## What this is

**Laheeb Operations Atlas** — a bilingual (AR/EN, RTL) BI dashboard for Laheeb Coffee, built on Next.js 16 (App Router) + Prisma 6 + PostgreSQL + Auth.js v5 + next-intl. Ten pages (Executive, Sales, Roastery, Inventory, Customers, Fulfillment, Offers, P&L, Compare, Franchise Readiness) plus admin (users, branches, uploads, connectors), a branded PDF deck + scheduled reports, and a system-connector framework — on a full auth/RBAC/i18n/filter foundation. New analytics follow the same pattern: pure tested metric in `src/lib/metrics` → repository → page.

## Running it (ephemeral container)

The container ships PostgreSQL 16 but it is not started by default:

```bash
bash scripts/dev-db.sh          # start Postgres + create laheeb role/db
pnpm install
pnpm prisma migrate deploy      # or `migrate dev` when changing the schema
pnpm db:seed                    # realistic sample data
pnpm dev                        # or: pnpm build && pnpm start
```

`.env` is git‑ignored; copy `.env.example`. Demo login: `owner@laheeb.coffee` / `laheeb1234`.

## Commands

- `pnpm test` — Vitest metrics tests · `pnpm typecheck` — `tsc --noEmit` · `pnpm build`
- `pnpm db:migrate` / `db:seed` / `db:reset`

## Architecture & conventions

- **Data flow:** page (server component) → `getPageContext()` (auth + role guard + filters + range) → **repository** (`src/server/db/repositories/*`, Prisma + branch scope) → **metrics** (`src/lib/metrics/*`, pure) → render. Exports reuse the same path.
- **`src/lib/*` must stay client‑safe** — no `@prisma/client` *runtime* import (type‑only `import type` is fine). This is why enum value lists/labels live in `src/lib/enums.ts` and metrics use structural input types.
- **Metrics are pure and unit‑tested.** Any KPI definition change goes in `src/lib/metrics` with a matching test in `tests/metrics`. Never compute KPIs ad‑hoc in pages.
- **Filtering is centralized** in `src/server/filters/where-builder.ts`. Every query goes through it so the global filter bar applies uniformly. `buildBranchScope()` enforces franchise/branch data isolation at the query layer — always AND it in for new repo queries.
- **RBAC:** capability map in `src/lib/rbac.ts`; guard server pages with `requireCapability(locale, cap)` (see `getPageContext`). Financial data requires `view:financial` / `export:financial`.
- **Money** is integer minor units + currency (`src/lib/money.ts`). **Dates** are stored UTC, rendered Asia/Baghdad (`src/lib/dates.ts`).
- **i18n:** `next-intl`, messages in `src/i18n/messages/{ar,en}.json`, default locale `ar`. Auth/role gating is in the dashboard layout + page guards (not middleware) so no Node code runs at the edge.

## Notes

- **CSV import** lives in `src/server/ingestion`: pure, tested `parsers.ts` (Zod) + `ingestCsv` orchestrator that upserts on natural keys (sku / externalId / orderNumber / batchNumber) so re-uploads are idempotent, and records an `UploadBatch`. UI at `/admin/uploads`; programmatic `POST /api/import`. Both gated by `upload:data`.
- **Reports** (`src/server/reports`): `buildDeckData` reuses repos+metrics; `Deck.tsx` is a `@react-pdf/renderer` document. `GET /api/reports/deck` (export:data); `GET /api/reports/scheduled` (CRON_SECRET) renders + **emails** the PDF via `email.ts` (Resend when `RESEND_API_KEY` is set, else a no-op log provider).
- **Connectors** (`src/server/connectors`): `resolveConnectorSource(connector)` returns a CSV payload that flows through `ingestCsv` (so syncs dedup like imports). `SAMPLE` and credentialed `HTTP_CSV` are wired; secrets are encrypted via `src/server/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`). `Connector`/`SyncRun` models; `/admin/connectors` + `POST /api/connectors/configure` (manage:connectors); `GET /api/connectors/sync` (CRON_SECRET).
- **Deploy/bootstrap:** `vercel.json` `buildCommand` runs `prisma migrate deploy` before build (auto-migrate on deploy). First-run admin: with an empty users table, signing in with `ADMIN_EMAIL`/`ADMIN_PASSWORD` env creates the OWNER (`src/server/auth/bootstrap.ts`, called from the credentials `authorize`); ignored once any user exists. `pnpm create-admin` is the CLI equivalent. Crons are daily-or-less for Vercel Hobby compatibility.
- Prisma is pinned to v6 (v7 requires a driver adapter + `prisma.config.ts`).
- `middleware.ts` triggers a Next 16 "use proxy" deprecation notice but works.

# Laheeb Operations Atlas

Internal Roastery & Commerce Intelligence dashboard for **Laheeb Coffee (قهوة لهيب)** — a bilingual (Arabic/English, RTL) business‑intelligence app that brings sales, roasting, inventory, customers, fulfillment, offers, and expenses into one always‑on view.

This repository covers the **MVP**, **Phase 2** analytics, and the reporting / franchise / connector roadmap — ten dashboard pages on a full auth/RBAC/i18n/filter foundation.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **PostgreSQL** via **Prisma 6**
- **Auth.js v5** (credentials, JWT sessions, no public sign‑up) with role‑based access control
- **next-intl** (Arabic default, full RTL) · **Tailwind CSS v4** · **Recharts**
- **Vitest** for the metrics unit tests

## Features in this iteration

- **Pages:** Executive Overview · Sales & Product · Roastery & Production · Inventory & Stock Health · Customers & CRM · Fulfillment & Delivery · Offers & Campaigns · P&L & Unit Economics (finance‑gated) · Compare · Cafe/Franchise Readiness
- **Global filter bar** (date range incl. a custom from/to picker, channel, city, product line, grind, branch) that drives every card, chart, table, and export via URL state
- **RBAC:** Owner/Admin, Finance, Roastery Ops, Sales/CRM, Branch Manager, Franchisee, Viewer — with branch data‑scoping enforced at the query layer
- **CSV export** for tables (UTF‑8 BOM so Arabic renders in Excel), audit‑logged
- **CSV import** (admin): products, customers, orders, and batches — dedup on natural keys (idempotent re‑uploads), row‑level validation, `UploadBatch` audit, downloadable templates, and a programmatic `POST /api/import`
- **Branded PDF management deck** (`/api/reports/deck`) + **scheduled owner/finance reports** (`/api/reports/scheduled`, cron‑protected) **emailed via Resend** (no‑op log fallback when no key is set)
- **Franchise module:** per‑branch economics + a composite readiness score, branch‑scoped accounts, branch management (`/admin/branches`)
- **System connectors** (`/admin/connectors`): pull external data through the same idempotent ingestion path — a built‑in sample connector and a **credentialed HTTP‑CSV connector with its token encrypted at rest (AES‑256‑GCM)**, plus paused placeholders and a cron sync endpoint
- **Seeded sample data** so every dashboard is populated on first run

## Architecture

Pages (server components) → `getPageContext` (auth + role guard) → **repositories** (`src/server/db/repositories`, Prisma + branch scope) → **metrics** (`src/lib/metrics`, pure & unit‑tested) → render. CSV export reuses the exact same filter + repository path, so exports always match what is on screen. The single filter→query translator lives in `src/server/filters/where-builder.ts`.

```
src/
  app/[locale]/(auth)/login        # login
  app/[locale]/(dashboard)/        # 4 pages + admin/users
  app/api/{auth,export}/           # Auth.js handler + CSV export
  server/{auth,db,filters,export}  # server-only logic
  lib/{metrics,money,dates,filters,rbac,enums}  # pure, client-safe
  components/{layout,filters,charts,kpi,data-table,ui}
prisma/{schema.prisma,seed.ts}
tests/metrics/                     # vitest
```

## Getting started

Requires Node 20+, pnpm, and a PostgreSQL database.

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET

pnpm prisma migrate dev       # create schema
pnpm db:seed                  # load realistic sample data
pnpm dev                      # http://localhost:3000  (redirects to /ar)
```

### Demo accounts (password `laheeb1234`)

| Email | Role | Sees |
|---|---|---|
| `owner@laheeb.coffee` | Owner | Everything incl. P&L |
| `finance@laheeb.coffee` | Finance | Everything incl. P&L |
| `sales@laheeb.coffee` | Sales/CRM | Sales & customers |
| `ops@laheeb.coffee` | Roastery Ops | Inventory & roastery |
| `viewer@laheeb.coffee` | Viewer | Read‑only, **no P&L** |

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Run / build / serve |
| `pnpm test` | Metrics unit tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Database lifecycle |

## Configuration

`.env` keys (see `.env.example`): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, and optional `NEXT_PUBLIC_USD_PER_IQD` (display‑only IQD→USD rate for the P&L page; currencies are never silently merged).

## Possible future work

- Vendor‑specific connectors (Shopify/Odoo/POS/courier) behind the existing `resolveConnectorSource` interface — the credentialed HTTP‑CSV connector is the working reference.
- Per‑page filter relevance (hide filters that don't apply to a given page) and a CI workflow running typecheck + tests on every push.

# Laheeb Operations Atlas

Internal Roastery & Commerce Intelligence dashboard for **Laheeb Coffee (قهوة لهيب)** — a bilingual (Arabic/English, RTL) business‑intelligence app that brings sales, roasting, inventory, customers, fulfillment, offers, and expenses into one always‑on view.

This repository is the **MVP (iteration 1)**: foundation + the four most important pages.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **PostgreSQL** via **Prisma 6**
- **Auth.js v5** (credentials, JWT sessions, no public sign‑up) with role‑based access control
- **next-intl** (Arabic default, full RTL) · **Tailwind CSS v4** · **Recharts**
- **Vitest** for the metrics unit tests

## Features in this iteration

- **Pages:** Executive Overview · Sales & Product View · Inventory & Stock Health · P&L & Unit Economics (finance‑gated)
- **Global filter bar** (date range, channel, city, product line, grind) that drives every card, chart, table, and export via URL state
- **RBAC:** Owner/Admin, Finance, Roastery Ops, Sales/CRM, Branch Manager, Franchisee, Viewer — with branch data‑scoping enforced at the query layer
- **CSV export** for tables (UTF‑8 BOM so Arabic renders in Excel), audit‑logged
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

## Roadmap (next iterations)

- Pages: Roastery & Production, Customers & CRM, Fulfillment & Delivery, Offers & Campaigns, Compare
- CSV **import** pipeline (dedup on natural keys) to replace seed data
- Branded PDF management deck + scheduled owner/finance reports
- Franchise module with scoped franchisee accounts; system connectors (store/POS/accounting/courier) behind the same repository interface

# Deploying Laheeb Operations Atlas to production

Target stack: **Vercel** (Next.js host) + **Neon** (serverless PostgreSQL). Substitute Supabase/another Postgres if you prefer — only the connection string changes. End to end this takes ~10 minutes.

> The app is production-ready: `pnpm build` is clean, `prisma migrate deploy` provisions the schema, and HTTPS + security come from Vercel automatically.

## 1. Create the database (Neon)

1. Create a project at <https://neon.tech>.
2. Copy **two** connection strings from the dashboard:
   - **Pooled** (host contains `-pooler`) → used by the app at runtime: `DATABASE_URL`.
   - **Direct** (no `-pooler`) → used only to run migrations from your machine.

## 2. Import the repo into Vercel

1. At <https://vercel.com/new>, import `muhannadabulmajd-alt/Dashboard`.
2. Framework preset: **Next.js** (auto-detected). Leave build/install defaults — `postinstall` runs `prisma generate`.
3. Add the environment variables below (Project → Settings → Environment Variables), then deploy.

## 3. Environment variables (Vercel)

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (append `?sslmode=require` if not present) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` |
| `CRON_SECRET` | `openssl rand -hex 32` (guards the report/connector cron endpoints) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` (encrypts connector credentials at rest — **do not change after storing secrets**) |
| `NEXT_PUBLIC_USD_PER_IQD` | e.g. `0.00076` (display-only IQD→USD rate on the P&L page) |
| `RESEND_API_KEY` | *(optional)* enables emailed scheduled reports; leave empty to skip |
| `REPORT_FROM` | *(optional)* e.g. `Laheeb Atlas <reports@yourdomain.com>` (must be a Resend-verified domain) |
| `REPORT_RECIPIENTS` | *(optional)* comma-separated; defaults to active owner/admin/finance users |

## 4. Provision the schema + first admin

There is **no public sign-up**, so create your owner account explicitly. Run these once from your machine, pointing at the **direct** Neon URL:

```bash
git clone https://github.com/muhannadabulmajd-alt/Dashboard && cd Dashboard
pnpm install

export DATABASE_URL="<NEON_DIRECT_URL>"
pnpm prisma migrate deploy            # create all tables
ADMIN_EMAIL="you@laheeb.coffee" ADMIN_PASSWORD="a-strong-password" pnpm create-admin
```

`create-admin` upserts a single OWNER (and an HQ branch if none exists) **without touching any other data**. Then sign in and create the rest of your users from **/admin/users**.

> **Demo vs production data:** `pnpm db:seed` loads the full sample dataset but **wipes the database first** — use it only for a demo/staging environment, never on a live database you care about.

## 5. Access

After the Vercel deploy finishes you get `https://<your-project>.vercel.app`:

- `/` → redirects to the default locale (`/ar`); login is at `/ar/login` or `/en/login`.
- Sign in with the owner account from step 4 (Owner role → full access incl. P&L, admin, connectors).

## 6. Scheduled jobs & integrations

- **Crons** are declared in `vercel.json` (weekly/monthly reports, 6-hourly connector sync) and run automatically on Vercel — they call the endpoints with `Authorization: Bearer $CRON_SECRET`. (Vercel Cron availability depends on your plan.)
- **Email reports:** set `RESEND_API_KEY` + a verified `REPORT_FROM` domain; otherwise the pipeline runs but only logs.
- **Connectors:** configure the credentialed HTTP-CSV connector (or build vendor adapters behind `resolveConnectorSource`) at **/admin/connectors**; tokens are encrypted with `ENCRYPTION_KEY`.

## Continuous deployment options

**Option A — Vercel Git integration (simplest).** Connect the repo in the Vercel dashboard; Vercel auto-deploys every push to `main`. Nothing else needed.

**Option B — GitHub Actions → Vercel** (`.github/workflows/deploy.yml`, opt-in and skipped by default). To enable:

1. Repository → Settings → Secrets and variables → **Actions**:
   - **Variables:** `ENABLE_VERCEL_DEPLOY = true`
   - **Secrets:** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (from `vercel link` / your Vercel account).
2. Pushes to `main` then build and deploy to production via the Vercel CLI.

`.github/workflows/ci.yml` runs `typecheck` + `tests` on every push and PR regardless.

## Production checklist

- [ ] Strong, unique `AUTH_SECRET`, `CRON_SECRET`, `ENCRYPTION_KEY` set in Vercel (never committed).
- [ ] App uses the **pooled** `DATABASE_URL`; migrations run with the **direct** URL.
- [ ] Owner created via `create-admin`; demo seed **not** run on the live DB.
- [ ] `RESEND_API_KEY` set if you want emailed reports.
- [ ] Vercel auto-deploys on push to your default branch (enable the Git integration).

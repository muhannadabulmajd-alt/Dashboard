# Deploying Laheeb Operations Atlas to production

Target stack: **Vercel** (Next.js host) + **Neon** (free serverless PostgreSQL). No terminal needed — migrations run automatically on deploy and your admin account is created on first sign-in.

## 1. Create the database (Neon) — ~2 min

1. Create a project at <https://neon.tech> (free).
2. On the dashboard, open **Connection string**, turn the **"Connection pooling"** toggle **OFF**, and copy the string. It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require
   ```
   This single URL is your `DATABASE_URL` (the direct connection works for both migrations and the app at this scale).

## 2. Import the repo into Vercel

1. At <https://vercel.com/new>, import `muhannadabulmajd-alt/Dashboard` (or click the **Deploy with Vercel** button in the README).
2. Framework preset: **Next.js** (auto-detected). Don't change the build settings — `vercel.json` runs migrations and database reconciliation before the build.
3. Add the environment variables below, then **Deploy**.

## 3. Environment variables (Vercel)

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string from step 1 |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` |
| `ADMIN_EMAIL` | the email you want to log in with (becomes the Owner) |
| `ADMIN_PASSWORD` | a strong password for that account |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` (encrypts connector secrets — **don't change it later**) |
| `NEXT_PUBLIC_USD_PER_IQD` | e.g. `0.00076` (display-only IQD→USD rate) |
| `RESEND_API_KEY` | *(optional)* enables emailed scheduled reports |
| `REPORT_FROM` | *(optional)* e.g. `Laheeb Atlas <reports@yourdomain.com>` (Resend-verified domain) |
| `REPORT_RECIPIENTS` | *(optional)* comma-separated; defaults to owner/admin/finance users |
| `OPENAI_API_KEY` | OpenAI project secret; use different keys for Preview and Production |
| `AI_ASSISTANT_ENABLED` | `true` to expose the Owner/Admin assistant, `false` for immediate rollback |
| `AI_ASSISTANT_MODEL` | `gpt-5.4-mini-2026-03-17` |
| `AI_ASSISTANT_MAX_REQUESTS_PER_MINUTE` | `10` |
| `AI_ASSISTANT_HISTORY_RETENTION_DAYS` | `90` |

## 4. That's it — no terminal

- On deploy, **`prisma migrate deploy` creates all tables automatically**, then `pnpm check:reconciliation` blocks the build if linked finance, inventory, asset, due, order-status, or customer totals disagree.
- The **first time you sign in** with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, your **Owner account is created automatically**. This only happens once (when the database has no users); afterwards those env vars are ignored.

## 5. Access

Open `https://<your-project>.vercel.app` → it redirects to `/ar`; sign in at `/ar/login` or `/en/login` with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`. You're now the Owner (full access). Create the rest of your team from **/admin/users**.

> Paste env values **without** surrounding quotes; leading/trailing spaces are trimmed automatically. Use a real email format for `ADMIN_EMAIL`.

### Forgot the password / "Invalid email or password"?

`ADMIN_EMAIL` / `ADMIN_PASSWORD` double as a no-terminal reset. Signing in with them **creates the owner if missing, or resets that owner's password** to `ADMIN_PASSWORD`:

1. In Vercel → **Settings → Environment Variables**, set `ADMIN_PASSWORD` to a fresh value (no quotes/spaces); confirm `ADMIN_EMAIL` is exactly the address you log in with.
2. **Redeploy** (Deployments → `···` → Redeploy) so the new values take effect.
3. Sign in with `ADMIN_EMAIL` + the new `ADMIN_PASSWORD`.

Once you're in, you can **delete `ADMIN_PASSWORD`** from Vercel to turn the env-based login/reset off; manage users from **/admin/users** thereafter.

> **Do not run `pnpm db:seed` against this database** — it loads the demo dataset and **wipes existing data**. It's only for a throwaway demo/staging environment.

## 6. Optional extras

- **Scheduled report/connector crons** are declared in `vercel.json` (all run at most once/day, so they work on Vercel's free Hobby plan). They authenticate with `CRON_SECRET`.
- **Emailed reports:** set `RESEND_API_KEY` + a verified `REPORT_FROM` domain; otherwise reports generate but only log.
- **Connectors:** configure the credentialed HTTP-CSV connector at **/admin/connectors**; tokens are encrypted with `ENCRYPTION_KEY`.
- **Atlas AI Assistant:** add the five AI variables above separately to Vercel Preview and Production. Chats remain private in Atlas, expire after the configured retention period, and OpenAI requests use `store: false`.

## Manual alternative (if you prefer the CLI)

```bash
git clone https://github.com/muhannadabulmajd-alt/Dashboard && cd Dashboard && pnpm install
export DATABASE_URL="<NEON_URL>"
pnpm prisma migrate deploy
ADMIN_EMAIL="you@laheeb.coffee" ADMIN_PASSWORD="a-strong-password" pnpm create-admin
```

## Continuous deployment

- **Vercel Git integration (simplest):** connect the repo once; every push to `main` auto-deploys.
- **GitHub Actions → Vercel** (`.github/workflows/deploy.yml`, opt-in): set repo variable `ENABLE_VERCEL_DEPLOY=true` and secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- `.github/workflows/ci.yml` runs typecheck + tests on every push/PR.

## Production checklist

- [ ] Strong, unique `AUTH_SECRET`, `CRON_SECRET`, `ENCRYPTION_KEY` set in Vercel.
- [ ] `DATABASE_URL` set to the Neon connection string.
- [ ] `ADMIN_EMAIL` / `ADMIN_PASSWORD` set; first sign-in creates the Owner.
- [ ] Demo seed **not** run on the live DB.
- [ ] Separate Preview and Production `OPENAI_API_KEY` values configured; `AI_ASSISTANT_ENABLED=true` only where launch is intended.
- [ ] *(optional)* `RESEND_API_KEY` for emailed reports.

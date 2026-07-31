# FieldPay / Wellcraft Pay

Payroll and back-office web app for a construction company (Wellcraft). Site superintendents log daily hours; office/admin users run Paychex payroll export, certified payroll (WH-347), and client-side AR/AP aging.

---

## Table of contents

1. [Overview](#1-overview)
2. [Features](#2-features)
3. [Tech Stack](#3-tech-stack)
4. [Architecture Notes](#4-architecture-notes)
5. [Hosting & Deployment](#5-hosting--deployment)
6. [Environment Variables & Secrets](#6-environment-variables--secrets)
7. [Database](#7-database)
8. [Local Development Setup](#8-local-development-setup)
9. [Known Issues / Technical Debt](#9-known-issues--technical-debt)
10. [Handoff Contacts / Ownership](#10-handoff-contacts--ownership)

---



## 1. Overview

FieldPay (production: **Wellcraft Pay**) is a construction payroll and back-office tool. Superintendents enter daily time by worker, job site, and pay code against biweekly Paychex pay periods. Admins review hours, export Paychex Flex/SPI CSV, generate WH-347 certified payroll PDFs for prevailing-wage jobs, manage workers/job sites/classifications/rates/users, and use a **client-side-only** AR/AP aging tool that imports payables/receivables spreadsheets and exports Aging AP/AR workbooks. The live stack is a React SPA (Render static site) talking to an Express API (Render web service) backed by PostgreSQL (Render Postgres), with Paychex Flex as the payroll system of record.

---



## 2. Features

Roles in `users.role` (from `backend/db/schema.sql`): `superintendent`, `payroll_admin`, `system_admin`.

Frontend `isAdmin` (`frontend/src/context/AuthContext.jsx`) is true for `payroll_admin` **or** `system_admin`. Routes marked *admin* below use `<ProtectedRoute requireAdmin>`.


| Route                           | Page                                  | Who               | Backend / DB?                                       |
| ------------------------------- | ------------------------------------- | ----------------- | --------------------------------------------------- |
| `/login`                        | Login                                 | All               | Yes — `POST /api/auth/login`                        |
| `/daily-entry` (alias `/daily`) | Daily Entry                           | All authenticated | Yes — entries, workers, job sites, pay periods      |
| `/my-entries`                   | My Entries                            | All authenticated | Yes — entry list + CSV export for admins            |
| `/summary`                      | Summary                               | Admin             | Yes — period summaries / CSV                        |
| `/payroll` (alias `/submit`)    | Payroll                               | Admin             | Yes — payroll aggregation, adjustments, Paychex CSV |
| `/certified-payroll`            | Certified Payroll (WH-347)            | Admin             | Yes — WH-347 data + PDF generation                  |
| `/manage-bills`                 | **AR/AP**                             | Admin             | **No — browser-only; no API routes or tables**      |
| `/admin/users`                  | Manage Users                          | Admin             | Yes — user CRUD                                     |
| `/settings`                     | Settings (legacy/admin settings page) | Admin             | Yes — workers/job sites settings APIs               |
| `/company-settings`             | Company Settings                      | Admin             | Yes — WH-347 company header fields                  |
| `/admin/job-sites`              | Job Sites                             | Admin             | Yes                                                 |
| `/admin/classifications`        | Labor Classifications                 | Admin             | Yes                                                 |
| `/admin/pay-rates`              | Pay Rates (worker × job site)         | Admin             | Yes                                                 |


Source of truth for routes: `frontend/src/App.jsx`.

### Daily Entry (`/daily-entry`)

- **Problem:** Capture daily hours in the field without using Paychex UI.
- **Who:** Superintendents (and admins).
- **Backend:** Yes — writes `daily_time_entries` (and related aggregation into `time_entries`), tied to `pay_periods`, `workers`, `job_sites`, and pay components/codes.



### My Entries (`/my-entries`)

- **Problem:** Review/edit one’s own (or visible) daily entries; admins can export CSV.
- **Who:** All authenticated users; CSV export guarded for admin roles on the API.
- **Backend:** Yes.



### Summary (`/summary`)

- **Problem:** Period-level hours/cost overview for office review.
- **Who:** Admin.
- **Backend:** Yes — `/api/summary`, pay-period helpers, alerts.



### Payroll (`/payroll`)

- **Problem:** Build a pay-period payroll view (per worker / pay component), apply reimbursements/short-pay adjustments, and export CSV formatted for Paychex Flex/SPI import.
- **Who:** Admin.
- **Backend:** Yes — `/api/payroll`, Paychex sync endpoints, `payroll_adjustments`, export via `backend/services/paychexExport.js` (Axios HTTP client to Paychex; no official Paychex SDK package).



### Certified Payroll / WH-347 (`/certified-payroll`)

- **Problem:** Produce certified payroll reports/PDFs for prevailing-wage jobs.
- **Who:** Admin.
- **Backend:** Yes — `/api/certified-payroll`, `wh347_supplements`, Paychex check data where used, PDF fill via `pdf-lib` against templates under `backend/templates/` (`wh347-fillable.pdf`). Feature flag `USE_NEW_WH347_EXPORT` selects newer vs legacy fill path.



### AR/AP (`/manage-bills`) — client-side only

- **Problem:** Import company payables (“Bills”) and receivables (“Customer Invoices”) exports, age open amounts into Current / 0–30 / 30–60 / 60–90 / 90+ buckets, filter/search, and export the company’s standard **Aging AP/AR** `.xlsx` (including a **Totals** row).
- **Who:** Admin (UI gated like Payroll).
- **Backend:** **None.** No Express routes, controllers, migrations, or tables. State lives in React memory only; re-import replaces that mode’s dataset; refresh clears data. Parsing/export uses **SheetJS** `xlsx` (`frontend/src/utils/billsAging.js`, `frontend/src/pages/ManageBillsPage.jsx`).



### Manage Users (`/admin/users`)

- **Problem:** Create/manage app logins and roles.
- **Who:** Admin.
- **Backend:** Yes — `/api/users`.



### Company Settings dropdown pages

- **Job Sites** (`/admin/job-sites`), **Classifications** (`/admin/classifications`), **Pay Rates** (`/admin/pay-rates`), **Company Settings** (`/company-settings`): admin configuration for sites, labor classifications, per-job rates, and WH-347 company/certifier metadata.
- **Backend:** Yes for all.



### Settings (`/settings`)

- Older/alternate admin settings surface still registered in the router; Company Settings nav dropdown is the primary UX for job sites / classifications / rates / company profile. TODO: confirm whether `/settings` is still linked anywhere besides direct URL.



### Paychex sync (background + manual)

- Not a standalone page; driven on login (stale threshold), scheduled interval, cron, and `/api/sync` / `/api/paychex` for admins.
- Syncs workers, pay components, job sites, OPEN operational `pay_periods`, historical `paychex_pay_periods`, and recurring reimbursements.

---



## 3. Tech Stack

Versions from `frontend/package.json` and `backend/package.json` (semver ranges as declared).

### Frontend (`fieldpay-frontend` @ 1.0.0)


| Piece               | Package / version                            |
| ------------------- | -------------------------------------------- |
| UI                  | `react` ^18.3.0, `react-dom` ^18.3.0         |
| Bundler / dev       | `vite` ^5.3.0, `@vitejs/plugin-react` ^4.3.0 |
| Routing             | `react-router-dom` ^6.23.0                   |
| Spreadsheet (AR/AP) | `xlsx` ^0.18.5 (SheetJS)                     |
| Tests               | `vitest` ^3.1.1, Testing Library, `jsdom`    |


No Redux/React Query; auth token in `sessionStorage`. Production API base URL is empty string (relative `/api` paths) — see `frontend/src/api/client.js` and `frontend/.env.production`.

### Backend (`fieldpay-backend` @ 1.0.0)


| Piece        | Package / version                                                                       |
| ------------ | --------------------------------------------------------------------------------------- |
| Runtime      | Node.js (local verified during docs pass: v24.x; **TODO: confirm Render Node version**) |
| HTTP         | `express` ^4.19.0                                                                       |
| DB client    | `pg` ^8.11.0                                                                            |
| Auth         | `jsonwebtoken` ^9.0.2, `bcrypt` ^5.1.1                                                  |
| Paychex HTTP | `axios` ^1.7.0 (custom wrappers in `services/paychexHttp.js`, `paychexAuth.js`)         |
| Cron         | `node-cron` ^3.0.3                                                                      |
| PDF (WH-347) | `pdf-lib` ^1.17.1                                                                       |
| Config       | `dotenv` ^16.4.0, `cors` ^2.8.5                                                         |
| Dev          | `nodemon` ^3.1.0                                                                        |




### Database & hosting

- **PostgreSQL** on **Render** (`DATABASE_URL` points at a Render Postgres host; `backend/db/index.js` always enables SSL with `rejectUnauthorized: false` for Render’s CA).
- Exact Postgres major version: **TODO: confirm in Render dashboard** (not pinned in repo).

---



## 4. Architecture Notes



### Layout (monorepo)

```
FieldPay/
  backend/          Express API, services, SQL schema/migrations, tests
    routes/         HTTP routers mounted from server.js
    services/       Paychex sync/export, payroll, WH-347, aggregation, …
    db/             pool, schema.sql, migrations/
    middleware/     JWT auth, role guards
    cron/           scheduled jobs
    templates/      WH-347 PDF assets
  frontend/         Vite + React SPA
    src/pages/      Route-level screens
    src/components/ Layout/nav, shared UI
    src/api/        fetch helpers
    src/utils/      Includes billsAging.js (AR/AP)
```

There is no root `package.json` application workspace — install and run **backend** and **frontend** separately.

### Manage Bills / AR/AP has no backend surface

Do not look for `/api/manage-bills` or an aging table. The feature is entirely frontend. Payables and receivables datasets are separate React state; export builds Aging AP/AR xlsx in the browser.

### Pay period sync & biweekly filter

Two related sync paths:

1. `syncPayPeriods()` (`backend/services/paychexSync.js`) — fetches Paychex company pay periods with `status=OPEN`, upserts into operational table `pay_periods` (used by daily entry / payroll workflows).
2. `syncCompanyPayPeriods()` (`backend/services/paychexPayPeriodStore.js`) — syncs a date-ranged catalog (typically COMPLETED) into `paychex_pay_periods` (used for checks / certified payroll period discovery). Invoked via `syncHistoricalPaychexPayPeriods()` from the main sync orchestration.

Both filter with `isStandardBiweeklyPeriod`: inclusive span must be **13 days** (calendar day 0→13 = **14 calendar days**). Non-matching periods are logged and **not** written.

**Why:** Paychex sometimes returns short/odd OPEN windows (e.g. a 4-day Jul 27–31 window) that polluted `pay_periods` / `paychex_pay_periods`, broke biweekly UX, and required one-off cleanup scripts (`backend/scripts/cleanup-non-biweekly-empty.js`, `reassign-jul27-31-period.js`). The filter prevents reintroducing those rows. Do not remove it without a deliberate product decision.

Scheduled sync: `PAYCHEX_SYNC_INTERVAL_MS` (default 6 hours ≈ 4×/day) in `paychexSyncScheduler.js`; login may trigger sync when last success is older than `LOGIN_SYNC_STALE_THRESHOLD_MS` (default 7 hours).

---



## 5. Hosting & Deployment


| Layer    | Host                                                                      | Role                                                                                         |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Backend  | **Render Web Service**                                                    | Runs Express (`npm start` → `node server.js`)                                                |
| Database | **Render PostgreSQL**                                                     | App data; SSL required                                                                       |
| Frontend | **Render Static Site**                                                    | Built Vite SPA; talks to the backend web service                                             |
| Domain   | **wellcraftpay.com** via **Namecheap**, DNS/hosting pointed at **Render** | TODO: confirm custom-domain certificate + which Render service(s) the apex/www CNAMEs target |




### Production commands (as used on Render)

Per handoff instruction and `backend/package.json`:

- **Install:** `npm install`
- **Start (API):** `npm start` → `node server.js`

Frontend build (from `frontend/package.json`):

```bash
cd frontend
npm install
npm run build
```

Publish `frontend/dist`. TODO: confirm the exact Render Static Site **build** / **publish** directory settings in the dashboard (not stored in this repo — no `render.yaml` present).

### Frontend → API wiring in production

- `frontend/.env.production` sets `VITE_API_BASE_URL=` (empty).
- `frontend/src/api/client.js` uses `''` in non-DEV builds, so requests go to same-origin `/api/...`.
- Backend CORS allows `http://localhost:5173` plus `FRONTEND_ORIGIN` when set.
- TODO: confirm Render rewrite/proxy so the static site’s `/api/*` reaches the web service (or that `FRONTEND_ORIGIN` / absolute API URL is configured if that rewrite is not in place). A checked-in local `backend/.env` sample used `FRONTEND_ORIGIN=https://fieldpay-frontend.onrender.com` — production custom domain may differ.

---



## 6. Environment Variables & Secrets

**Secrets are not committed** (see `.gitignore`: `backend/.env`, `frontend/.env`). Production values live in the **Render dashboard** environment settings. Whoever takes over must obtain/rotate Paychex credentials with Paychex and Render secrets with the hosting owner.

There is **no** `backend/.env.example` in the repo today — **TODO: add one**. The lists below are from `process.env` usage + keys present in a local `backend/.env` (names only).

### Database


| Variable       | Purpose                                                               |
| -------------- | --------------------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string (Render Postgres; use `sslmode=require`) |




### Auth / app


| Variable          | Purpose                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`      | Signs/verifies bearer JWTs (`middleware/auth.js`, login)                                          |
| `PORT`            | Listen port (default `3000`)                                                                      |
| `NODE_ENV`        | `development` / `production`                                                                      |
| `FRONTEND_ORIGIN` | Extra allowed CORS origin (deployed frontend URL)                                                 |
| `ADMIN_EMAIL`     | Reference email for initial admin (documented historically; not a substitute for inserting users) |




### Paychex API


| Variable                                   | Purpose                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `PAYCHEX_CLIENT_ID`                        | OAuth client ID                                                                                                |
| `PAYCHEX_CLIENT_SECRET`                    | OAuth client secret                                                                                            |
| `PAYCHEX_COMPANY_ID`                       | Company id for API paths                                                                                       |
| `PAYCHEX_BASE_URL`                         | Optional explicit API host (else derived from `PAYCHEX_ENV`)                                                   |
| `PAYCHEX_ENV`                              | `production` (default) → `https://api.paychex.com`; `sandbox` → `https://sandbox.api.paychex.com`              |
| `PAYCHEX_TIMEOUT_MS`                       | HTTP timeout (default `30000`)                                                                                 |
| `PAYCHEX_GET_MAX_RETRIES`                  | GET retry count (default `3`)                                                                                  |
| `PAYCHEX_CLIENT_CODE`                      | Company/client code embedded in SPI CSV export (fallback hardcode exists in export code — prefer setting this) |
| `PAYCHEX_SPI_COMPANY_ID`                   | Alternate/fallback for client code in export                                                                   |
| `PAYCHEX_REGULAR_COMPONENT_ID` / `_NAME`   | Regular hours mapping helpers                                                                                  |
| `PAYCHEX_OT_COMPONENT_ID` / `_NAME`        | Overtime mapping                                                                                               |
| `PAYCHEX_PTO_COMPONENT_ID` / `_NAME`       | PTO mapping                                                                                                    |
| `PAYCHEX_REIMBURSE_COMPONENT_ID` / `_NAME` | Reimbursement mapping                                                                                          |
| `PAYCHEX_REIMBURSEMENT_COMPONENT_IDS`      | Optional comma-separated component IDs treated as recurring reimbursements                                     |
| `PAYCHEX_SYNC_INTERVAL_MS`                 | Background sync interval (default `21600000` = 6h)                                                             |
| `LOGIN_SYNC_STALE_THRESHOLD_MS`            | Login-triggered sync staleness (default `25200000` = 7h)                                                       |
| `PAYCHEX_DEBUG`                            | Verbose Paychex HTTP logging when truthy                                                                       |




### Certified payroll / flags


| Variable                  | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `USE_NEW_WH347_EXPORT`    | Prefer new WH-347 fill path (default treated as enabled when unset/true) |
| `CERTIFIED_PAYROLL_DEBUG` | Extra WH-347 debug logs when `1`                                         |




### Frontend (Vite)


| Variable            | Where                                                                                            | Purpose                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `VITE_API_BASE_URL` | `frontend/.env.example`, `.env.development` → `http://localhost:3000`; `.env.production` → empty | Dev absolute API host; prod relative `/api` |


No email provider, S3, or other third-party keys appear in `process.env` usage beyond Paychex + Postgres + JWT.

---



## 7. Database

- **Type:** PostgreSQL (Render-hosted).
- **Canonical schema:** `backend/db/schema.sql` (full create-if-not-exists definition; requires `pgcrypto`).
- **Incremental migrations:** `backend/db/migrations/001_*.sql` … `013_worker_recurring_reimbursements.sql`, with npm scripts for some later ones (`migrate:007-008` … `migrate:012` in `backend/package.json`). Prefer applying schema + any migrations not yet reflected on a given environment carefully.



### Core tables (from `schema.sql`)


| Table                             | Role                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| `users`                           | App login accounts + role                                     |
| `workers`                         | Employees synced from Paychex                                 |
| `worker_pay_components`           | Per-worker Paychex pay components/rates                       |
| `worker_recurring_reimbursements` | Recurring reimbursement amounts synced from Paychex           |
| `job_sites`                       | Jobs / worksites (certified payroll metadata fields included) |
| `pay_periods`                     | Operational biweekly periods for entry/payroll                |
| `paychex_pay_periods`             | Catalog of Paychex periods for checks/history                 |
| `daily_time_entries`              | Day-grain time capture                                        |
| `time_entries`                    | Aggregated period/component grain used in payroll flows       |
| `worker_job_site_rates`           | Prevailing/custom rates by worker × site                      |
| `labor_classifications`           | Classification list; FK on workers/entries                    |
| `wh347_supplements`               | Extra WH-347 fields per worker/site/week                      |
| `payroll_adjustments`             | Per-period reimbursement / short-pay overrides                |
| `company_settings`                | Company header for certified payroll                          |
| `submission_log`                  | Paychex submission attempts                                   |
| `sync_log`                        | Sync run history                                              |


**There is no Manage Bills / AR/AP table** — aging data is never persisted.

Relationships (high level): `daily_time_entries` / `time_entries` → `workers`, `job_sites`, `pay_periods`, `users` (entered_by); adjustments → `pay_periods` + `workers`; WH-347 supplements → `workers` + `job_sites`.

---



## 8. Local Development Setup



### Prerequisites

- **Node.js** — modern LTS recommended (docs author had v24 locally; engines not pinned in package.json).
- **npm** (comes with Node).
- **PostgreSQL** — either local Postgres **or** a Render/dev `DATABASE_URL`. Note: `backend/db/index.js` always sets `ssl: { rejectUnauthorized: false }`, which matches Render; local non-SSL Postgres may need a temporary code/env adjustment — **TODO: confirm preferred local DB approach**.
- Paychex API credentials (or accept that sync/export features will fail without them).



### Install

```bash
cd backend
npm install

cd ../frontend
npm install
```



### Backend `.env`

Create `backend/.env` (not committed). Minimum useful set:

```bash
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DBNAME?sslmode=require
JWT_SECRET=replace-me
PAYCHEX_CLIENT_ID=
PAYCHEX_CLIENT_SECRET=
PAYCHEX_COMPANY_ID=
PAYCHEX_BASE_URL=https://api.paychex.com
PAYCHEX_CLIENT_CODE=
PORT=3000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
```

Copy remaining Paychex component name/ID vars from an existing secret store / previous owner.

### Database bootstrap

```bash
# Example — adjust connection for your environment
psql "$DATABASE_URL" -f backend/db/schema.sql
```

Then apply any migrations newer than the DB’s current state from `backend/db/migrations/` / `npm run migrate:*` scripts as needed.

### Create an admin user

Users are not auto-provisioned from `ADMIN_EMAIL` alone. Hash a password and insert:

```bash
cd backend
node -e "require('bcrypt').hash('your-password', 10).then(console.log)"
```

```sql
INSERT INTO users (email, password_hash, role)
VALUES ('admin@example.com', '<bcrypt-hash>', 'system_admin');
```

Valid roles: `superintendent`, `payroll_admin`, `system_admin`.

### Run servers

**Terminal 1 — API** (`http://localhost:3000`):

```bash
cd backend
npm run dev
```

**Terminal 2 — SPA** (`http://localhost:5173`):

```bash
cd frontend
npm run dev
```

Vite proxies `/api` → `http://localhost:3000` (`frontend/vite.config.js`). Alternatively set `VITE_API_BASE_URL=http://localhost:3000` (see `frontend/.env.development`).

### Tests

```bash
cd backend && npm test
cd frontend && npm test
```

---



## 9. Known Issues / Technical Debt

1. **Non-biweekly pay periods (fixed with guardrails):** Paychex historically returned short OPEN periods that entered `pay_periods` / `paychex_pay_periods` and broke biweekly assumptions. Cleanup scripts exist under `backend/scripts/`. Sync now drops non-13-day-span periods via `isStandardBiweeklyPeriod`. **Do not remove that filter** without revisiting product requirements and re-testing period selectors.
2. **AR/AP has no persistence (by design):** Refreshing or leaving `/manage-bills` clears imported data. Users must re-import spreadsheets each session.
3. **SheetJS community build:** Aging export does not reliably persist Excel cell bold styling; Totals row is labeled correctly but may not appear bold in Excel.
4. **Naming drift:** Repo/package names still say FieldPay; production domain is wellcraftpay.com. Frontend route remains `/manage-bills` while UI label is **AR/AP**.
5. **No** `render.yaml` **/ incomplete env example:** Deployment settings and a checked-in backend `.env.example` are missing — operators must rely on Render UI + this README.
6. **SSL always on for** `pg`**:** May complicate pure-local Postgres without SSL.
7. **Hardcoded SPI fallback company code** in export code if `PAYCHEX_CLIENT_CODE` unset — always set the env var in production.

---



## 10. Handoff Contacts / Ownership

TODO: fill in before handoff (not available from the repository):


| Access                                              | Contact / owner | Notes                                                              |
| --------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Paychex Flex API / developer portal                 | TODO            | Client ID/secret rotation, company ID, sandbox vs prod             |
| Render account (web service, static site, Postgres) | TODO            | Env vars, deploys, logs, DB backups                                |
| Namecheap domain `wellcraftpay.com`                 | TODO            | DNS, renewal, registrar login                                      |
| Business / product owner                            | TODO            | Payroll process questions, WH-347 filing, AR/AP spreadsheet owners |
| Source control (GitHub/etc.)                        | TODO            | Confirm remote URL and who has admin                               |


---



## Quick API map (backend)

Mounted from `backend/server.js` (JWT required after `/api/auth` unless noted):


| Prefix                                                                           | Module                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/api/auth`                                                                      | Login (public)                                                        |
| `/api/workers`                                                                   | Workers                                                               |
| `/api/job-sites`                                                                 | Job sites                                                             |
| `/api/entries`                                                                   | Daily entries                                                         |
| `/api/summary`, `/api/pay-periods/*`, `/api/alerts`, `/api/daily-entries/export` | Summary / periods                                                     |
| `/api/payroll`                                                                   | Payroll                                                               |
| `/api/submit`                                                                    | Legacy submit flow                                                    |
| `/api/users`                                                                     | Users                                                                 |
| `/api/labor-classifications`                                                     | Classifications                                                       |
| `/api/job-site-rates`                                                            | Rates                                                                 |
| `/api/company-settings`                                                          | Company profile                                                       |
| `/api/certified-payroll`                                                         | WH-347                                                                |
| `/api/paychex`                                                                   | Paychex helpers / sync-related                                        |
| `/api/sync`                                                                      | Manual sync                                                           |
| `/api` (settings router)                                                         | Settings (mounted last; system_admin guards apply to unmatched paths) |


There is **no** Manage Bills / AR/AP API prefix.
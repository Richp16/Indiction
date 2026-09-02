# Indiction

Open-source construction payroll and back-office web app. Superintendents log daily hours; office admins run certified payroll (WH-347), job costing, and client-side AR/AP aging. Works with **Paychex Flex** or in **Non-Paychex** mode with local workers and pay periods.

## Why WH-347 automation matters

Prevailing-wage jobs require certified payroll (WH-347) each week. Indiction turns daily time entry into reviewable hour grids and exportable WH-347 PDFs, reducing manual transcription from field logs or spreadsheets.

## Paychex vs Non-Paychex

| Capability | Paychex mode | Non-Paychex mode |
|------------|--------------|------------------|
| Worker source | Paychex sync | Manual CRUD in **Manage Employees** |
| Pay periods | Paychex sync | Manual biweekly periods |
| SPI / payroll export | Yes (`/payroll`) | Redirects to Manage Employees |
| Daily entry | Yes | Yes (`REGULAR`, `OT`, `DT`, `PTO`, `REIMBURSE`) |
| WH-347 PDF | Yes (check data when available) | Yes (hours × rates; manual withholding) |
| Spreadsheet import | No | Yes (Certified Payroll page) |
| Job costing | Yes | Yes |

First login on a fresh database shows a **setup wizard** (`/setup`) until `integration_configured` is set.

## Glossary

- **WH-347** — Federal certified payroll form for prevailing-wage work.
- **SPI** — Paychex payroll export format from `/payroll`.
- **AR / AP** — Accounts receivable / payable; `/manage-bills` imports aging spreadsheets client-side only.
- **Prevailing wage** — Davis-Bacon style wage rules tied to job sites and classifications.

## Tech stack

- **Frontend:** React 18, Vite, React Router
- **Backend:** Node.js, Express, PostgreSQL
- **PDF:** pdf-lib (WH-347 template fill)

## Quick start

```bash
# Database: create DB and run schema + migrations
psql $DATABASE_URL -f backend/db/schema.sql
cd backend && npm run migrate:014 && npm run migrate:016 && npm run migrate:017 && npm run migrate:018

cd backend && cp .env.example .env   # set DATABASE_URL, JWT_SECRET
npm install && npm run dev

cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`, log in, complete setup, then use Daily Entry.

## Migrations (after baseline 013)

| File | Purpose |
|------|---------|
| `014_job_site_start_date.sql` | Job site `start_date` for WH-347 week number |
| `016_global_edit_lock.sql` | Singleton global edit lock |
| `017_user_sessions.sql` | Idle / tab-close sessions |
| `018_non_paychex_mode.sql` | `paychex_enabled`, nullable Paychex IDs |

Fresh `schema.sql` sets `integration_configured` default **false** (wizard). Migration 018 sets **true** for existing DBs.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection |
| `JWT_SECRET` | — | Auth tokens |
| `PAYCHEX_ENABLED` | DB flag | Force disable Paychex (`0`/`false`) |
| `EDIT_LOCK_TIMEOUT_SECONDS` | `90` | Stale edit lock reclaim |
| `SESSION_IDLE_SECONDS` | `300` | Session idle timeout |
| `SESSION_CLOSE_GRACE_SECONDS` | `15` | Tab-close refresh grace |
| `USE_NEW_WH347_EXPORT` | `true` | pdf-lib vs legacy PDF export |

## Roles and routes

Roles: `superintendent`, `payroll_admin`, `system_admin`. Admin routes use `requireAdmin` in the SPA.

Key routes: `/daily-entry`, `/summary`, `/payroll` (Paychex only), `/admin/employees` (Non-Paychex), `/certified-payroll`, `/job-costing`, `/manage-bills`, `/company-settings`.

## Time entry spreadsheet import (Non-Paychex)

On **Certified Payroll**, download the template, upload `.xlsx`/`.csv`, preview matches, then commit. Columns: `date_worked`, `employee_code` or worker name, `job_code`, `pay_code`, `hours`. API:

- `GET /api/entries/import/template`
- `POST /api/entries/import/preview` (multipart `file`)
- `POST /api/entries/import/commit` (requires global edit lock)

Imported rows write to `daily_time_entries` and trigger the same aggregation path as the Daily Entry UI.

## AR/AP: importing spreadsheets

`/manage-bills` is **browser-only** (no server storage). Upload payables or receivables exports with columns such as `Job`, `Bill Amount`, `Due Date` (payables) or `Owner Name`, `Invoice Balance`, `Deadline` (receivables). The page classifies aging buckets and exports an Aging workbook.

**Note:** WH-347 workbook import (week grid + supplement columns) is Phase 2; Phase 1 is daily time entry import only.

## Tests

```bash
cd backend && npm test
cd frontend && npm test
```

## License

TBD — see repository maintainers for licensing before production use.

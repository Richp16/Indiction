# Indiction

Open-source construction payroll and back-office web app. Superintendents log daily hours; office admins run certified payroll (WH-347), job costing, and client-side AR/AP aging. Works with **Paychex Flex** or in **Non-Paychex** mode with local workers, pay periods, and a provider-neutral payroll export.

> **Tax disclaimer:** Indiction does **not** calculate or file payroll taxes. Manually entered withholding on Certified Payroll must come from your company’s payroll/accounting records. Optional FICA figures in Non-Paychex mode are estimates and require human review.

## Feature parity (Paychex vs Non-Paychex)

| Feature | Classification | Notes |
|---------|----------------|-------|
| Setup / mode wizard | Shared | `/setup` |
| Daily entry (single + bulk) | Shared | Local tables |
| My Entries | Shared | |
| Summary + analysis | Shared | Periods from `/api/pay-periods` |
| Job costing + CSV | Shared | Labels hide provider recurring when local |
| Job sites / classifications / rates / users | Shared | |
| Company settings | Shared | Mode switch requires confirmation |
| Global edit lock + sessions | Shared | |
| Worker sync from Paychex | Paychex-integrated | |
| Pay period sync | Paychex-integrated | |
| SPI export + submission | Paychex-integrated | `/payroll` |
| Check data / re-sync | Paychex-integrated | Certified Payroll |
| Manage Employees | Local/manual | Workers + periods |
| Local Payroll review/export | Export-only | `/local-payroll` → `Indiction-Payroll-*.csv` |
| Time-entry spreadsheet import | Local/manual | Non-Paychex only |
| WH-347 PDF | Shared | Local hours; Paychex checks when available |
| Custom Paychex components | Not supported locally | Standard REGULAR/OT/DT/PTO/REIMBURSE |

See also [`docs/PARITY_MATRIX.md`](docs/PARITY_MATRIX.md).

## Non-Paychex setup

1. Create PostgreSQL database and apply `backend/db/schema.sql`.
2. Run migrations `014`, `016`, `017`, `018`, `019` (`npm run migrate:019` in `backend`).
3. Configure `DATABASE_URL` and `JWT_SECRET`; start backend + frontend.
4. Log in → choose **Non-Paychex** on `/setup`.
5. Company Settings → company header fields.
6. Manage Users → roles.
7. Job sites, classifications, pay rates.
8. Manage Employees → workers (unique `employee_code`, optional address / last-4) and pay periods.
9. Enter time (Daily Entry) and/or import spreadsheet (Local Payroll or Certified Payroll).
10. Summary + Job Costing review.
11. Local Payroll → review → export CSV → mark exported / finalize.
12. Certified Payroll → enter withholding manually → export WH-347.

## Local payroll export columns

`Indiction-Payroll-<period-end>.csv`:

`employee_code`, `first_name`, `last_name`, `period_start`, `period_end`, `pay_date`, `job_code`, `pay_code`, `hours`, `rate`, `amount`, `reimbursement_amount`, `total_gross`

This is **not** Paychex SPI format.

## Time-entry import

Sample file: [`docs/samples/time-entry-import-sample.csv`](docs/samples/time-entry-import-sample.csv)

| Column | Required | Notes |
|--------|----------|-------|
| `date_worked` | yes | ISO or US date |
| `employee_code` | preferred | Stable match key |
| `worker_name` | optional | Aid only; ambiguous names error |
| `job_code` | yes | Match job site code or name |
| `pay_code` | yes | REGULAR, OT, DT, PTO, REIMBURSE |
| `hours` | yes | Non-negative |
| `reimbursement_amount` | optional | For REIMBURSE / amounts |

Duplicate policy: file duplicates are rejected; commit `merge` uses daily-entry save; `replace` deletes same worker/site/date/pay_code then inserts.

API (Non-Paychex + admin + edit lock on commit):

- `GET /api/entries/import/template`
- `POST /api/entries/import/preview`
- `POST /api/entries/import/commit`

## Tech stack

React 18 + Vite · Express · PostgreSQL · pdf-lib

## Quick start

```bash
psql $DATABASE_URL -f backend/db/schema.sql
cd backend && npm run migrate:014 && npm run migrate:016 && npm run migrate:017 && npm run migrate:018 && npm run migrate:019
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Migrations (014+)

| File | Purpose |
|------|---------|
| `014` | Job site `start_date` |
| `016` | Global edit lock |
| `017` | User sessions |
| `018` | Non-Paychex flags + nullable Paychex IDs |
| `019` | Worker address / last-4, unique employee_code, period export/finalize stamps |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | Postgres |
| `JWT_SECRET` | — | Auth |
| `PAYCHEX_ENABLED` | DB | Force off with `0`/`false` (overrides UI) |
| `EDIT_LOCK_TIMEOUT_SECONDS` | `90` | Stale lock |
| `SESSION_IDLE_SECONDS` | `300` | Idle logout |

## License

TBD

# FieldPay

FieldPay is a construction company payroll web application. Site superintendents log daily employee hours; payroll admins review and submit that data to the Paychex Flex API.

## Backend Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Paychex Flex API credentials (client ID, client secret, company ID)

### Install

```bash
cd backend
npm install
```

### Environment Variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PAYCHEX_CLIENT_ID` | Paychex OAuth client ID |
| `PAYCHEX_CLIENT_SECRET` | Paychex OAuth client secret |
| `PAYCHEX_COMPANY_ID` | Paychex company ID |
| `PAYCHEX_BASE_URL` | Paychex API base URL (default: `https://api.paychex.com`) |
| `PAYCHEX_REIMBURSEMENT_COMPONENT_IDS` | Optional comma-separated Paychex pay component IDs treated as recurring reimbursements. If unset, reimbursement-like component names are matched. |
| `PAYCHEX_REIMBURSE_COMPONENT_ID` | Optional single reimbursement component ID (also used as sync filter fallback) |
| `PAYCHEX_SYNC_INTERVAL_MS` | Background Paychex sync interval in ms (default: `21600000` = 6 hours / 4× daily) |
| `LOGIN_SYNC_STALE_THRESHOLD_MS` | Login triggers a background sync when last success is older than this (default: `25200000` = 7 hours) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for signing JWT tokens |
| `PORT` | Server port (default: `3000`) |
| `NODE_ENV` | Environment (`development` or `production`) |
| `ADMIN_EMAIL` | Reference email for the initial admin user |

### Database Schema

Create the database, then run the schema migration:

```bash
psql -d payroll_db -f db/schema.sql
```

Or pipe the file directly:

```bash
psql postgresql://user:pass@host:5432/payroll_db < db/schema.sql
```

### Create an Admin User

Users must be inserted manually. Generate a bcrypt password hash:

```bash
node -e "require('bcrypt').hash('your-password', 10).then(console.log)"
```

Then insert into PostgreSQL:

```sql
INSERT INTO users (email, password_hash, role)
VALUES ('admin@example.com', '<bcrypt-hash>', 'system_admin');
```

Valid roles: `superintendent`, `payroll_admin`, `system_admin`.

### Start the Dev Server

```bash
npm run dev
```

The API listens on `http://localhost:3000` by default. CORS is enabled for the frontend at `http://localhost:5173`.

On startup, the server runs a full Paychex sync (workers, pay components, job sites, pay periods) and registers cron jobs for daily sync, deadline reminders, and failed submission retries.

### Production

```bash
npm start
```

## API Overview

| Method | Endpoint | Auth | Role |
|---|---|---|---|
| POST | `/api/auth/login` | Public | — |
| GET | `/api/workers` | JWT | Any |
| GET | `/api/workers/:id/pay-components` | JWT | Any |
| GET | `/api/job-sites` | JWT | Any |
| POST | `/api/entries` | JWT | Any |
| GET | `/api/entries` | JWT | Any |
| PUT | `/api/entries/:id` | JWT | Any |
| DELETE | `/api/entries/:id` | JWT | Any |
| GET | `/api/summary` | JWT | Any |
| GET | `/api/summary/csv` | JWT | Any |
| GET | `/api/pay-periods/current` | JWT | Any |
| POST | `/api/submit/validate` | JWT | payroll_admin, system_admin |
| POST | `/api/submit/confirm` | JWT | payroll_admin, system_admin |
| GET | `/api/submit/status` | JWT | payroll_admin, system_admin |
| POST | `/api/sync` | JWT | system_admin |
| GET | `/api/sync/status` | JWT | system_admin |
| GET | `/api/settings/workers` | JWT | system_admin |
| GET | `/api/settings/job-sites` | JWT | system_admin |

## Frontend Setup

### Install

```bash
cd frontend
npm install
```

No additional environment variables are required for local development. The Vite dev server proxies `/api` requests to `http://localhost:3000`.

### Start the Dev Server

```bash
npm run dev
```

The app runs at `http://localhost:5173`.

### Run Backend and Frontend Together

Open two terminals from the project root:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Ensure the backend `.env` is configured and PostgreSQL is running before starting.

### Production Build

```bash
cd frontend
npm run build
npm run preview
```

For production, configure the frontend to call your API base URL (update `src/api/client.js` `baseURL` if not using the Vite proxy).

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
| GET | `/api/workers/:id/paycomponents` | JWT | Any |
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

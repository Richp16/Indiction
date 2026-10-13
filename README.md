# Indiction

Open-source construction payroll and back-office web app. Superintendents log daily hours. Office admins run certified payroll (WH-347), job costing, and client-side AR/AP aging. The same app runs against **Paychex Flex** or in **Non-Paychex** mode with local workers, pay periods, and a provider-neutral payroll export.

> **Tax disclaimer:** Indiction does **not** calculate or file payroll taxes. Withholding entered on Certified Payroll must come from your payroll or accounting records. Optional FICA figures in Non-Paychex mode are estimates and need a person to review them.

## Install

Prerequisites: Git, Node.js 20 or newer, npm, and PostgreSQL 14 or newer. pgAdmin is optional.

```bash
git clone https://github.com/Richp16/Indiction.git
cd Indiction/backend
npm install
```

```powershell
Copy-Item .env.example .env
```

```bash
cp .env.example .env
```

Edit `backend/.env` (`DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET`). Create the `indiction` database and `indiction_app` login, then:

```bash
npm run migrate
npm run create-admin
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173 and sign in. The setup screen asks you to choose Non-Paychex or Paychex Flex.

Full steps, including pgAdmin, the first administrator, and health checks: [docs/INSTALLATION.md](docs/INSTALLATION.md).

| Guide | What it covers |
| --- | --- |
| [Installation](docs/INSTALLATION.md) | PostgreSQL, environment files, migrations, first login, upgrades, troubleshooting |
| [Non-Paychex setup](docs/NON_PAYCHEX_SETUP.md) | Local workers, time, payroll export, WH-347 |
| [Paychex setup](docs/PAYCHEX_SETUP.md) | API access, credentials, connectivity, sync, SPI safety |
| [Deployment](docs/DEPLOYMENT.md) | Hosted Postgres, HTTPS, secrets, backups |

## Modes

| Feature | Paychex Flex | Non-Paychex |
| --- | --- | --- |
| Daily entry, summary, job costing, users, job sites | Yes | Yes |
| Workers and pay periods | Synced from Paychex | Entered in Manage Employees |
| Payroll file | Paychex SPI | `Indiction-Payroll-*.csv` (not SPI) |
| Certified payroll | Hours local; check data from Paychex when available | Hours local; withholding entered by hand |
| Time-entry spreadsheet import | No | Yes |

Company Settings can switch modes later. Existing workers, entries, and periods are kept. `PAYCHEX_ENABLED` in `backend/.env`, when set, overrides that choice. See [docs/PARITY_MATRIX.md](docs/PARITY_MATRIX.md).

## Security

`backend/.env` is gitignored. `JWT_SECRET` and Paychex credentials stay on the server. Anything starting with `VITE_` is visible in the browser. Use a PostgreSQL login that is not a superuser.

## License

TBD

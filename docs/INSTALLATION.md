# Installation

This guide takes a new computer from an empty PostgreSQL server to a logged-in Indiction administrator. It does not assume you already know the repository layout.

Related guides: [Non-Paychex setup](NON_PAYCHEX_SETUP.md), [Paychex setup](PAYCHEX_SETUP.md), [Deployment](DEPLOYMENT.md).

## Prerequisites

Install these before cloning:

| Tool | Version | Notes |
| --- | --- | --- |
| Git | current | Used to clone the repository |
| Node.js | 20 or newer | `.nvmrc` says `20`. The backend and frontend `package.json` `engines` fields require `>=20` |
| npm | comes with Node | Used for install and scripts |
| PostgreSQL | 14 or newer | 16 is a good default. The schema uses the `pgcrypto` extension |
| pgAdmin | optional | Recommended if you have not created a database role before |

The app listens on port **3000**. The Vite dev server listens on port **5173**.

## 1. Clone and install the backend

```bash
git clone https://github.com/Richp16/Indiction.git
cd Indiction/backend
npm install
```

`bcrypt` compiles a small native addon. If `npm install` fails there, install the build tools for your OS (on Windows, the Visual Studio Build Tools “Desktop development with C++” workload) and run `npm install` again from `backend`.

## 2. Create the PostgreSQL role and database

Do not run Indiction as the PostgreSQL superuser (`postgres`). Create a login that owns only this database.

Use **[Database setup in pgAdmin](#database-setup-in-pgadmin)** if you want every step in the graphical tool. Use the SQL below if you prefer `psql`. Do one of them, not both.

### SQL (psql)

Connect as a superuser, then run:

```sql
CREATE ROLE indiction_app
  WITH LOGIN
  PASSWORD '<strong-development-password>';

CREATE DATABASE indiction
  OWNER indiction_app;
```

Windows PowerShell, if `psql` is on your PATH:

```powershell
psql -U postgres -h localhost -c "CREATE ROLE indiction_app WITH LOGIN PASSWORD 'dev-password-change-me';"
psql -U postgres -h localhost -c "CREATE DATABASE indiction OWNER indiction_app;"
```

macOS and Linux:

```bash
sudo -u postgres psql -c "CREATE ROLE indiction_app WITH LOGIN PASSWORD 'dev-password-change-me';"
sudo -u postgres psql -c "CREATE DATABASE indiction OWNER indiction_app;"
```

If PowerShell says `psql` is not recognized, add PostgreSQL’s `bin` directory to your PATH (often `C:\Program Files\PostgreSQL\16\bin` or `C:\Program Files\PostgreSQL\18\bin`) or call `psql.exe` by that full path. You can also follow [Database setup in pgAdmin](#database-setup-in-pgadmin) and never use `psql`.

## Database setup in pgAdmin

pgAdmin is the graphical administration tool. These steps create the login and the empty database. They do not create Indiction’s tables one by one. After the database exists, either `npm run migrate` or the Query Tool section at the end of this chapter loads `backend/db/schema.sql`.

The object browser is the tree on the left. A right-click is always on the node named in the step. If a menu item is missing, you clicked the wrong node.

### Open pgAdmin and connect to the local server

1. Install PostgreSQL. The Windows installer can include pgAdmin. Remember the password you chose for the `postgres` role during that install. That password is the database superuser password.
2. Open **pgAdmin 4**. The first launch often asks for a **master password**. That password only unlocks pgAdmin’s saved-password store on this computer. It is not the PostgreSQL password, and it does not go in `DATABASE_URL`.
3. In the object browser, expand **Servers**.
4. If you already see a server named like **PostgreSQL 16** or **PostgreSQL 18**, click it. When pgAdmin asks for a password, enter the `postgres` superuser password from the installer. You can check **Save Password** so pgAdmin stops asking on this machine.
5. If **Servers** is empty, register the local server:
   1. Right-click **Servers** → **Register** → **Server…**
   2. **General** tab: **Name** can be `Local PostgreSQL`. This label is only for the tree. It is not a database name.
   3. **Connection** tab:
      - **Host name/address:** `localhost`
      - **Port:** `5432`
      - **Maintenance database:** `postgres`
      - **Username:** `postgres`
      - **Password:** the installer superuser password
      - **Save password:** optional, on this computer only
   4. **SSL** tab: set **SSL mode** to `Disable` for a normal local PostgreSQL install. Leave it at `Prefer` or `Require` only if you know this server was configured for TLS.
   5. Click **Save**. The server node turns into an expandable tree. A red broken node means the password, host, or port is wrong, or the PostgreSQL Windows service is stopped.

You are now connected as `postgres`. Use that connection only to create the role and the database. Indiction itself will connect as `indiction_app`.

### Create the `indiction_app` login

1. Expand the server you just connected.
2. Expand **Login/Group Roles**. You should see `postgres` and several roles whose names start with `pg_`. Leave those alone.
3. Right-click **Login/Group Roles** → **Create** → **Login/Group Role…**
4. **General** tab: **Name** = `indiction_app`. Type it exactly. This is the user in `DATABASE_URL`.
5. **Definition** tab: enter a **Password**. For a local development machine, a simple password is easier to put in `DATABASE_URL`. Leave **Account expires** empty. A production password should be long and stored in a secret manager, not in git.
6. **Privileges** tab. Set only these:
   - **Can login?** Yes
   - **Superuser?** No
   - **Create roles?** No
   - **Create databases?** No
   - **Inherit rights from parent roles?** Yes (the default)
   - **Replication?** No
7. Leave **Membership**, **Parameters**, and **Variables** empty. The **SQL** tab shows the statement pgAdmin will run. You can read it. You do not need to edit it.
8. Click **Save**. `indiction_app` appears under **Login/Group Roles**. If it does not, right-click **Login/Group Roles** → **Refresh**.

This role can sign in. It is not a superuser, and it cannot create other databases. It will own `indiction` only.

### Create the `indiction` database

1. Right-click **Databases** → **Create** → **Database…**
2. **General** tab:
   - **Database:** `indiction`
   - **Owner:** `indiction_app` (choose it from the dropdown; do not leave `postgres`)
3. If `indiction_app` is not in the Owner dropdown, close the dialog, refresh **Login/Group Roles**, and confirm the role was saved.
4. **Definition** tab: leave **Encoding** at `UTF8`. Leave template, tablespace, and collation at their defaults.
5. Leave **Security**, **Parameters**, and **Advanced** unchanged.
6. Click **Save**.

### Confirm ownership

1. Expand **Databases**. You should see `indiction` next to the installer databases `postgres` and usually `template0` / `template1`.
2. Right-click **`indiction`** → **Properties…**
3. On the **General** tab, **Owner** must be `indiction_app`. If it says `postgres`, change the owner to `indiction_app` and click **Save**.
4. Close the dialog. Expand **indiction** → **Schemas** → **public**. Right-click **public** → **Properties…** → **Security**. The database owner can create tables here. If a later migrate fails with `permission denied for schema public`, add a privilege row on this tab: **Grantee** `indiction_app`, privileges **USAGE** and **CREATE**, then **Save**.

`indiction_app` can create tables in this database. It cannot administer the other databases on the server.

### Test the same login the app will use

Query Tool on the `postgres` server connection still runs as `postgres`. That does not prove `indiction_app` can connect. Register a second server connection:

1. Right-click **Servers** → **Register** → **Server…**
2. **General** tab: **Name** = `Indiction app`.
3. **Connection** tab:
   - **Host name/address:** `localhost`
   - **Port:** `5432`
   - **Maintenance database:** `indiction`
   - **Username:** `indiction_app`
   - **Password:** the password you set on the role
4. **SSL** tab: **SSL mode** = `Disable` for a local server.
5. Click **Save**.

Expand **Indiction app**. It should open without an error and show the `indiction` database. Then:

1. Right-click **`indiction`** under **Indiction app** (not under the `postgres` server) → **Query Tool**.
2. The title of the Query Tool must include `indiction` and `indiction_app`. If the database dropdown at the top says `postgres`, close the tool and open it again from the `indiction` node.
3. Paste this and press **F5**, or click the execute button (play icon):

```sql
SELECT current_user, current_database();
```

4. The **Data Output** grid must show `indiction_app` and `indiction`.

That is the same account, host, port, and database name you put in `DATABASE_URL`:

```env
DATABASE_URL=postgresql://indiction_app:YOUR_PASSWORD@localhost:5432/indiction
DATABASE_SSL=false
```

If the password contains `@`, `:`, `/`, `#`, `?`, or `%`, percent-encode that character in `DATABASE_URL` (`@` becomes `%40`). The password typed into pgAdmin stays the raw password.

A failed login here shows `password authentication failed for user "indiction_app"` in the pgAdmin error dialog. Reset it with a right-click on **Login/Group Roles** → **indiction_app** → **Properties…** → **Definition** → **Password** → **Save**, and update `DATABASE_URL` to match.

### Load the tables from pgAdmin

Prefer `npm run migrate` from the `backend` folder after `DATABASE_URL` is filled in. That command applies `backend/db/schema.sql` and records migration history. You do not also run the file in Query Tool.

If you want pgAdmin to load the tables instead:

1. Finish `backend/.env` first so the password you just tested is the one in `DATABASE_URL`. You can come back to this subsection from [section 5](#5-create-the-tables).
2. Under the **Indiction app** server, right-click the **`indiction`** database → **Query Tool**. Do not open Query Tool on the `postgres` database, and do not run the file as the `postgres` user. Tables created as `postgres` are owned by `postgres`, and the app then hits permission errors.
3. In Query Tool, open the file: the folder icon, or **Query** → **Open File…**. Choose `backend/db/schema.sql` inside your Indiction clone.
4. Execute the whole script (**F5** or the execute button). Watch the **Messages** tab, not only **Data Output**. A load of this file produces `CREATE EXTENSION`, `CREATE TABLE`, and `CREATE INDEX` messages. `CREATE TABLE` does not fill the data grid.
5. A notice that `labor_classification_id` already exists is normal. The script adds that column with `IF NOT EXISTS`.
6. Right-click **Schemas** → **public** → **Tables** → **Refresh**. You should see `users`, `workers`, `job_sites`, `pay_periods`, `daily_time_entries`, `company_settings`, `active_edit_lock`, and `user_sessions`, among others. You will not see `schema_migrations` yet.
7. From the `backend` folder, record history without running the old migration files:

```bash
npm run migrate -- --baseline
```

8. Refresh **Tables** again. `schema_migrations` should now be there. Do not execute the files in `backend/db/migrations/` yourself.

Do not use **Create** → **Table…** to rebuild the schema by hand. Do not run `schema.sql` a second time after `npm run migrate`. Do not type a user into the `users` table. The first administrator is created with `npm run create-admin` in [section 6](#6-create-the-first-administrator).

## 3. Backend environment file

From `backend`:

```powershell
Copy-Item .env.example .env
```

```bash
cp .env.example .env
```

Open `backend/.env`. The file is gitignored.

### DATABASE_URL

Local, with SSL off (the usual local PostgreSQL install):

```env
DATABASE_URL=postgresql://indiction_app:dev-password-change-me@localhost:5432/indiction
DATABASE_SSL=false
```

The shape is `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`.

If the password contains `@`, `:`, `/`, `#`, `?`, or `%`, percent-encode those characters in the URL. `@` becomes `%40`, `#` becomes `%23`. A simple development password avoids that. Do not put the superuser password in this URL.

Hosted Postgres: paste the provider’s URL and set TLS as described in [Deployment](DEPLOYMENT.md). `npm run migrate` prints `host:port/database` and never prints the password.

### JWT_SECRET

`JWT_SECRET` is not a JWT, and it does not come from Paychex. It is a private random string the server uses to sign login tokens.

Generate one and paste the single line of output into `backend/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

```bash
openssl rand -hex 64
```

Rules:

- Put it only in `backend/.env` (or the host’s secret store). Do not put it in any frontend file.
- Do not commit or share it.
- Use a different value in development and production.
- It should be this long random value, not a phrase.
- Changing it signs everybody out. Existing tokens stop working.

### Other backend values

| Variable | Required | When | Format | Default if unset |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Always | `postgresql://user:password@host:port/database` | none |
| `DATABASE_SSL` | Local: set `false` | Always | `false`, `require`, or `verify-full` | no TLS, unless the URL contains `sslmode=require` |
| `DATABASE_SSL_CA` | Only with `verify-full` | Hosted TLS with a CA file | path to a PEM file | none |
| `JWT_SECRET` | Yes | Always | long random hex | none; login fails without it |
| `PORT` | No | Always | number | `3000` |
| `FRONTEND_ORIGIN` | No locally | Deployed frontend | origin such as `https://payroll.example.com`, no path | only `http://localhost:5173` is allowed |
| `PAYCHEX_ENABLED` | No | Mode lock | empty, or `0`/`false`/`no`/`off`, or any other value such as `1`/`true` | database / setup wizard |
| Paychex variables | Only for Paychex mode | See [Paychex setup](PAYCHEX_SETUP.md) | | |

`PAYCHEX_ENABLED` behavior, as implemented:

- Unset or blank: `company_settings.paychex_enabled` decides. A brand-new database has no settings row, so Paychex stays off until setup.
- `0`, `false`, `no`, or `off`: Paychex is forced off. The setup screen and Company Settings cannot turn it on.
- Any other non-empty value, including `1` or `true`: Paychex is forced on. Non-Paychex cannot be selected.

For a normal Non-Paychex install, leave `PAYCHEX_ENABLED` empty.

These are fixed in the application and are not environment variables:

- Idle logout after 5 minutes without a heartbeat.
- 15 seconds to resume a session after a tab-close signal.
- Global edit lock treated as stale after 90 seconds.
- Paychex HTTP timeout 30 seconds, up to 3 attempts on a retryable GET.
- Paychex sync every 6 hours, plus a login-triggered sync if the last success is older than 7 hours.
- WH-347 PDFs always use the current form fill.

Copy `frontend/.env.example` to `frontend/.env`. The only value is:

```env
VITE_API_BASE_URL=http://localhost:3000
```

`VITE_` variables are shipped to the browser. Never put `JWT_SECRET`, `DATABASE_URL`, or Paychex secrets there.

## 4. Generate nothing else by hand

You do not create the first user in pgAdmin. Section 6 does that after the tables exist.

## 5. Create the tables

`backend/db/schema.sql` is the current schema. The files in `backend/db/migrations/` are historical upgrades. Migration `001` expects an older `time_entries` shape. Migration `015` creates a scoped lock table that `016` drops. Replaying those files on a new database fails or undoes the snapshot.

### Authoritative fresh install

From `backend`, with `DATABASE_URL` pointing at the empty `indiction` database:

```bash
npm run migrate
```

On an empty database this applies `schema.sql` and records every historical migration as already applied, without executing those SQL files. You should see `Migration mode: fresh` and `Applied: schema.sql`.

Run it again. The second run should say `Migration mode: upgrade`, `Applied: none`, and list the historical files as skipped. Nothing is executed twice.

The command takes a PostgreSQL advisory lock so two servers cannot migrate at the same time. Each new migration file runs in its own transaction. A failure stops the run and rolls that file back.

### pgAdmin Query Tool instead

Follow [Load the tables from pgAdmin](#load-the-tables-from-pgadmin). Run that script as `indiction_app` against the `indiction` database, then:

```bash
npm run migrate -- --baseline
```

`--baseline` refuses to run unless the current tables are already there (`users`, `active_edit_lock`, `user_sessions`, worker address, pay-period finalize columns, and `integration_configured`).

Do not run `schema.sql` and then `npm run migrate` without `--baseline`. That combination stops on purpose, because the database has tables but no migration history.

### Check that it worked

In pgAdmin, open the **Indiction app** server → **indiction** → **Schemas** → **public** → **Tables**, then right-click **Tables** → **Refresh**.

After `npm run migrate` on an empty database, or after Query Tool plus `--baseline`, you should see `users`, `workers`, `job_sites`, `pay_periods`, `daily_time_entries`, `company_settings`, `active_edit_lock`, `user_sessions`, and `schema_migrations`, among others. `schema_migrations` is missing if Query Tool loaded `schema.sql` and `--baseline` has not been run yet.

Or, as `indiction_app`:

```bash
psql "postgresql://indiction_app:dev-password-change-me@localhost:5432/indiction" -c "\dt"
```

`npm run migrate` printing `Database: localhost:5432/indiction` is the app’s connection test. It uses the same `DATABASE_URL` and `DATABASE_SSL` as the server.

## 6. Create the first administrator

The Users screen cannot create a `system_admin`. It can create `payroll_admin` and `superintendent` accounts after someone is already signed in. The bootstrap command is the supported way to create the first `system_admin`. There is no default username or password.

From `backend`:

```bash
npm run create-admin
```

The prompts ask for name, email, and password. The password is not echoed and is not printed afterward. It must be at least 10 characters. The email is stored in lowercase. The password hash uses bcrypt with cost 10, the same cost as accounts created later in the app.

Noninteractive (the password is visible to other users on the machine if you put it in the command line; prefer environment variables):

```bash
ADMIN_NAME="Ada Admin" ADMIN_EMAIL="ada@example.com" ADMIN_PASSWORD="replace-with-10-or-more" npm run create-admin
```

```powershell
$env:ADMIN_NAME = "Ada Admin"
$env:ADMIN_EMAIL = "ada@example.com"
$env:ADMIN_PASSWORD = "replace-with-10-or-more"
npm run create-admin
Remove-Item Env:ADMIN_PASSWORD
```

Flags `--name`, `--email`, and `--password` work the same way. A second run with the same email is rejected. Run the command again with a different email if you need another system administrator.

## 7. Start both servers

Terminal 1, from `backend`:

```bash
npm run dev
```

A successful local log looks like this (host and database name only):

```text
[startup] database: localhost:5432/indiction
[startup] DB connectivity OK
[startup] Paychex disabled — skipping connectivity check and scheduled syncs
Indiction backend listening on port 3000
```

Before setup, Paychex is off, so the server does not call Paychex. `npm start` runs the same server without auto-reload.

Check health. The response has no credentials:

```bash
curl http://localhost:3000/api/health
```

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

```json
{ "status": "ok", "database": "connected" }
```

Terminal 2, from `frontend`:

```bash
npm install
cp .env.example .env
npm run dev
```

```powershell
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173. The API is http://localhost:3000. The Vite dev server also proxies `/api` to port 3000.

## 8. First login and mode

1. Sign in with the administrator email and password.
2. While `company_settings.integration_configured` is false (no setup row yet), the app sends you to `/setup`.
3. Choose **Non-Paychex (local payroll)** or **Paychex Flex**.
4. That choice sets `paychex_enabled` and `integration_configured = true`.

Non-Paychex turns on Manage Employees, local pay periods, spreadsheet import, and the provider-neutral payroll CSV. It turns off Paychex sync, SPI submission, and Paychex check download.

Paychex Flex does the opposite. The server saves that choice only after `PAYCHEX_CLIENT_ID`, `PAYCHEX_CLIENT_SECRET`, and `PAYCHEX_COMPANY_ID` are set and `npm run paychex:health` would succeed. Configure those first. Steps are in [Paychex setup](PAYCHEX_SETUP.md).

After setup, Company Settings can switch modes. The confirm dialog states that existing workers, entries, periods, and reports are not deleted, that Paychex sync and SPI submission stop in Non-Paychex mode, and that turning Paychex back on does not overwrite local data. You may have to reconcile duplicate workers or periods yourself. Switching to Paychex again requires a passing connectivity check.

If `PAYCHEX_ENABLED` is set in the environment, it wins over the database and both screens. The API returns `PAYCHEX_ENV_OVERRIDE` instead of saving the opposite mode.

Continue with [Non-Paychex setup](NON_PAYCHEX_SETUP.md) or [Paychex setup](PAYCHEX_SETUP.md).

## Upgrading an existing database

| Situation | Command |
| --- | --- |
| Empty database | `npm run migrate` |
| Database created by an earlier `npm run migrate` (it has `schema_migrations`) | `npm run migrate` applies only new files |
| Database already matches `schema.sql` but has no `schema_migrations` table | `npm run migrate -- --baseline` |
| Database is older than `schema.sql` | Do not replay `001`–`019` on top of a partial current schema. Restore a backup or bring the missing columns up to the snapshot, then baseline |

Future releases add a new numbered file under `backend/db/migrations/`. `npm run migrate` runs that file once, inside a transaction, and records it.

There is no `npm run migrate:014` (or 016, 017, 018, 019) script. Those package.json commands were incomplete and have been removed. Do not apply `schema.sql` on top of a database that already has data.

Back up the database before migrating or switching payroll mode.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running, or it is not listening on port 5432. Start the PostgreSQL service. In pgAdmin, confirm the server host and port. |
| `password authentication failed for user "indiction_app"` | The password in `DATABASE_URL` does not match the role. Reset it in pgAdmin (role → Definition) or `ALTER ROLE indiction_app PASSWORD '...'`. Percent-encode reserved characters. |
| `database "indiction" does not exist` | Create it with owner `indiction_app`. You may be connected to `postgres` by mistake. |
| `permission denied for schema public` or for a table/sequence | The app user is not the database owner, or you created objects as `postgres`. Re-create the database with `OWNER indiction_app`, or `ALTER DATABASE indiction OWNER TO indiction_app` and `ALTER SCHEMA public OWNER TO indiction_app` while connected to `indiction`. |
| `The server does not support SSL connections` | Local PostgreSQL usually has SSL off. Set `DATABASE_SSL=false` and remove `sslmode=require` from `DATABASE_URL`. |
| Hosted database closes the connection immediately | Set `DATABASE_SSL=require`, or put `sslmode=require` in the provider URL. For a private CA, use `DATABASE_SSL=verify-full` and `DATABASE_SSL_CA`. |
| Browser shows a failed fetch or a CORS error | Backend must be on port 3000. `frontend/.env` must contain `VITE_API_BASE_URL=http://localhost:3000`. Restart Vite after changing it. For a deployed site, set `FRONTEND_ORIGIN` to that site’s origin, including `https://`, with no path. |
| `EADDRINUSE` on 3000 or 5173 | Another process has the port. Stop the other Indiction terminal, or set `PORT` in `backend/.env` and point `VITE_API_BASE_URL` at that port. |
| Login returns 500 or “invalid token” immediately | `JWT_SECRET` is missing or changed. Set it and restart the backend. |
| Login always says invalid email or password, and `create-admin` was never run | The `users` table is empty. Run `npm run create-admin`. |
| `An account already exists` | That email is taken. Choose another email or sign in with the existing one. |
| Setup wizard never appears | A `company_settings` row already has `integration_configured = true`. New databases have no row, and the app redirects to `/setup`. |
| Mode will not switch | Read `PAYCHEX_ENABLED` in `backend/.env`. A set value overrides Company Settings. Restart the backend after changing it. |
| Paychex choice on `/setup` is rejected | Credentials are missing or `npm run paychex:health` is failing. Fix that before choosing Paychex. Choosing Non-Paychex does not call Paychex. |
| `npm run migrate` says tables exist but there is no history | The database was created outside the new runner. If it already matches `schema.sql`, run `npm run migrate -- --baseline`. |
| `relation "..." already exists` during migrate | A historical SQL file was applied to a database that already had the snapshot. Do not replay `001`–`019` after `schema.sql`. Use `--baseline` only when the snapshot is already present. |
| `bcrypt` or `node-gyp` error during `npm install` | Install Node 20 and a C++ build toolchain, then delete `backend/node_modules` and run `npm install` again. |
| `psql` is not recognized (Windows) | Use pgAdmin’s Query Tool, or call `C:\Program Files\PostgreSQL\16\bin\psql.exe`. |
| Session ends while you are still working | The server expires a session after 5 minutes without a heartbeat, or 15 seconds after the tab-close signal if you do not refresh. Sign in again. |
| “another user currently has edit rights” | One global edit lock exists. Wait 90 seconds after the other session stops heartbeating, or ask that person to leave the editing screen. |
| Where to read logs | The backend terminal. It prints `host:port/database`, not the database password. Paychex health output says whether the client id and secret are set; it does not print them or the access token. |

`GET /api/health` returning `database: unavailable` means the API process is up and PostgreSQL is not reachable with the current `DATABASE_URL` and `DATABASE_SSL`.

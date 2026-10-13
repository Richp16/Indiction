# Deployment

Install the application with [Installation](INSTALLATION.md) first. This page covers a hosted database and a public website. It is not a host-specific tutorial.

## Database

Use a hosted PostgreSQL 14+ URL from the provider. Set the user to a login that owns only the Indiction database.

```env
DATABASE_URL=postgresql://indiction_app:PASSWORD@db.example.com:5432/indiction
DATABASE_SSL=require
```

`require` uses TLS and does not verify the server certificate. That matches many hosted Postgres providers, including ones that use a private certificate authority.

If the provider gives you a CA file:

```env
DATABASE_SSL=verify-full
DATABASE_SSL_CA=/path/to/ca.pem
```

You can leave `DATABASE_SSL` unset when the provider URL already contains `sslmode=require`. An explicit `DATABASE_SSL=false` forces TLS off even if the URL says otherwise. Do not use `false` against a host that requires TLS.

Percent-encode reserved characters in the password. Keep the URL in the host’s secret store, not in git. Startup logs `host:port/database` only.

Run `npm run migrate` once against that database before `npm start`. Take a backup before later migrations and before changing Paychex mode.

Restrict the database firewall to the application servers.

## HTTP

Put the Node process behind HTTPS. A typical layout is a reverse proxy on port 443 forwarding to `PORT` (default 3000).

```env
FRONTEND_ORIGIN=https://payroll.example.com
```

The API allows `http://localhost:5173` plus this one origin. The value is an origin, not a path. Browsers on any other origin are rejected by CORS.

Build the frontend with `VITE_API_BASE_URL` set to the public API origin (`https://payroll.example.com` if the proxy serves both, or `https://api.example.com` if they are separate). Rebuild after changing it. Do not put secrets in `VITE_` variables.

```bash
cd frontend
npm install
npm run build
```

Serve `frontend/dist` as static files. Run the API with `npm start` in `backend` under a process manager (systemd, a platform process type, or similar) so it restarts on failure. Set `NODE_ENV` only if your process manager expects it; Indiction does not branch on it for setup.

## Secrets

Store `JWT_SECRET`, `DATABASE_URL`, and Paychex client credentials in the host’s environment, not in a committed file. Use a different `JWT_SECRET` and a different Paychex application than development. Rotating `JWT_SECRET` signs every user out. If a Paychex secret or `JWT_SECRET` is exposed, revoke it at the issuer and replace it.

`npm run paychex:health` is safe to run from the server: it does not print the secret or the access token. Do not enable extra request logging in production; the app does not have a Paychex debug flag.

## Backups

Dump the database on a schedule and before `npm run migrate`. Restoring a dump and then running `npm run migrate` applies only migrations that are not already recorded in `schema_migrations`.

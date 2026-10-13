# Paychex Flex integration

Publishing this repository does not give you Paychex API access. A Paychex Flex web login is not an API client id or secret. Indiction cannot approve your Paychex application or attach your company to an API key.

Official starting points:

- [Paychex API Developer Center](https://developer.paychex.com/)
- [Paychex API documentation](https://developer.paychex.com/documentation) (OAuth token and company, worker, and payroll resources)
- [Paychex partner onboarding](https://developer.paychex.com/partner) (how Paychex provisions a sandbox, then production keys)

Paychex provisions access. Sandbox credentials and production credentials are different, and the company ids that go with them are different. Use the sandbox until a payroll preview looks right. Do not use a production payroll submission as the connectivity test.

## 1. Get API access

You need:

1. A Paychex Flex company that is allowed to use the API.
2. A developer or partner application approved by Paychex.
3. A **client id** and **client secret** for that application.
4. The company authorized for the application. Paychex’s partner flow can push an access request into Flex under Integrated Apps, or Paychex support can link clients. The display id used in that Paychex linking step is not the same value as Indiction’s API company id.
5. Permission for the resources Indiction calls: company read, workers, worker pay rates, worker and company pay components, pay periods, checks read, and (only when you submit payroll) check create. If a call returns HTTP 403, Paychex still has to grant that endpoint. Indiction cannot add it.

Ask Paychex which environment the key belongs to before you set `PAYCHEX_ENV`.

## 2. What Indiction calls

Authentication is the OAuth 2.0 client-credentials grant. The server posts form fields, not a browser login:

`POST {base}/auth/oauth/v2/token`

- `grant_type=client_credentials`
- `client_id`
- `client_secret`
- `Content-Type: application/x-www-form-urlencoded`

The JSON response includes `access_token`, `token_type` (`Bearer`), and `expires_in` (Paychex’s documentation example is 600 seconds). Indiction keeps that token in memory and requests a new one about five minutes before it expires. The token is not written to the database and is not returned by `npm run paychex:health`.

Base URL, from `PAYCHEX_ENV` unless `PAYCHEX_BASE_URL` is set:

| `PAYCHEX_ENV` | Base URL used by this app |
| --- | --- |
| `production` (default) | `https://api.paychex.com` |
| `sandbox` | `https://sandbox.api.paychex.com` |

`https://api.paychex.com` is the host in Paychex’s public API documentation. The sandbox host is what this codebase calls when `PAYCHEX_ENV=sandbox`. Paychex has to give you a sandbox that actually answers there. If your sandbox key was issued for a different host, set `PAYCHEX_BASE_URL` to the host Paychex gave you and keep `PAYCHEX_ENV` consistent with it (`npm run paychex:health` refuses a sandbox flag pointed at `api.paychex.com`, and a production flag pointed at a URL that contains `sandbox`).

After the token, Indiction uses company-scoped reads and, only when an admin submits payroll, writes:

| Method and path | Used for |
| --- | --- |
| `GET /companies/{companyId}` | Connectivity check |
| `GET /companies/{companyId}/workers` | Worker sync |
| `GET /workers/{workerId}/compensation/payrates` | Hourly rate sync |
| `GET /workers/{workerId}/paycomponents` | Worker pay components and recurring reimbursements |
| `GET /companies/{companyId}/paycomponents` | Company component list (`GET /api/paychex/paycomponents`) |
| `GET /companies/{companyId}/payperiods` | Open periods for Daily Entry, and completed periods for checks |
| `GET /companies/{companyId}/checks?payperiodid=` | Certified payroll check data |
| `GET /workers/{workerId}/checks?payperiodid=` | Certified payroll check data |
| `POST /workers/{workerId}/checks` | Payroll submission |
| `POST /checks/{checkId}/paycomponents` | Hours and reimbursement lines on a submitted check |

Pay period ids on check requests must be ids returned by the pay-periods API. Indiction does not invent them.

Scheduled sync starts about 30 seconds after the backend boots in Paychex mode, then every 6 hours. A login also starts a sync when the last successful sync is older than 7 hours. HTTP GETs time out after 30 seconds and retry up to 3 times on network errors. Those timings are not environment variables.

Job sites, labor classifications, daily field entries, and WH-347 project headers stay in Indiction. Paychex does not create your job sites.

## 3. Environment variables

Restart the backend after any `.env` change. Put secrets only in `backend/.env`.

Required before you select Paychex mode or expect sync to work:

```env
PAYCHEX_ENABLED=
PAYCHEX_ENV=sandbox
PAYCHEX_CLIENT_ID=replace_me
PAYCHEX_CLIENT_SECRET=replace_me
PAYCHEX_COMPANY_ID=replace_me
```

Leave `PAYCHEX_ENABLED` empty until you have chosen a mode in the app. Set it to `1` or `true` only when you want the server to force Paychex mode regardless of Company Settings.

| Variable | Required for | Where the value comes from | If it is missing |
| --- | --- | --- | --- |
| `PAYCHEX_CLIENT_ID` | Token, all API calls | Paychex developer app | Health check exits before any request. Setup refuses Paychex mode |
| `PAYCHEX_CLIENT_SECRET` | Token | Paychex developer app. Sandbox and production secrets differ | Same as client id |
| `PAYCHEX_COMPANY_ID` | Every company-scoped call | Paychex, after the company is linked to the app. It is the API company id (the path id on `/companies/{id}`), not the 8-digit Flex display id and not the SPI Company ID | Health check exits. `GET /api/paychex/company` returns an error |
| `PAYCHEX_ENV` | Choosing the host | `sandbox` or `production`. Default `production` | A sandbox key against production, or the reverse, fails the token call (HTTP 400 or 401) or returns 404 for the company |
| `PAYCHEX_BASE_URL` | Optional override | Only if Paychex gave you a different host. No trailing slash | The host is chosen from `PAYCHEX_ENV` |

Optional, and not required for login or the connectivity check:

```env
PAYCHEX_BASE_URL=
PAYCHEX_CLIENT_CODE=
PAYCHEX_SPI_COMPANY_ID=
PAYCHEX_REGULAR_COMPONENT_ID=
PAYCHEX_OT_COMPONENT_ID=
PAYCHEX_PTO_COMPONENT_ID=
PAYCHEX_REIMBURSE_COMPONENT_ID=
PAYCHEX_REIMBURSEMENT_COMPONENT_IDS=
```

| Variable | Required for | Format | If it is missing |
| --- | --- | --- | --- |
| `PAYCHEX_CLIENT_CODE` | SPI CSV Company ID column | Numeric company id from the Paychex SPI / Flex company profile | SPI Company ID cells are blank and the export response includes a warning. This is **not** `PAYCHEX_COMPANY_ID` |
| `PAYCHEX_SPI_COMPANY_ID` | Same SPI column | Alias used only when `PAYCHEX_CLIENT_CODE` is empty | Same as an empty client code |
| `PAYCHEX_REGULAR_COMPONENT_ID` | Mapping regular hours when a Paychex component id must be sent | Id from the component list below | Hours export/submit for that pay code cannot resolve a component |
| `PAYCHEX_OT_COMPONENT_ID` | Overtime component | Same | Same for OT |
| `PAYCHEX_PTO_COMPONENT_ID` | PTO component | Same | Same for PTO |
| `PAYCHEX_REIMBURSE_COMPONENT_ID` | One reimbursement component | Same | Reimbursement export falls back to a component already stored on the worker, if one exists |
| `PAYCHEX_REIMBURSEMENT_COMPONENT_IDS` | Which components count as recurring reimbursements during sync | Comma-separated ids | Falls back to `PAYCHEX_REIMBURSE_COMPONENT_ID`, then to component names that look like reimbursement, mileage, allowance, truck, or per diem |

Do not guess component ids. After connectivity works and you are in Paychex mode, sign in as an admin and request:

`GET /api/paychex/paycomponents`

with the same bearer token the app uses. The JSON lists company components (`id`, name, and related fields) plus the ids currently configured. Copy the regular, overtime, PTO, and reimbursement ids into `backend/.env`, then restart the backend. Sandbox and production components are not interchangeable.

There is no `PAYCHEX_DEBUG` switch. Startup and `npm run paychex:health` log status codes and whether credentials are present. They do not log the client secret or the bearer token.

## 4. Connectivity test

From `backend`, before you choose Paychex on `/setup`:

```bash
npm run paychex:health
```

The script loads `backend/.env`, checks that the client id, secret, and company id are non-empty, prints the environment and base URL, and redacts the company id. It then requests a token and reads `GET /companies/{companyId}`. The process exits with status 1 on failure.

Example success (fake values):

```text
Paychex health
  environment: sandbox
  base URL: https://sandbox.api.paychex.com
  company id: ************C05
  client id: set
  client secret: set
Paychex health OK
  token: obtained
  company read: HTTP 200
```

Example failure when variables are empty:

```text
Missing environment variables: PAYCHEX_CLIENT_ID, PAYCHEX_CLIENT_SECRET, PAYCHEX_COMPANY_ID
```

| Result | Meaning |
| --- | --- |
| Missing environment variables | Fill the named keys in `backend/.env` and restart is not required for this script; it reads the file itself |
| HTTP 400 or 401 | Client id or secret rejected, or the key is for the other environment. Check `PAYCHEX_ENV` and `PAYCHEX_BASE_URL` |
| HTTP 403 | The application authenticated, but this company or endpoint is not authorized |
| HTTP 404 | `PAYCHEX_COMPANY_ID` is not in this environment |
| `ENOTFOUND` | DNS failed. Check the host name |
| `ETIMEDOUT`, `ECONNREFUSED`, `ENETUNREACH` | The machine cannot reach Paychex. Check the network and the sandbox-versus-production host |
| Sandbox/production mismatch message | `PAYCHEX_ENV` and `PAYCHEX_BASE_URL` disagree. The script exits before calling Paychex |

A live sandbox call was not part of Indiction’s own install test unless you supply keys. A failed health check with no credentials is the expected result on a new clone.

## 5. Turn the mode on and sync

1. Start the backend (`npm run dev` in `backend`).
2. Start the frontend and sign in as the system administrator.
3. On `/setup`, choose **Paychex Flex**, or later turn the checkbox on in Company Settings and confirm the dialog. The server runs the same connectivity check and will not save Paychex mode if it fails.
4. Open **Settings** (`/settings`). Choose **Run full sync now**. That calls `POST /api/sync` and pulls workers, pay rates, pay components, and open pay periods. You can also sync pay-period history from the Paychex pay periods panel on that page.
5. Confirm workers appear where Daily Entry lists employees. Confirm pay periods appear for the current window.
6. Open `GET /api/paychex/paycomponents` (or the sync result) and set the component id variables if you will export or submit payroll. Restart the backend after editing `.env`.
7. Create job sites locally and map rates. Paychex sync does not create job sites.
8. Enter or review hours in Daily Entry.
9. Open Payroll and generate the SPI preview. Read the warnings. Confirm the Company ID column is your `PAYCHEX_CLIENT_CODE`, not the API company id, and not blank.
10. On Certified Payroll, use the Paychex resync action only after pay periods exist. Check data depends on a real Paychex pay period id.

Production submission (`POST /workers/{id}/checks`) is a separate confirm action in the payroll UI. Do not use it to test login.

### Before any real submission

- Company id and SPI Company ID are the values for this environment, not a sample.
- The pay period is the one you intend to pay.
- Employees, regular, overtime, PTO, and reimbursement components match Paychex.
- Hours, rates, reimbursements, and totals match your review.
- You have a database backup.
- The health check and a payroll preview already succeeded in sandbox or against read-only calls.

## Still local in Paychex mode

Job sites, classifications, daily entries, the edit lock, users, and the WH-347 project header are stored in Indiction. Worker identity and pay periods are expected to come from sync. Mixing hand-entered workers with a later Paychex sync can create duplicates. Company Settings warns about that when you change modes, and it does not delete the old rows.

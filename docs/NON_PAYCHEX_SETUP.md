# Non-Paychex setup

Use this after [Installation](INSTALLATION.md). Non-Paychex mode does not call the Paychex API and does not need Paychex credentials.

Leave `PAYCHEX_ENABLED` empty in `backend/.env`. On `/setup`, choose **Non-Paychex (local payroll)**. The app opens Local Payroll. You can return to other pages from the navigation.

If `PAYCHEX_ENABLED=0` (or `false`, `no`, `off`), the server stays in Non-Paychex even if someone checks the Paychex box later.

## What this mode changes

| Available | Not available |
| --- | --- |
| Manage Employees (workers and pay periods) | Paychex worker and pay-period sync |
| Daily Entry and My Entries | SPI export and Paychex submission |
| Spreadsheet time import | Paychex check download |
| Summary and Job Costing | |
| Local Payroll CSV | |
| Certified Payroll with amounts you type in | |

Daily hours are stored in Indiction in both modes. Job sites, classifications, and rates are always local.

## Order of work

Sign in as a system administrator. Take the global edit lock when a page says someone else is editing. Only one person can hold it.

1. **Company Settings** (`/company-settings`). Enter the company name, address, phone, email, and the certifying official’s name and title. Those fields are printed on WH-347. Saving here does not delete payroll history.
2. **Users.** System administrators and payroll admins open Manage Users. New accounts created there are `superintendent` or `payroll_admin` only. Another `system_admin` has to be created with `npm run create-admin`. Superintendents enter time. Admins manage setup and payroll.
3. **Job sites.** Create each job with a unique job code, name, and start date. For certified payroll, also enter the contract number, address, and wage determination number when you have them.
4. **Labor classifications.** Create the craft names you will assign to workers and WH-347 rows.
5. **Pay rates.** Set each worker’s standard rate, and a job-specific rate when that job pays differently. Job-specific rates override the standard rate for that site.
6. **Workers.** In Manage Employees, add each person with a unique `employee_code`. Address and the last four digits of an identifier are optional and are used on certified payroll. Codes must be unique when they are filled in. Blank codes are allowed, but spreadsheet import matches on `employee_code` first.
7. **Pay periods.** Still in Manage Employees, create each local pay period: start, end, submit-by date, and pay date. Periods must not overlap. Daily Entry will not accept a date that falls outside a period.
8. **Time.** Use Daily Entry, or import a spreadsheet from Local Payroll or Certified Payroll.
9. **Review.** Open Summary and Job Costing for that period and confirm hours, rates, and job totals.
10. **Local Payroll.** Open the period, review the rows, export `Indiction-Payroll-<period-end>.csv`, then mark the period exported or finalized when your office is done with it. Finalizing is an Indiction status. It does not send anything to a payroll provider.
11. **Certified Payroll.** Enter withholding, FICA, fringe, and net pay from your payroll records, then export the WH-347 PDF.

## Time-entry import

Download the template from the import screen, or from `GET /api/entries/import/template` while signed in as an admin in Non-Paychex mode. A sample file is in [samples/time-entry-import-sample.csv](samples/time-entry-import-sample.csv).

| Column | Required | Notes |
| --- | --- | --- |
| `date_worked` | Yes | ISO `YYYY-MM-DD` or US `M/D/YYYY` |
| `employee_code` | Preferred | Must match a worker |
| `worker_name` | No | Used only as a hint. Ambiguous names are rejected |
| `job_code` | Yes | Matches a job site code or name |
| `pay_code` | Yes | `REGULAR`, `OT`, `DT`, `PTO`, or `REIMBURSE` |
| `hours` | Yes | Zero or positive |
| `reimbursement_amount` | No | Used for `REIMBURSE` and other amounts |

The preview rejects duplicate rows inside the file. Commit with `merge` updates the same way Daily Entry does. Commit with `replace` deletes the existing row for that worker, site, date, and pay code, then inserts. Commit requires Non-Paychex mode, an admin, and the edit lock.

## Local payroll CSV

The file is `Indiction-Payroll-<period-end>.csv`. Columns:

`employee_code`, `first_name`, `last_name`, `period_start`, `period_end`, `pay_date`, `job_code`, `pay_code`, `hours`, `rate`, `amount`, `reimbursement_amount`, `total_gross`

This is not a Paychex SPI file. Do not import it into Paychex Flex as if it were `Paychex_Import.csv`.

## Taxes

Indiction does not file payroll and does not compute authoritative tax. On Certified Payroll, type withholding and related amounts from the payroll system or accounting records that actually paid the employee. Any FICA figure Indiction estimates in Non-Paychex mode is a helper for review, not a filing number.

## Switching later

Company Settings can turn Paychex on. Confirm the dialog before you do. Historical rows stay. Paychex sync will not automatically replace them. Finish [Paychex setup](PAYCHEX_SETUP.md), including `npm run paychex:health`, before you switch. The server rejects the switch when credentials are missing or the connectivity check fails.

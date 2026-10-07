# Paychex vs Non-Paychex Feature-Parity Matrix

Generated during the parity audit. Status reflects the codebase after the
parity implementation work described in this document's companion changes.

| # | Feature | Paychex mode | Non-Paychex (before) | Parity? | Inherently Paychex-only? | Provider-neutral equivalent | Change |
|---|---------|--------------|----------------------|---------|--------------------------|-----------------------------|--------|
| 1 | Setup / mode selection | Wizard → Paychex | Wizard → Non-Paychex | Yes | No | Same wizard | Keep; add switch confirmation |
| 2 | Workers CRUD | Sync from Paychex | Manage Employees | Partial | No | Local CRUD + WH-347 fields | Add address, identifying last-4, unique employee_code, inactive handling |
| 3 | Pay periods | Sync from Paychex | Create/delete only | Partial | No | Local create/edit/open/close | Status UI + reopen confirmation |
| 4 | Pay codes | Paychex components | STANDARD_DAILY_PAY_CODES | Yes (standard set) | Custom Paychex comps | Canonical REGULAR/OT/DT/PTO/REIMBURSE | Centralize in payCodeMapping |
| 5 | Default rates | Synced | standard_rate on worker | Yes | No | — | Keep |
| 6 | Job-site rates | Admin UI | Admin UI | Yes | No | — | Keep |
| 7 | Classifications | Admin UI | Admin UI | Yes | No | — | Keep |
| 8 | Recurring reimbursements | Paychex sync table | Empty / wrong labels | Gap | Provider sync | Entry-level reimbursements; label “Recurring” only when local data exists | Relabel; hide empty Paychex metric |
| 9 | Daily entry | Yes | Yes | Yes | No | — | Keep |
| 10 | Bulk daily entry | Yes | Yes | Yes | No | — | Keep |
| 11 | Spreadsheet import | N/A | Certified Payroll panel | Partial | No | Harden + link from Daily Entry / Local Payroll | Duplicate detection, reimbursement col |
| 12 | My Entries | Yes | Yes | Yes | No | — | Keep |
| 13 | Summary + CSV | Uses `/api/payroll/pay-periods` | **Broken (403)** | Gap | No | Load periods from `/api/pay-periods` | Fix period source + labels |
| 14 | Payroll review/export | SPI + submit | Redirect to employees | **Major gap** | SPI submit yes | Local Payroll workspace + CSV/XLSX | New page + API |
| 15 | Job costing + CSV | Yes | Periods 403 + Paychex labels | Gap | No | Same job-costing API | Fix periods + labels |
| 16 | CP hour grid | Yes | Local hours | Yes | No | — | Terminology cleanup |
| 17 | CP supplements/taxes | Paychex checks | Estimate + manual | Partial | Check fetch yes | Manual withholding; clear estimate labels | UI + no fake provider data |
| 18 | WH-347 PDF | Yes | Yes (local) | Yes | No | — | Keep |
| 19 | Check reconciliation | Paychex | N/A / misleading warnings | Gap | Yes | Hide Paychex warnings in local mode | Gate UI |
| 20 | Job sites / week number | Yes | Yes | Yes | No | — | Keep |
| 21 | Company settings | + sync | Mode toggle (unsafe) | Partial | Sync yes | Mode-switch confirm + common settings | Safety |
| 22 | Users | Yes | Yes | Yes | No | — | Keep |
| 23 | Sync/status | Settings page | Redirected away | OK | Yes | Local settings links | Mode-aware settings home |
| 24 | Global edit lock | Yes | Yes | Yes | No | — | Keep |
| 25 | Auth / sessions | Yes | Yes | Yes | No | — | Keep |
| 26 | Terminology | Paychex | Leaks in CP/Summary/JC | Gap | — | Capability-aware labels | Centralize |

## Architecture decision

Extend `getAppConfig()` / `AppConfigContext` with a small **capabilities** object
derived from `paychexEnabled`. No plugin framework. Backend continues to
enforce with `requirePaychexEnabled` / `requirePaychexDisabled`. Frontend
hides Paychex-only UI using the same capability flags.

## Gaps prioritized for implementation

1. Local Payroll workspace (review + export) — **DONE** (`/local-payroll`)
2. Summary / Job Costing period loading — **DONE** (`/api/pay-periods`)
3. Worker WH-347 fields + unique employee_code — **DONE** (migration 019)
4. Pay period open/close UI — **DONE**
5. Mode-switch confirmation — **DONE**
6. Certified Payroll / Job Costing terminology — **DONE**
7. Import hardening — **DONE**
8. Canonical pay-code metadata — **DONE**
9. Tests + README — **DONE**

## Remaining limitations / future work

- Custom local pay components beyond REGULAR/OT/DT/PTO/REIMBURSE
- Local recurring reimbursements with job-site allocation (entry-level reimbursements only)
- Full WH-347 week-grid workbook import (Phase 2)
- Automatic Paychex↔local worker reconciliation on mode switch (preview/manual only)
- XLSX local payroll export (CSV shipped; XLSX optional future)

# Expenses (Molly plugin)

Brett, Nov 8 2026: "Standalone apps keep working until Molly covers them; list gaps as pending builds."

- **What:** the Expense Tracker's Ledger, Paydays and Reports drawn natively in Molly (no frame), on framework controls
  (DataGrid, Container, TextField, SelectField, Segmented, Meter). Views `expenses/ledger`, `expenses/paydays`,
  `expenses/reports`; deep links `#/expenses/ledger` …; nav section "Expenses"; Go menu.
- **Data:** the Expense Tracker's own ledger API (`https://expenses.amberxai.com/api/expenses/v1`), called with the
  signed-in session cookie (the API answers Molly's origin with CORS + credentials). Same document as the standalone
  app, which keeps working on its own. Settings → Plugins → Expenses → Ledger API address.
- **Commands** (plugin.json `commands`, also console actions): `expenses.open`, `expenses.list`, `expenses.get`,
  `expenses.add`, `expenses.edit`, `expenses.totals`, `expenses.export`, `expenses.paydays.get`,
  `expenses.paydays.fill`, `expenses.report.get`, `expenses.report`, `expenses.report.copy`, `expenses.refresh`,
  `expenses.settings`.
- **Surface** (plugin.json `surface`, shell-surface@1): which standalone screens this replaces and what is still pending
  (assistant, settings, import, vault, delete).

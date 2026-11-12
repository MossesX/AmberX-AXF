# Expenses (Molly plugin)

Brett, Nov 8 2026: "Standalone apps keep working until Molly covers them; list gaps as pending builds."

- **What:** the Expense Tracker's Ledger, Paydays, Reports and Assistant drawn natively in Molly (no frame), on framework
  controls (DataGrid, Container, TextField, SelectField, Segmented, Switch, Meter, Markdown). Views `expenses/ledger`,
  `expenses/paydays`, `expenses/reports`, `expenses/assistant`; deep links `#/expenses/ledger` …; nav section
  "Expenses"; the Molly menu (its index of apps) lists every screen under Expenses.
- **Settings:** Settings → Plugins → Expenses: Connection (ledger API address) and the app's own six sections (General,
  Grid & filter, Paydays, Welcome, Import, AI) over `/api/expenses/v1/settings`, the same document the app's settings
  dialog writes. AI connection keys stay in the standalone app.
- **Assistant:** the app's own `/api/ai/*` (same conversations as the standalone panel, streamed turns), chat mode.
- **Data:** the Expense Tracker's own ledger API (`https://expenses.amberxai.com/api/expenses/v1`), called with the
  signed-in session cookie (the API answers Molly's origin with CORS + credentials). Same document as the standalone
  app, which keeps working on its own. Settings → Plugins → Expenses → Ledger API address.
- **Commands** (plugin.json `commands`, also console actions): `expenses.open`, `expenses.list`, `expenses.get`,
  `expenses.add`, `expenses.edit`, `expenses.totals`, `expenses.export`, `expenses.paydays.get`,
  `expenses.paydays.fill`, `expenses.report.get`, `expenses.report`, `expenses.report.copy`, `expenses.refresh`,
  `expenses.assistant.list|read|new|ask`, `expenses.settings.get|set|reset`, `expenses.settings`.
- **Surface** (plugin.json `surface`, shell-surface@1): which standalone screens this replaces and what is still pending
  (assistant edit/build modes, AI keys, import, vault, delete).

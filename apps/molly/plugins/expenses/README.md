# Expenses (Molly module)

The Expense Tracker as a module inside Molly (build convert-every-app-into-a-molly-module, Nov 2026; Brett: "Can we
convert the apps to modules then?"). Expenses is a Next.js 16 app, so its own screens cannot mount in Molly's React page;
this plugin is its Molly module instead: Molly draws the screens with framework controls and reads and writes the same
ledger through the Expenses API (`/api/expenses/v1`, `apps/expenses/app/api/expenses/v1`) with Molly's one sign-in
(`molly/credentials.ts`, app `expenses`). The standalone app at expenses.amberxai.com is untouched.

- Screens: `expenses` (ledger: spent / income / net, newest entries, search) and `expenses/add` (Add entry).
  Deep links `#/expenses`, `#/expenses/add`.
- Actions: `expenses.list[:words]`, `expenses.totals`, `expenses.add:<amount>:<merchant>[:<category>[:<account>]]`,
  `expenses.open[:add]`. The plugin commands in `plugin.json` list them for the console API, MCP, CLI and voice.
- The module is registered with `provideModule` (molly/native.tsx), so it is fenced like every module: Settings →
  Modules switches it off, and a crash stops only it.

Remove it: `node apps/molly/plugins/expenses/uninstall.mjs --all` (Expenses then opens on its own again).

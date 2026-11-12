/**
 * Ledger API checks (src/server/expensesApi.ts + app/api/expenses/v1): auth, add, edit, filters, totals, accounts,
 * CSV, the daily backup, and that the document keeps the app's shape. Runs on a throwaway data root.
 *
 *   cd apps/expenses && npx tsx scripts/expenses-api.test.mts
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "expenses-api-"));
process.env.AXS_DATA_ROOT = root;
process.env.EXPENSES_API_TOKEN = "t".repeat(40);
process.env.EXPENSES_API_USER = "Tester";

let fails = 0, n = 0;
const ok = (c: unknown, m: string) => { n++; if (!c) { fails++; console.log(`✗ ${m}`); } };

// a ledger in the app's stored shape (kv envelope), with one pre-existing entry
const dir = path.join(root, "axf", "kv", "Tester");
mkdirSync(dir, { recursive: true });
const seed = { id: "exp_seed", date: "2026-10-01", merchant: "World Cuts", category: "personal", paymentMethod: "Discover", currency: "USD",
  items: [{ id: "li_seed", description: "Cut", unit: 3690, qty: 1 }], tax: 0, tip: 0, statedTotal: 3690, source: "import", createdAt: 1, updatedAt: 1 };
writeFileSync(path.join(dir, "expenses.json"), JSON.stringify({ format: "axf-kv/1", user: "Tester", ns: "expenses", updatedAt: new Date().toISOString(), doc: { expenses: [seed] } }));

try {
  const route = await import("../app/api/expenses/v1/[...path]/route.ts");
  const ctx = (...p: string[]) => ({ params: Promise.resolve({ path: p }) });
  const H = { authorization: `Bearer ${"t".repeat(40)}`, "content-type": "application/json" };
  const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = H) =>
    new Request(`http://x/api/expenses/v1/${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  ok((await route.GET(req("GET", "entries", undefined, {}), ctx("entries"))).status === 401, "no auth → 401");
  ok((await route.GET(req("GET", "entries", undefined, { authorization: "Bearer nope" }), ctx("entries"))).status === 401, "wrong token → 401");

  let r = await route.GET(req("GET", "entries"), ctx("entries"));
  let j = await r.json();
  ok(r.status === 200 && j.count === 1 && j.entries[0].totalCents === 3690 && j.entries[0].total === 36.9, "list reads the stored ledger");

  r = await route.POST(req("POST", "entries", { merchant: "Dunkin", amount: 4.25, date: "2026-11-04", category: "food", account: "Cash" }), ctx("entries"));
  j = await r.json();
  ok(r.status === 201 && j.entry.statedTotal === 425 && j.entry.items[0].unit === 425 && j.entry.source === "manual", "add stores cents");
  const id = j.entry.id as string;
  ok((await route.POST(req("POST", "entries", { merchant: "x" }), ctx("entries"))).status === 400, "add without amount → 400");
  ok((await route.POST(req("POST", "entries", { merchant: "x", amount: 1, date: "11/4/26" }), ctx("entries"))).status === 400, "bad date → 400");

  r = await route.POST(req("POST", "entries", { merchant: "Paycheck", amount: 1000, date: "2026-11-01", income: true, kind: "income" }), ctx("entries"));
  ok(r.status === 201 && (await r.json()).entry.kind === "income", "add income");

  r = await route.PATCH(req("PATCH", `entries/${id}`, { amount: 5, note: "large" }), ctx("entries", id));
  j = await r.json();
  ok(r.status === 200 && j.entry.statedTotal === 500 && j.entry.items[0].unit === 500 && j.entry.note === "large" && j.entry.merchant === "Dunkin", "edit changes only what is sent");
  ok((await route.PATCH(req("PATCH", "entries/none", { amount: 1 }), ctx("entries", "none"))).status === 404, "edit unknown id → 404");

  j = await (await route.GET(req("GET", "entries?account=Cash"), ctx("entries"))).json();
  ok(j.count === 1 && j.entries[0].id === id, "filter by account");
  j = await (await route.GET(req("GET", "entries?q=world"), ctx("entries"))).json();
  ok(j.count === 1 && j.entries[0].id === "exp_seed", "text search");

  j = await (await route.GET(req("GET", "totals?by=category"), ctx("totals"))).json();
  ok(j.totals.count === 3 && j.totals.spentCents === 4190 && j.totals.incomeCents === 100000 && j.totals.netCents === 100000 - 4190, "totals");
  ok(j.totals.by.food.cents === 500 && j.totals.by.personal.cents === 3690, "totals by category");

  j = await (await route.GET(req("GET", "accounts"), ctx("accounts"))).json();
  ok(j.accounts.some((a: { account: string; count: number }) => a.account === "Discover" && a.count === 1), "accounts");

  r = await route.GET(req("GET", "export?format=csv"), ctx("export"));
  const csv = await r.text();
  ok(r.headers.get("content-type")?.startsWith("text/csv") && csv.split("\n")[0]!.startsWith("id,date,merchant") && csv.includes("Dunkin") && csv.includes("5.00"), "CSV export");

  const stored = JSON.parse(readFileSync(path.join(dir, "expenses.json"), "utf8"));
  ok(stored.doc.expenses.length === 3 && stored.doc.expenses[0].id === "exp_seed" && stored.user === "Tester", "document keeps the app's kv shape and the old entry");
  const backups = readdirSync(dir).filter((f) => f.startsWith("expenses.api-backup-"));
  ok(backups.length === 1 && JSON.parse(readFileSync(path.join(dir, backups[0]!), "utf8")).doc.expenses.length === 1, "one daily backup, taken before the first write");

  // Molly: cross-origin with credentials from the allow-list only; same-origin calls get no CORS headers
  const MOLLY = "https://molly.amberxai.com";
  r = await route.GET(req("GET", "me"), ctx("me"));
  ok(r.status === 200 && (await r.json()).user === "Tester" && !r.headers.get("access-control-allow-origin"), "me → user, no CORS headers without an Origin");
  r = await route.GET(req("GET", "me", undefined, { ...H, origin: MOLLY }), ctx("me"));
  ok(r.headers.get("access-control-allow-origin") === MOLLY && r.headers.get("access-control-allow-credentials") === "true", "Molly origin → CORS with credentials");
  r = await route.GET(req("GET", "entries", undefined, { origin: MOLLY }), ctx("entries"));
  ok(r.status === 401 && r.headers.get("access-control-allow-origin") === MOLLY, "signed-out Molly call → 401 the browser can read");
  r = await route.GET(req("GET", "me", undefined, { ...H, origin: "https://evil.example" }), ctx("me"));
  ok(!r.headers.get("access-control-allow-origin"), "other origin → no CORS headers");
  r = route.OPTIONS(new Request("http://x/api/expenses/v1/entries", { method: "OPTIONS", headers: { origin: MOLLY, "access-control-request-method": "POST" } }));
  ok(r.status === 204 && r.headers.get("access-control-allow-methods")?.includes("PATCH"), "preflight from Molly → 204");
  ok(route.OPTIONS(new Request("http://x/api/expenses/v1/entries", { method: "OPTIONS", headers: { origin: "https://evil.example" } })).status === 403, "preflight from elsewhere → 403");

  // paydays: no schedule → not ready, fill refused; with a schedule → missing dates, fill adds them once
  r = await route.GET(req("GET", "paydays?today=2026-11-10"), ctx("paydays"));
  j = await r.json();
  ok(r.status === 200 && j.ready === false && j.missing.length === 0, "paydays without a schedule → not ready");
  ok((await route.POST(req("POST", "paydays?today=2026-11-10"), ctx("paydays"))).status === 409, "fill without a schedule → 409");
  writeFileSync(path.join(dir, "expenses-settings.json"), JSON.stringify({ format: "axf-kv/1", user: "Tester", ns: "expenses-settings", updatedAt: new Date().toISOString(),
    doc: { settings: { paydayAmount: 1500, paydayEvery: "monthly", paydayDayOfMonth: 1, paydaySince: "2026-10-01", paydayPayer: "Acme" } } }));
  r = await route.GET(req("GET", "paydays?today=2026-11-10"), ctx("paydays"));
  j = await r.json();
  ok(j.ready === true && j.missing.join() === "2026-10-01,2026-11-01" && j.next === "2026-12-01" && j.schedule.amount === 150000, "paydays → missing and next from the stored schedule");
  r = await route.POST(req("POST", "paydays?today=2026-11-10"), ctx("paydays"));
  j = await r.json();
  ok(r.status === 200 && j.added === 2 && j.entries[0].merchant === "Acme" && j.entries[0].kind === "income", "fill adds the missing paydays");
  j = await (await route.POST(req("POST", "paydays?today=2026-11-10"), ctx("paydays"))).json();
  ok(j.added === 0, "fill twice adds nothing");

  // statement: a month's totals, the periods the ledger spans, markdown
  r = await route.GET(req("GET", "statement?kind=month&date=2026-11-04"), ctx("statement"));
  j = await r.json();
  ok(r.status === 200 && j.statement.period.from === "2026-11-01" && j.statement.income >= 150000 && j.periods.length >= 2 && typeof j.markdown === "string", "statement → month totals and periods");
  ok((await route.GET(req("GET", "statement?date=nope"), ctx("statement"))).status === 400, "statement with a bad date → 400");

  // settings: the decl's rows over the app's kv document; checked values; null = default
  r = await route.GET(req("GET", "settings"), ctx("settings"));
  j = await r.json();
  ok(r.status === 200 && j.values.paydayAmount === 1500 && j.values.confirmDelete === true && j.sections.length === 6 && j.rows.some((x: { key: string; section: string }) => x.key === "paydayEvery" && x.section === "paydays"), "settings → values with defaults, rows, sections");
  r = await route.PATCH(req("PATCH", "settings", { toastSeconds: 8, paydayEvery: "weekly", confirmDelete: false }), ctx("settings"));
  j = await r.json();
  ok(r.status === 200 && j.values.toastSeconds === 8 && j.values.paydayEvery === "weekly" && j.values.confirmDelete === false, "settings PATCH saves checked values");
  const storedSettings = JSON.parse(readFileSync(path.join(dir, "expenses-settings.json"), "utf8"));
  ok(storedSettings.doc.settings.paydayPayer === "Acme" && storedSettings.doc.settings.toastSeconds === 8 && storedSettings.doc.v === 1, "settings keep the app's document shape and other values");
  ok((await route.PATCH(req("PATCH", "settings", { toastSeconds: 99 }), ctx("settings"))).status === 400, "out-of-range number → 400");
  ok((await route.PATCH(req("PATCH", "settings", { paydayEvery: "hourly" }), ctx("settings"))).status === 400, "unknown option → 400");
  ok((await route.PATCH(req("PATCH", "settings", { nope: 1 }), ctx("settings"))).status === 400, "unknown key → 400");
  j = await (await route.PATCH(req("PATCH", "settings", { toastSeconds: null }), ctx("settings"))).json();
  ok(j.values.toastSeconds === 4 && !j.changed.includes("toastSeconds"), "null puts a setting back to its default");

  // the assistant routes' wrapper: a Molly call needs a signed-in session; same-origin runs unchanged
  const { corsRoute } = await import("../src/server/cors.ts");
  const h = corsRoute(async () => Response.json({ ok: true }));
  r = await h(new Request("http://x/api/ai/status", { headers: { origin: MOLLY } }));
  ok(r.status === 401 && r.headers.get("access-control-allow-origin") === MOLLY, "assistant: signed-out Molly call → 401 with CORS");
  r = await h(new Request("http://x/api/ai/status"));
  ok(r.status === 200 && !r.headers.get("access-control-allow-origin"), "assistant: same-origin call unchanged");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(fails ? `✗ ${fails} of ${n} expenses API checks failed` : `✓ expenses API — ${n} checks`);
process.exit(fails ? 1 : 0);

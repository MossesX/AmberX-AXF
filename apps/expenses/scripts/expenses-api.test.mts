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
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(fails ? `✗ ${fails} of ${n} expenses API checks failed` : `✓ expenses API — ${n} checks`);
process.exit(fails ? 1 : 0);

/**
 * Grid save checks (app/api/expenses/route.ts, build app-voice-commands): a tab's whole-list save merges by entry id,
 * so an entry added through the ledger API, the CLI, MCP or a voice command while the tab is open is kept; ids the
 * tab knew and dropped are deletes; `replace: true` (Load a snapshot) and a body without `known` replace the list.
 *
 *   cd apps/expenses && npx tsx scripts/expenses-grid.test.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "expenses-grid-"));
process.env.AXS_DATA_ROOT = root;
process.env.EXPENSES_API_TOKEN = "t".repeat(40);
process.env.EXPENSES_API_USER = "local"; // the grid route acts as the cookie user ("local" without one); the API as X-Expenses-User

let fails = 0, n = 0;
const ok = (c: unknown, m: string) => { n++; if (!c) { fails++; console.log(`✗ ${m}`); } };

const dir = path.join(root, "axf", "kv", "local");
mkdirSync(dir, { recursive: true });
const entry = (id: string, merchant: string) => ({ id, date: "2026-11-04", merchant, category: "food", currency: "USD",
  items: [{ id: `li_${id}`, description: "x", unit: 100, qty: 1 }], tax: 0, tip: 0, statedTotal: 100, source: "manual", createdAt: 1, updatedAt: 1 });
const a = entry("exp_a", "A"), b = entry("exp_b", "B");
writeFileSync(path.join(dir, "expenses.json"), JSON.stringify({ format: "axf-kv/1", user: "local", ns: "expenses", updatedAt: new Date().toISOString(), doc: { expenses: [a, b] } }));

try {
  const grid = await import("../app/api/expenses/route.ts");
  const api = await import("../app/api/expenses/v1/[...path]/route.ts");
  const H = { authorization: `Bearer ${"t".repeat(40)}`, "content-type": "application/json", "x-expenses-user": "local" };
  const post = (body: unknown) => grid.POST(new Request("http://x/api/expenses", { method: "POST", headers: H, body: JSON.stringify(body) }));
  const list = async () => ((await (await grid.GET(new Request("http://x/api/expenses", { headers: H }))).json()) as { expenses: { id: string; merchant: string }[] }).expenses;

  // the tab loaded [a, b]; the API adds c; the tab then saves its edited [a', b] with known = [a, b]
  let r = await api.POST(new Request("http://x/api/expenses/v1/entries", { method: "POST", headers: H, body: JSON.stringify({ merchant: "C", amount: 1, date: "2026-11-04" }) }), { params: Promise.resolve({ path: ["entries"] }) });
  const c = ((await r.json()) as { entry: { id: string } }).entry;
  ok(r.status === 201, "API adds c while the tab is open");
  r = await post({ expenses: [{ ...a, merchant: "A edited" }, b], known: ["exp_a", "exp_b"] });
  let j = (await r.json()) as { ok: boolean; added: number; expenses?: { id: string }[] };
  ok(r.status === 200 && j.ok && j.added === 1 && j.expenses?.length === 3, "merged save reports the entry it kept");
  let now = await list();
  ok(now.length === 3 && now.find((e) => e.id === "exp_a")?.merchant === "A edited" && now.some((e) => e.id === c.id), "the tab's edit and the API's add both survive");

  // the tab now knows c too and deletes b: a known id that is no longer sent is a delete
  r = await post({ expenses: [{ ...a, merchant: "A edited" }, c], known: ["exp_a", "exp_b", c.id] });
  j = await r.json();
  now = await list();
  ok(j.added === 0 && now.length === 2 && !now.some((e) => e.id === "exp_b"), "a known id left out is deleted, nothing resurrected");

  // an older client (no `known`) still replaces the whole list
  r = await post({ expenses: [a] });
  now = await list();
  ok(r.status === 200 && now.length === 1 && now[0]!.id === "exp_a", "no known = replace (older clients)");

  // Load a snapshot replaces even when the server has more
  await api.POST(new Request("http://x/api/expenses/v1/entries", { method: "POST", headers: H, body: JSON.stringify({ merchant: "D", amount: 2, date: "2026-11-04" }) }), { params: Promise.resolve({ path: ["entries"] }) });
  r = await post({ expenses: [a, b], known: ["exp_a"], replace: true });
  now = await list();
  ok(now.length === 2 && now.every((e) => e.id === "exp_a" || e.id === "exp_b"), "replace: true is total (snapshot load)");

  ok((await post({ expenses: "nope" })).status === 400, "bad body → 400");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(fails ? `${fails} of ${n} grid checks failed` : `✓ expenses grid save: ${n} checks pass`);
process.exit(fails ? 1 : 0);

/**
 * @file The ledger API behind `/api/expenses/v1/*` (build expenses-port, Nov 4 2026), used by
 * `scripts/expenses-cli.mjs` and the AmberX-AXF console's MCP tools. **Node-only.**
 *
 * It reads and writes the SAME kv document the app does (`axf/kv/<user>/expenses.json`), so the grid,
 * the API and the CLI are one ledger. Who a call acts as:
 *   - a signed-in browser: the `axs_session` user (never the signed-out "local" owner), or
 *   - `Authorization: Bearer <EXPENSES_API_TOKEN>` (container env, never in the repo): the user named by
 *     `X-Expenses-User`, else `EXPENSES_API_USER`. No token configured = bearer calls are refused.
 *
 * Writes go through `KvStore.write` (atomic rename, chained) after a once-a-day copy of the document
 * (`expenses.api-backup-YYYYMMDD.json`, next to it), so an API write can always be undone by hand.
 * Money stays in integer cents, like the app (`math.ts`).
 */
import crypto from "node:crypto";
import { copyFile, stat } from "node:fs/promises";
import path from "node:path";

import { axsUserFromCookieHeader } from "@axs/modules/accounts/lib/session";
import { effectiveTotal, flow, toCents } from "@axs/modules/expenses/math";
import type { Expense, ExpenseKind } from "@axs/modules/expenses/types";

import { KV_ROOT, axfKv } from "./axfKv";

const NS = "expenses";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The user this request acts as, or an ApiError (401). */
export function apiUser(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const want = process.env.EXPENSES_API_TOKEN ?? "";
    const got = auth.slice(7).trim();
    if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
      throw new ApiError(401, "bad or unconfigured API token");
    }
    const user = (request.headers.get("x-expenses-user") ?? process.env.EXPENSES_API_USER ?? "").trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) throw new ApiError(400, "no user: send X-Expenses-User or set EXPENSES_API_USER");
    return user;
  }
  const user = axsUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) throw new ApiError(401, "sign in or send a bearer token");
  return user;
}

export async function readLedger(user: string): Promise<Expense[]> {
  const doc = (await axfKv.read(user, NS)) as { expenses?: unknown } | null;
  return Array.isArray(doc?.expenses) ? (doc.expenses as Expense[]) : [];
}

export async function writeLedger(user: string, expenses: Expense[]): Promise<void> {
  const file = path.join(KV_ROOT, user, `${NS}.json`);
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const backup = path.join(KV_ROOT, user, `${NS}.api-backup-${day}.json`);
  const exists = (p: string) => stat(p).then(() => true, () => false);
  if ((await exists(file)) && !(await exists(backup))) await copyFile(file, backup);
  await axfKv.write(user, NS, { expenses });
}

export interface Query { from?: string; to?: string; category?: string; account?: string; q?: string; kind?: string; limit?: number }

export function queryOf(url: URL): Query {
  const g = (k: string) => url.searchParams.get(k) ?? undefined;
  const limit = Number(g("limit"));
  return { from: g("from"), to: g("to"), category: g("category"), account: g("account"), q: g("q")?.toLowerCase(), kind: g("kind"), limit: Number.isFinite(limit) && limit > 0 ? limit : undefined };
}

export function filterLedger(list: Expense[], q: Query): Expense[] {
  const out = list.filter((e) =>
    (!q.from || e.date >= q.from) && (!q.to || e.date <= q.to) &&
    (!q.category || e.category === q.category) && (!q.account || (e.paymentMethod ?? "") === q.account) &&
    (!q.kind || (e.kind ?? "expense") === q.kind) &&
    (!q.q || `${e.merchant} ${e.note ?? ""} ${e.items.map((i) => i.description).join(" ")}`.toLowerCase().includes(q.q)));
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return q.limit ? out.slice(0, q.limit) : out;
}

/** One row a person or a tool reads: the entry plus its total in cents and dollars. */
export const row = (e: Expense) => ({ ...e, totalCents: effectiveTotal(e), total: effectiveTotal(e) / 100 });

export interface Totals { count: number; spentCents: number; incomeCents: number; netCents: number; by?: Record<string, { count: number; cents: number }> }

export function totals(list: Expense[], by?: string): Totals {
  const t: Totals = { count: list.length, spentCents: 0, incomeCents: 0, netCents: 0 };
  const key = by === "category" ? (e: Expense) => e.category
    : by === "account" ? (e: Expense) => e.paymentMethod || "(none)"
    : by === "month" ? (e: Expense) => e.date.slice(0, 7)
    : by === "merchant" ? (e: Expense) => e.merchant
    : null;
  if (key) t.by = {};
  for (const e of list) {
    const c = effectiveTotal(e);
    if ((e.kind ?? "expense") === "income") t.incomeCents += c; else t.spentCents += c;
    t.netCents += flow(e);
    if (key && t.by) { const k = key(e); const b = (t.by[k] ??= { count: 0, cents: 0 }); b.count += 1; b.cents += c; }
  }
  return t;
}

export function accounts(list: Expense[]) {
  const m = new Map<string, { account: string; count: number; spentCents: number; incomeCents: number; last: string }>();
  for (const e of list) {
    const k = e.paymentMethod || "(none)";
    const a = m.get(k) ?? { account: k, count: 0, spentCents: 0, incomeCents: 0, last: "" };
    a.count += 1;
    if ((e.kind ?? "expense") === "income") a.incomeCents += effectiveTotal(e); else a.spentCents += effectiveTotal(e);
    if (e.date > a.last) a.last = e.date;
    m.set(k, a);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

const csvCell = (v: unknown) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function toCsv(list: Expense[]): string {
  const head = ["id", "date", "merchant", "category", "account", "kind", "total", "tax", "tip", "currency", "note", "disputed"];
  const lines = list.map((e) => [e.id, e.date, e.merchant, e.category, e.paymentMethod ?? "", e.kind ?? "expense",
    (effectiveTotal(e) / 100).toFixed(2), (e.tax / 100).toFixed(2), (e.tip / 100).toFixed(2), e.currency, e.note ?? "", e.disputed ? "yes" : ""].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

/** Fields a caller may send for an entry. `amount` is dollars, `amountCents` cents (one of them on add). */
export interface EntryInput {
  date?: string; merchant?: string; category?: string; account?: string; paymentMethod?: string; note?: string;
  kind?: ExpenseKind; amount?: number; amountCents?: number; tax?: number; tip?: number; currency?: string;
  reimbursable?: boolean; disputed?: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cents = (i: EntryInput): number | undefined =>
  typeof i.amountCents === "number" ? Math.round(i.amountCents) : typeof i.amount === "number" ? toCents(i.amount) : undefined;
const newId = (p: string) => `${p}_api_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

export function newEntry(i: EntryInput): Expense {
  const c = cents(i);
  if (c === undefined || !Number.isFinite(c)) throw new ApiError(400, "amount (dollars) or amountCents is needed");
  if (!i.merchant?.trim()) throw new ApiError(400, "merchant is needed");
  const date = i.date ?? new Date().toISOString().slice(0, 10);
  if (!ISO.test(date)) throw new ApiError(400, "date must be YYYY-MM-DD");
  const now = Date.now();
  const kind: ExpenseKind = i.kind === "income" ? "income" : "expense";
  return {
    id: newId("exp"), date, merchant: i.merchant.trim(), category: i.category?.trim() || (kind === "income" ? "income" : "other"),
    ...(i.note ? { note: i.note } : {}), paymentMethod: (i.account ?? i.paymentMethod)?.trim() || undefined,
    currency: i.currency || "USD", ...(kind === "income" ? { kind } : {}),
    items: [{ id: newId("li"), description: i.merchant.trim(), unit: c, qty: 1 }],
    tax: toCents(i.tax ?? 0), tip: toCents(i.tip ?? 0), statedTotal: c, source: "manual",
    ...(i.reimbursable ? { reimbursable: true } : {}), createdAt: now, updatedAt: now,
  } as Expense;
}

export function editEntry(e: Expense, i: EntryInput): Expense {
  const out = { ...e } as Expense & Record<string, unknown>;
  if (i.date !== undefined) { if (!ISO.test(i.date)) throw new ApiError(400, "date must be YYYY-MM-DD"); out.date = i.date; }
  if (i.merchant !== undefined) out.merchant = i.merchant;
  if (i.category !== undefined) out.category = i.category;
  if (i.note !== undefined) out.note = i.note;
  if (i.account !== undefined || i.paymentMethod !== undefined) out.paymentMethod = i.account ?? i.paymentMethod;
  if (i.kind !== undefined) { if (i.kind === "income") out.kind = "income"; else delete out.kind; }
  if (i.currency !== undefined) out.currency = i.currency;
  if (i.tax !== undefined) out.tax = toCents(i.tax);
  if (i.tip !== undefined) out.tip = toCents(i.tip);
  if (i.reimbursable !== undefined) out.reimbursable = i.reimbursable;
  if (i.disputed !== undefined) out.disputed = i.disputed;
  const c = cents(i);
  if (c !== undefined) {
    // a one-line entry: move the line with the total; a receipt keeps its lines and only the printed total changes
    if (e.items.length === 1) out.items = [{ ...e.items[0]!, unit: c, qty: 1 }];
    out.statedTotal = c;
  }
  (out as { updatedAt?: number }).updatedAt = Date.now();
  return out;
}

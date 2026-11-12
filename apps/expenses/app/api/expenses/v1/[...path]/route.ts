/**
 * @file `/api/expenses/v1/*` — the ledger API for tools (CLI, MCP) and scripts. See `src/server/expensesApi.ts`
 * for who a call acts as and how writes are kept safe.
 *
 *   GET   /api/expenses/v1/entries?from&to&category&account&kind&q&limit   → { entries, count }
 *   GET   /api/expenses/v1/entries/<id>                                     → { entry }
 *   POST  /api/expenses/v1/entries        body EntryInput                   → { entry }  (201)
 *   PATCH /api/expenses/v1/entries/<id>   body EntryInput (fields to change) → { entry }
 *   GET   /api/expenses/v1/accounts?from&to                                 → { accounts }
 *   GET   /api/expenses/v1/totals?from&to&category&account&by=category|account|month|merchant → { totals }
 *   GET   /api/expenses/v1/export?format=csv|json&from&to…                  → text/csv or { entries }
 *   GET   /api/expenses/v1/paydays?today                                    → { schedule, ready, next, missing, recent }
 *   POST  /api/expenses/v1/paydays?today  (adds the missing paydays)        → { added, entries }
 *   GET   /api/expenses/v1/statement?kind=month|quarter|year&date&today     → { statement, periods, markdown }
 *   GET   /api/expenses/v1/settings                                         → { values, changed, rows, sections }
 *   PATCH /api/expenses/v1/settings      body { key: value | null }         → same (null = back to the default)
 *   GET   /api/expenses/v1/me                                               → { user } (who this call acts as)
 *
 * Molly (molly.amberxai.com) calls these cross-origin with the user's session cookie: an allowed Origin gets CORS
 * headers and preflight answers (`src/server/cors.ts`); same-origin and tool calls are unchanged.
 *
 * Deleting is left to the app (it has the undoable delete dialog); the API never removes an entry.
 */
import {
  ApiError, accounts, apiUser, editEntry, fillPaydays, filterLedger, newEntry, paydaysView, queryOf, readLedger, readPaySchedule,
  row, statementView, toCsv, totals, writeLedger,
  type EntryInput,
} from "../../../../../src/server/expensesApi";
import { preflight, withCors } from "../../../../../src/server/cors";
import { patchSettings, settingsView } from "../../../../../src/server/expensesSettings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

const MAX_BODY_BYTES = 64 * 1024;

/** The caller's today (YYYY-MM-DD, its own time zone) or the server's. */
function todayOf(url: URL): string {
  const t = url.searchParams.get("today");
  if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return new Date().toISOString().slice(0, 10);
}

async function body(request: Request): Promise<EntryInput> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new ApiError(413, "body too large");
  try {
    const b = JSON.parse(raw) as unknown;
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b as EntryInput;
  } catch {
    throw new ApiError(400, "body must be a JSON object");
  }
}

function fail(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: e instanceof Error ? e.message : "server error" }, { status: 500 });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return withCors(request, await handleGET(request, ctx));
}

async function handleGET(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const user = apiUser(request);
    const [what, id] = (await ctx.params).path ?? [];
    if (what === "me") return Response.json({ user });
    if (what === "settings") return Response.json(await settingsView(user));
    const url = new URL(request.url);
    const q = queryOf(url);
    const list = await readLedger(user);
    if (what === "entries" && id) {
      const e = list.find((x) => x.id === id);
      return e ? Response.json({ entry: row(e) }) : Response.json({ error: `no entry ${id}` }, { status: 404 });
    }
    if (what === "entries") { const entries = filterLedger(list, q).map(row); return Response.json({ entries, count: entries.length, of: list.length }); }
    if (what === "accounts") return Response.json({ accounts: accounts(filterLedger(list, { from: q.from, to: q.to })) });
    if (what === "totals") return Response.json({ totals: totals(filterLedger(list, { ...q, limit: undefined }), url.searchParams.get("by") ?? undefined) });
    if (what === "paydays") return Response.json(paydaysView(list, await readPaySchedule(user), todayOf(url)));
    if (what === "statement") return Response.json(statementView(list, url.searchParams.get("kind"), url.searchParams.get("date"), todayOf(url)));
    if (what === "export") {
      const entries = filterLedger(list, { ...q, limit: undefined });
      if ((url.searchParams.get("format") ?? "csv") === "json") return Response.json({ entries: entries.map(row), count: entries.length });
      return new Response(toCsv(entries), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="expenses-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    return Response.json({ error: "unknown endpoint", endpoints: ["entries", "entries/<id>", "accounts", "totals", "paydays", "statement", "settings", "export", "me"] }, { status: 404 });
  } catch (e) { return fail(e); }
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  return withCors(request, await handlePOST(request, ctx));
}

async function handlePOST(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const user = apiUser(request);
    const [what, id] = (await ctx.params).path ?? [];
    if (what === "paydays" && !id) {
      const list = await readLedger(user);
      const added = fillPaydays(list, await readPaySchedule(user), todayOf(new URL(request.url)));
      if (added.length) await writeLedger(user, [...list, ...added]);
      return Response.json({ added: added.length, entries: added.map(row) });
    }
    if (what !== "entries" || id) return Response.json({ error: "POST /api/expenses/v1/entries or /paydays" }, { status: 404 });
    const entry = newEntry(await body(request));
    const list = await readLedger(user);
    await writeLedger(user, [...list, entry]);
    return Response.json({ entry: row(entry) }, { status: 201 });
  } catch (e) { return fail(e); }
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  return withCors(request, await handlePATCH(request, ctx));
}

async function handlePATCH(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const user = apiUser(request);
    const [what, id] = (await ctx.params).path ?? [];
    if (what === "settings" && !id) return Response.json(await patchSettings(user, (await body(request)) as Record<string, unknown>));
    if (what !== "entries" || !id) return Response.json({ error: "PATCH /api/expenses/v1/entries/<id> or /settings" }, { status: 404 });
    const input = await body(request);
    const list = await readLedger(user);
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return Response.json({ error: `no entry ${id}` }, { status: 404 });
    const next = [...list];
    next[i] = editEntry(list[i]!, input);
    await writeLedger(user, next);
    return Response.json({ entry: row(next[i]!) });
  } catch (e) { return fail(e); }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

/**
 * @file `/api/expenses` — the expense ledger, server-backed.
 *
 *   GET  /api/expenses   → { expenses: Expense[] }
 *   POST /api/expenses   → { ok: true }; body { expenses: Expense[] }
 *
 * The store is the studio's kv primitive (`data/axf/kv/local/expenses.json`),
 * the same channel the saved-theme shelf and the chrome-assets doc use — one
 * store, one transport, nothing new to operate. **Node-only.**
 *
 * This is deliberately thinner than GizmoX's `/api/expenses`, which also drove
 * a Data Grid → expenses conversion and a Claude-vision receipt parse. Neither
 * backend exists in AmberX (the Data Grid module and the claude subsystem were
 * both stripped), and shipping a route that answers `importDatagrid` with a
 * 500 would be a dead endpoint. The ledger is authored in the module instead —
 * manual entry with arithmetic amount fields — so the route only reads and
 * writes the list.
 */
import { axfKv, kvUser } from "../../../src/server/axfKv";

export const dynamic = "force-dynamic";

const NS = "expenses";

/** A preferences/ledger store, not a blob store. Generous but bounded. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  const doc = await axfKv.read(kvUser(request), NS);
  const expenses = Array.isArray((doc as { expenses?: unknown } | null)?.expenses)
    ? (doc as { expenses: unknown[] }).expenses
    : [];
  return Response.json({ expenses });
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "document too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const { expenses, known, replace } = body as { expenses?: unknown; known?: unknown; replace?: unknown };
  if (!Array.isArray(expenses)) {
    return Response.json({ error: "body.expenses must be an array" }, { status: 400 });
  }
  const user = kvUser(request);
  // Merge by entry id (build app-voice-commands): a tab sends the ids it has seen (`known`), and every entry the
  // server holds that the tab never saw (added by the ledger API, the CLI, MCP or a voice command since the tab last
  // synced) is kept, not overwritten. Ids the tab knew and dropped are deletes. `replace: true` (Load a snapshot)
  // and a body without `known` (older clients) replace the whole list as before.
  if (Array.isArray(known) && replace !== true) {
    const seen = new Set(known.filter((k): k is string => typeof k === "string"));
    const posted = new Set(expenses.map((e) => (e as { id?: unknown })?.id).filter((v): v is string => typeof v === "string"));
    const current = await axfKv.read(user, NS);
    const held = Array.isArray((current as { expenses?: unknown } | null)?.expenses) ? ((current as { expenses: unknown[] }).expenses) : [];
    const added = held.filter((e) => { const id = (e as { id?: unknown })?.id; return typeof id === "string" && !seen.has(id) && !posted.has(id); });
    const merged = [...expenses, ...added];
    await axfKv.write(user, NS, { expenses: merged });
    return Response.json({ ok: true, added: added.length, expenses: added.length ? merged : undefined });
  }
  await axfKv.write(user, NS, { expenses });
  return Response.json({ ok: true });
}

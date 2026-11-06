/**
 * Token log (token-turn@1; build token-optimize, Brett, Nov 6 2026): one record per Claude API turn, from any session.
 * Real counts come from stream-json and Claude Code transcripts (both carry the same assistant events); chat and voice
 * sessions have no counts, so theirs are worked out from their text and marked `estimated`.
 *
 * Everything here is plain code on the VPS: reading usage costs zero tokens. Pure: pricing, clock and output are
 * injected. Store, watcher and CLI: framework/cli/token-log.mjs. Spec: _claude/memory/docs/token-log.md.
 */
export const FRAME = 'token-turn@1';
export const SOURCES = ['headless', 'vps', 'chat', 'voice', 'note'];
export const MAX_FILES = 24;

/** Files whose reading is the cost lean launches exist to avoid: the CLAUDE.md chain, rules, the threads log, status. */
const RULES_FILE = /(^|[\s/'"`=])(CLAUDE(\.local)?\.md|_claude\/(shared\/)?rules\/[\w.-]+|\.claude\/rules\/[\w.-]+|_claude\/THREADS\.md|_claude\/persona\.md|_claude\/memory\/STATUS\.md)(?=$|[\s'"`;|&)])/;
export const isRulesFile = (p) => RULES_FILE.test(String(p ?? ''));
const FILE_IN_CMD = /(?:^|[\s'"`=])((?:~|\.{0,2}\/|[\w.-]+\/)?[\w./-]*(?:CLAUDE(?:\.local)?\.md|rules\/[\w.-]+\.md|THREADS\.md|persona\.md|STATUS\.md))/g;
const READS = /^\s*(?:sudo\s+)?(?:cat|head|tail|sed|awk|less|more|bat|grep|rg|wc|nl)\b/;
/** Rules files a shell command reads: only commands that read (a heredoc or an echo that names one isn't a read). */
function readsInCommand(cmd) {
  const out = [];
  const body = String(cmd ?? '').replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, '');
  for (const part of body.split(/\n|&&|\|\||;|\|/)) if (READS.test(part)) for (const m of part.matchAll(FILE_IN_CMD)) out.push(m[1]);
  return out;
}

/** What one assistant message read: [{file, rules}] from Read / Grep calls and rules files a Bash command touches. */
export function filesOf(content) {
  const out = []; const tools = [];
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type !== 'tool_use') continue;
    tools.push(String(b.name ?? ''));
    const i = b.input ?? {};
    if (b.name === 'Read' || b.name === 'NotebookRead') out.push(String(i.file_path ?? i.notebook_path ?? ''));
    else if (b.name === 'Grep' && i.path) out.push(String(i.path));
    else if (b.name === 'Bash') out.push(...readsInCommand(i.command));
  }
  return { files: [...new Set(out.filter(Boolean))], tools };
}

const usageOf = (u) => ({ input: Number(u?.input_tokens) || 0, output: Number(u?.output_tokens) || 0, cacheRead: Number(u?.cache_read_input_tokens) || 0, cacheWrite: Number(u?.cache_creation_input_tokens) || 0 });
export const totalTokens = (r) => (r.input || 0) + (r.output || 0) + (r.cacheRead || 0) + (r.cacheWrite || 0);

/**
 * Turns from a stream of Claude Code events. `add(ev)` takes each stream-json / transcript line; a message arrives on
 * several lines with one id (its last usage wins), so a turn is emitted when the next one starts, on a result, or at
 * `end()`. `ctx`: { source, session, name, agent, account, model, build, branch, step() }.
 */
export function createTurnLog({ ctx = {}, cost = () => null, emit = () => {}, now = () => Date.now() } = {}) {
  let cur = null; let turn = 0; let claude = '';
  const flush = () => {
    if (!cur) return;
    const c = cur; cur = null;
    if (!(c.input || c.output || c.cacheRead || c.cacheWrite)) return;
    turn += 1;
    const files = c.files.slice(0, MAX_FILES);
    emit({
      $axf: FRAME, id: `${c.claude || ctx.session || 'run'}:${c.id}`, at: c.at, source: ctx.source || 'headless', estimated: false,
      session: ctx.session || c.claude || '', claudeSession: c.claude, name: ctx.name || '', agent: ctx.agent || '', account: ctx.account || '',
      model: c.model || ctx.model || '', build: ctx.build || '', step: typeof ctx.step === 'function' ? ctx.step() : ctx.step || '', branch: c.branch || ctx.branch || '', turn,
      input: c.input, output: c.output, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite, costUsd: cost(c.model || ctx.model || '', c),
      files, rulesReads: files.filter(isRulesFile), tools: c.tools.slice(0, 40),
    });
  };
  return {
    add(ev) {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'system' && ev.session_id) { claude = ev.session_id; return; }
      if (ev.type === 'result') { flush(); return; }
      if (ev.type !== 'assistant' || !ev.message?.usage) return;
      const m = ev.message;
      if (m.model === '<synthetic>') return;
      const id = m.id ?? ev.uuid ?? `anon-${now()}`;
      if (cur && cur.id !== id) flush();
      const at = ev.timestamp && Number.isFinite(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toISOString() : new Date(now()).toISOString();
      if (!cur) cur = { id, at, claude: ev.session_id ?? ev.sessionId ?? claude, branch: ev.gitBranch ?? '', model: m.model ?? '', files: [], tools: [], ...usageOf(m.usage) };
      else Object.assign(cur, usageOf(m.usage));
      const f = filesOf(m.content);
      cur.files = [...new Set([...cur.files, ...f.files])];
      cur.tools.push(...f.tools);
    },
    end: flush,
  };
}

/* ------------------------------------------------------------------ chat and voice: estimates */

export const tokensOfText = (s) => Math.ceil(String(s ?? '').length / 4);

/** Estimated turns of one session@1 chat: history counts as cached input, the new message as input, the reply as output. */
export function chatTurns(chat, { cost = () => null, model = 'opus', from = 0 } = {}) {
  const out = []; let history = 0; let pending = 0; let n = 0;
  const source = String(chat?.source ?? '').includes('voice') ? 'voice' : 'chat';
  for (const m of Array.isArray(chat?.messages) ? chat.messages : []) {
    const t = tokensOfText(m.text);
    if (m.role !== 'assistant') { pending += t; continue; }
    n += 1;
    if (n > from) {
      const u = { input: pending, output: t, cacheRead: history, cacheWrite: 0 };
      out.push({ $axf: FRAME, id: `chat:${chat.uuid}:${n}`, at: m.at || chat.updatedAt || '', source, estimated: true, session: chat.title || chat.uuid, claudeSession: chat.uuid, name: chat.title || '', agent: '', account: 'claude.ai', model, build: '', step: '', branch: '', turn: n, ...u, costUsd: cost(model, u), files: [], rulesReads: [], tools: [] });
    }
    history += pending + t; pending = 0;
  }
  return out;
}

/** Estimated records of one mirror feed: each note or console call is a turn counted from its text. */
export function feedTurns(feed, { cost = () => null, model = 'opus', after = 0 } = {}) {
  const out = [];
  const source = String(feed?.source ?? '').includes('voice') ? 'voice' : 'note';
  for (const it of Array.isArray(feed?.items) ? feed.items : []) {
    if (!(it.at > after)) continue;
    const u = { input: 0, output: tokensOfText(it.text), cacheRead: 0, cacheWrite: 0 };
    out.push({ $axf: FRAME, id: `feed:${feed.id}:${it.at}`, at: new Date(it.at).toISOString(), source, estimated: true, session: feed.session || feed.id, claudeSession: '', name: feed.title || '', agent: feed.agent || '', account: 'claude.ai', model: feed.model || model, build: '', step: '', branch: '', turn: 0, ...u, costUsd: cost(feed.model || model, u), files: [], rulesReads: [], tools: it.tool ? [it.tool] : [] });
  }
  return out;
}

/* ------------------------------------------------------------------ reading */

const day = (r) => String(r.at ?? '').slice(0, 10);
/** The filters a query takes: exact match on these fields (`estimated` = 'yes' | 'no'), `from` / `to` = YYYY-MM-DD. */
export const FILTERS = ['session', 'account', 'build', 'model', 'agent', 'source'];
export function matches(r, f = {}) {
  if (f.from && day(r) < f.from) return false;
  if (f.to && day(r) > f.to) return false;
  for (const k of FILTERS) if (f[k] && String(r[k] ?? '') !== f[k]) return false;
  if (f.estimated === 'yes' && !r.estimated) return false;
  if (f.estimated === 'no' && r.estimated) return false;
  if (f.rules === 'yes' && !r.rulesReads?.length) return false;
  return true;
}

const blank = (key) => ({ key, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, costUsd: 0, rulesReads: 0, estimated: 0 });
function bump(row, r) {
  row.turns += 1; row.input += r.input || 0; row.output += r.output || 0; row.cacheRead += r.cacheRead || 0; row.cacheWrite += r.cacheWrite || 0;
  row.tokens += totalTokens(r); row.costUsd += Number(r.costUsd) || 0; row.rulesReads += r.rulesReads?.length || 0; if (r.estimated) row.estimated += 1;
}
const fix = (row) => ({ ...row, costUsd: Math.round(row.costUsd * 10000) / 10000 });
const modelName = (m) => { const s = String(m).toLowerCase(); return ['fable', 'opus', 'sonnet', 'haiku'].find((k) => s.includes(k)) ?? (m || 'unknown'); };

/** Totals, group-bys, the biggest eaters and the options for the filters. Records are de-duplicated by id (the live headless record wins). */
export function summarize(records, f = {}, { limit = 200, top = 10 } = {}) {
  const byId = new Map(); for (const r of records) if (r.source === 'headless' || !byId.has(r.id)) byId.set(r.id, r); // a live record has the build tags a transcript lacks
  const all = [...byId.values()];
  const rows = all.filter((r) => matches(r, f)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const totals = blank('all'); const groups = { day: new Map(), session: new Map(), account: new Map(), build: new Map(), model: new Map() };
  const keyOf = { day, session: (r) => r.session || r.name || 'unknown', account: (r) => r.account || 'unknown', build: (r) => r.build || 'no build', model: (r) => modelName(r.model) };
  for (const r of rows) {
    bump(totals, r);
    for (const [g, m] of Object.entries(groups)) { const k = keyOf[g](r); if (!m.has(k)) m.set(k, blank(k)); bump(m.get(k), r); }
  }
  const listed = (m) => [...m.values()].map(fix).sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
  const options = {}; for (const k of FILTERS) options[k] = [...new Set(all.map((r) => String(r[k] ?? '')).filter(Boolean))].sort().slice(0, 300);
  const turns = [...rows].sort((a, b) => (Number(b.costUsd) || 0) - (Number(a.costUsd) || 0) || totalTokens(b) - totalTokens(a)).slice(0, top);
  return {
    totals: fix(totals),
    byDay: listed(groups.day).sort((a, b) => a.key.localeCompare(b.key)),
    bySession: listed(groups.session), byAccount: listed(groups.account), byBuild: listed(groups.build), byModel: listed(groups.model),
    top: { sessions: listed(groups.session).slice(0, top), builds: listed(groups.build).filter((b) => b.key !== 'no build').slice(0, top), turns },
    rows: rows.slice(0, limit), count: rows.length, options,
  };
}

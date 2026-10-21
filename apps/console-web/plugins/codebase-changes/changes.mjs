#!/usr/bin/env node
/**
 * changes.mjs — the Codebase changes log (change-log@1): one entry per request to build, edit, remove or fix something.
 *
 *   node changes.mjs open "<title>" [--kind build|edit|remove|fix|other] [--asked "what was asked"] [--repo owner/name]…
 *                         [--model opus] [--step "first step"]… [--json]                → prints the new id
 *                         build stats (Build manager): [--ref pending:<id>|queue:<epic>|plan:<feature>] [--estimate-min N]
 *                         [--estimate-cost USD (default: minutes × the model's price heuristic)] [--areas "path/a,path/b"]
 *                         [--branch b] [--surface s] [--parent <change id>] [--status queued|running]
 *   node changes.mjs update <id|last> [the build-stat flags above] [--doing "…"] [--progress 0..1]
 *   node changes.mjs beat <id|last> [--doing "…"]          heartbeat: still working (the hooks do this by themselves)
 *   node changes.mjs step <id|last> "<text>" [--state queued|running|done|failed|skipped] [--index n] [--note "…"]
 *   node changes.mjs result <id|last> --state done|failed|partial|cancelled --summary "…" [--branch b] [--commit sha]…
 *                         [--files N] [--test "name=before→after" | "name=pass"]… [--link report=path|https://…]…
 *                         [--minutes N] [--cost USD] [--input-tokens N] [--output-tokens N] [--cache-read-tokens N]
 *                         (actual numbers; the Stop/SessionEnd hooks fill them from the Claude Code transcript)
 *   node changes.mjs close <id|last> | reopen <id|last>        (close = gone from the banner on every device)
 *   node changes.mjs list [--open] [--kind k] [--q text] [--limit n] [--json]     show <id|last> [--json]
 *   node changes.mjs where | flush | validate (entry JSON on stdin)
 *   node changes.mjs hook                                     Claude Code hook (reads the hook's JSON on stdin)
 *   node changes.mjs hooks install|remove|status [--settings <file>]   (default ~/.claude/settings.json)
 *
 * Where entries go (first that works):
 *   1. AXF_CHANGES_DIR (an exact folder), or --dir <folder>
 *   2. the shared data folder (framework/cli/persist.mjs: /projects/amberx-axf/_data where the hub's volume is mounted,
 *      i.e. the Dev Console container) → <that>/changes/<YYYY>/<MM>/<id>.json  — the main copy, on axHub
 *   3. axHub over MCP from any machine, when the hub token is here (AXHUB_TOKEN or ~/.config/axhub/token, the same one
 *      `claude-sync login` saves; AXHUB_URL, default https://axhub.amberxai.com/mcp): axhub.memory_write, project
 *      amberx-axf, area data, path changes/<YYYY>/<MM>/<id>.json — the same file as 2 (AXF_CHANGES_HUB=off skips it)
 *   4. the console API, when AXF_TOKEN is set (AXF_CONSOLE_URL, default https://console.amberxai.com; https only, no
 *      redirects, the token is never printed)
 *   5. --to-repo (or AXF_CHANGES_REPO=1): this clone's changes/ folder (in the root manifest's data.shared, so claude-sync
 *      carries it to the hub; commit it)
 *   6. otherwise a local queue (~/.axf-changes/queue, 0700), sent on by the next command that can reach 1–4 (or `flush`)
 * `last` = the entry most recently opened on this machine (the hook opens one per request and says its id).
 *
 * The hook never blocks Claude Code: it always exits 0, quickly. Prompts are cut short and anything that looks like a
 * token or password is hidden before it's written.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify, DirStore, ID_RE, newId, normalize, nowIso, redact, relPath, summary, titleFrom, upsertStep, normRunner, RESULT_STATES, STEP_STATES, BUILD_STATUSES } from './changes-core.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const HERE = dirname(SCRIPT);
const REPO = resolve(HERE, '../../../..');
const MARK = /changes\.mjs"? hook$/;
const DEFAULT_CONSOLE = 'https://console.amberxai.com';
const DEFAULT_HUB = 'https://axhub.amberxai.com/mcp';

export const homeDir = (env = process.env) => env.AXF_CHANGES_HOME || join(homedir(), '.axf-changes');
const queueDir = () => join(homeDir(), 'queue');

/* ---------------- backends ---------------- */

/** Nearest existing folder at or above `p` has the setgid bit → a group-shared tree (the hub's /projects). */
function sharedTree(p) {
  let d = resolve(p);
  for (;;) {
    try { return (statSync(d).mode & 0o2000) !== 0; } catch { /* not there */ }
    const up = dirname(d);
    if (up === d) return false;
    d = up;
  }
}
async function persistChangesDir() {
  try {
    const { persistRoot } = await import(join(REPO, 'framework/cli/persist.mjs'));
    const root = persistRoot();
    return root ? join(root, 'changes') : null;
  } catch { return null; }
}
function dirBackend(root, label) {
  const s = new DirStore(root, { shared: sharedTree(root) });
  return {
    label, root,
    async get(id) { return s.get(id); },
    async put(e) { return s.put(e); },
    async list() { return s.all(); },
  };
}
const BUILD_PATCH = ['buildRef', 'surface', 'startedAt', 'finishedAt', 'lastSeenAt', 'estimate', 'actual', 'costEstimated', 'branch', 'areas', 'parent', 'progress', 'verify', 'doing', 'runner'];
function apiBackend(base, token) {
  const u0 = new URL(base);
  if (u0.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u0.hostname)) throw new Error('the console address must be https');
  const call = async (method, path, body) => {
    const r = await fetch(new URL(`/api/plugins/codebase-changes/${path}`, u0), {
      method, redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && method === 'GET' && path.startsWith('entries/')) return null;
    if (!r.ok) { const e = new Error(`console answered ${r.status}${typeof j.detail === 'string' ? `: ${j.detail}` : ''}`); e.status = r.status; throw e; }
    return j;
  };
  return {
    label: `console API (${u0.origin})`, api: true,
    async get(id) { return call('GET', `entries/${id}`); },
    async put(e, { create } = {}) {
      if (create) return call('POST', 'entries', e);
      const cur = await call('GET', `entries/${e.id}`);
      if (!cur) return call('POST', 'entries', e);
      const build = Object.fromEntries(BUILD_PATCH.filter((k) => e[k] != null).map((k) => [k, e[k]]));
      const out = await call('PATCH', `entries/${e.id}`, { title: e.title, kind: e.kind, asked: e.asked, repos: e.repos, model: e.model, steps: e.steps, result: e.result, ...build });
      if (!!e.closed !== !!cur.closed) return call('POST', `entries/${e.id}/${e.closed ? 'close' : 'reopen'}`, { by: e.closed?.by });
      return out;
    },
    async list(q = {}) {
      const p = new URLSearchParams({ limit: '200', ...Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '')) });
      return (await call('GET', `entries?${p}`)).items;
    },
  };
}

/* axHub over MCP (the same `call` → axhub.memory_* tools claude-sync uses): project amberx-axf, area data,
 * path changes/<YYYY>/<MM>/<id>.json. Works from any machine with the hub token (AXHUB_TOKEN or ~/.config/axhub/token). */
export function hubToken(env = process.env) {
  if (env.AXHUB_TOKEN) return env.AXHUB_TOKEN.trim();
  for (const f of [join(homedir(), '.config', 'axhub', 'token')]) { try { const t = readFileSync(f, 'utf8').trim(); if (t) return t; } catch { /* next */ } }
  return '';
}
export function hubBackend(url, token, fetchImpl = fetch) {
  const u0 = new URL(url);
  if (u0.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u0.hostname)) throw new Error('the axHub address must be https');
  let sid = '', seq = 1, ready = null;
  const rpc = async (body) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-06-18', ...(sid ? { 'mcp-session-id': sid } : {}) };
    const r = await fetchImpl(u0.href, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!r.ok && r.status !== 202) { const e = new Error(`axHub answered ${r.status}`); e.status = r.status >= 500 ? r.status : 599; throw e; }
    sid = r.headers.get('mcp-session-id') || sid;
    if (body.id === undefined) return null;
    const text = await r.text();
    const msgs = (r.headers.get('content-type') || '').includes('text/event-stream')
      ? text.split(/\r?\n\r?\n/).map((c) => c.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')).filter(Boolean).map((d) => JSON.parse(d))
      : [JSON.parse(text)];
    const reply = msgs.find((m) => m.id === body.id);
    if (!reply || reply.error) throw Object.assign(new Error(`axHub: ${reply?.error?.message ?? 'no reply'}`), { status: 599 });
    return reply.result;
  };
  const open = () => (ready ??= (async () => {
    await rpc({ jsonrpc: '2.0', id: seq++, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'axf-changes', version: '2' } } });
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  })());
  const call = async (tool, args) => {
    await open();
    const r = await rpc({ jsonrpc: '2.0', id: seq++, method: 'tools/call', params: { name: 'call', arguments: { tool, arguments: args } } });
    const text = (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (r?.isError) throw Object.assign(new Error(text.slice(0, 300)), { hub: true });
    return text;
  };
  const at = (id) => ({ project: 'amberx-axf', area: 'data', path: `changes/${relPathOf(id)}` });
  return {
    label: `axHub (${u0.origin})`, hub: true,
    async get(id) { try { return JSON.parse(await call('axhub.memory_read', at(id))); } catch (e) { if (e.hub) return null; throw e; } },
    async put(e) {
      const { entry, errors } = normalize(e);
      if (!entry) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
      await call('axhub.memory_write', { ...at(entry.id), content: `${JSON.stringify(entry, null, 2)}\n` });
      return entry;
    },
    async list() {
      const j = JSON.parse(await call('axhub.memory_list', { project: 'amberx-axf', area: 'data' }));
      const files = (j.files ?? []).map((f) => f.path).filter((p) => /^changes\/\d{4}\/\d{2}\/chg-[^/]+\.json$/.test(p)).sort().reverse().slice(0, 60);
      const out = [];
      for (const p of files) { const id = p.split('/').pop().slice(0, -5); const e = await this.get(id); if (e?.id) out.push(e); }
      return out;
    },
  };
}
const relPathOf = (id) => relPath(id).split(/[\\/]/).join('/');

/** The backend this run writes to (see the header). */
export async function pickBackend(flags = {}, env = process.env) {
  if (flags.dir || env.AXF_CHANGES_DIR) return dirBackend(resolve(String(flags.dir || env.AXF_CHANGES_DIR)), 'folder');
  const shared = await persistChangesDir();
  if (shared) return dirBackend(shared, 'shared data folder (axHub)');
  const ht = env.AXF_CHANGES_HUB === 'off' ? '' : hubToken(env);
  if (ht) return hubBackend(env.AXHUB_URL || DEFAULT_HUB, ht);
  if (env.AXF_TOKEN) return apiBackend(env.AXF_CONSOLE_URL || DEFAULT_CONSOLE, env.AXF_TOKEN);
  if (flags['to-repo'] === true || env.AXF_CHANGES_REPO === '1') return dirBackend(join(REPO, 'changes'), 'this clone\'s changes/ folder (commit it)');
  return { ...dirBackend(queueDir(), 'local queue (sent on later)'), queue: true };
}
const queue = () => ({ ...dirBackend(queueDir(), 'local queue (sent on later)'), queue: true });

/** Write, falling back to the queue when the chosen place can't be reached (the console is down, …). */
async function save(b, entry, opts) {
  try { return { entry: await b.put(entry, opts), where: b.label }; } catch (e) {
    if (b.queue || (e.status && e.status < 500 && e.status !== 404)) throw e;
    mkdirSync(homeDir(), { recursive: true, mode: 0o700 });
    return { entry: await queue().put(entry), where: `local queue (${b.label} failed: ${e.message})`, queued: true };
  }
}
async function load(b, id) {
  const q = queue();
  const queued = await q.get(id);
  if (queued) return queued;
  try { return await b.get(id); } catch { return null; }
}

/** Send everything in the queue to `b` (create or update), then drop it from the queue. */
export async function flush(b) {
  if (b.queue || !existsSync(queueDir())) return { sent: 0, left: 0 };
  const q = new DirStore(queueDir());
  let sent = 0, left = 0;
  for (const e of q.all()) {
    try { await b.put(e); rmSync(q.pathOf(e.id), { force: true }); sent++; } catch { left++; }
  }
  return { sent, left };
}

/* ---------------- this machine's pointers (last entry, entries per Claude Code session) ---------------- */

function writePrivate(p, text) {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, p);
}
const lastFile = () => join(homeDir(), 'last');
export function setLast(id) { writePrivate(lastFile(), id); }
export function resolveId(arg) {
  const id = arg === 'last' || arg == null ? (() => { try { return readFileSync(lastFile(), 'utf8').trim(); } catch { return ''; } })() : String(arg);
  if (!ID_RE.test(id)) throw new Error(arg === 'last' || arg == null ? 'no entry opened on this machine yet (open one first)' : `"${arg}" is not a change id`);
  return id;
}
const sid12 = (s) => String(s ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 36);
const sessionFile = (sid) => join(homeDir(), 'sessions', `${sid}.json`);
function sessionIds(sid) { try { const j = JSON.parse(readFileSync(sessionFile(sid), 'utf8')); return Array.isArray(j.ids) ? j.ids.filter((x) => ID_RE.test(x)) : []; } catch { return []; } }
function addSessionId(sid, id) {
  let beat = 0; try { beat = Number(JSON.parse(readFileSync(sessionFile(sid), 'utf8')).beat) || 0; } catch { /* new */ }
  const ids = [...new Set([...sessionIds(sid), id])].slice(-50); writePrivate(sessionFile(sid), JSON.stringify({ ids, beat }));
}

/* ---------------- context ---------------- */

export function detectRepo(cwd) {
  try {
    const r = spawnSync('git', ['-C', cwd || '.', 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 1500 });
    const m = (r.stdout || '').trim().match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}
export function detectWhere(env = process.env) {
  if (env.AXF_WHERE) return redact(env.AXF_WHERE, 40);
  if (env.CLAUDE_CODE_REMOTE === 'true' || env.CLAUDE_CODE_REMOTE === '1') return 'cloud';
  if (existsSync('/data/coolify') || existsSync('/opt/axf')) return 'vps';
  return 'local';
}

/** Where this run happens, for the Build manager: AXF_SURFACE wins (console launches set console-launch). */
export function detectSurface(env = process.env) {
  if (env.AXF_SURFACE && /^[a-z][a-z0-9-]{0,31}$/.test(env.AXF_SURFACE)) return env.AXF_SURFACE;
  const w = detectWhere(env);
  return w === 'vps' ? 'vps-claude-code' : w === 'cloud' ? 'claude-code-cloud' : 'claude-code';
}

/**
 * What this session runs in, so the Build manager banner can open it (runner, Oct 21 2026). Explicit env wins:
 * AXF_RUNNER_URL (https, claude.ai/…), AXF_RUNNER_TMUX (a tmux session on the VPS, e.g. set by a launcher that runs
 * `docker exec … claude` from tmux, where $TMUX doesn't reach the container), AXF_RUNNER_LABEL, AXF_RUNNER_APP.
 * Otherwise: Claude Code on the web (session link), a console terminal tab (AXF_TERM_SESSION), tmux ($TMUX, name asked
 * from tmux), an IDE, a plain SSH/Moshi or local terminal. `tmuxName` is injectable for tests. Checked by normRunner.
 */
export function detectRunner(env = process.env, tmuxName = currentTmuxName, host = hostname()) {
  const ok = (r) => normRunner(r) ?? null;
  const app = env.AXF_RUNNER_APP && /^[a-z][a-z0-9-]{0,23}$/.test(env.AXF_RUNNER_APP) ? env.AXF_RUNNER_APP : undefined;
  const label = env.AXF_RUNNER_LABEL || undefined;
  if (env.AXF_RUNNER_URL) { const r = ok({ kind: 'link', url: env.AXF_RUNNER_URL, label: label ?? 'Session', app }); if (r?.url) return r; }
  if (env.AXF_RUNNER_TMUX) { const r = ok({ kind: 'tmux', tmux: { session: env.AXF_RUNNER_TMUX }, label: label ?? `tmux ${env.AXF_RUNNER_TMUX}`, app, host: env.AXF_RUNNER_HOST || undefined }); if (r?.tmux) return r; }
  const cse = String(env.CLAUDE_CODE_REMOTE_SESSION_ID ?? '');
  if ((env.CLAUDE_CODE_REMOTE === 'true' || env.CLAUDE_CODE_REMOTE === '1') && /^cse_[A-Za-z0-9]{6,64}$/.test(cse)) {
    const fromChat = env.CLAUDE_CODE_SESSION_ORIGIN === 'claude_ai_chat';
    return ok({ kind: 'claude-web', url: `https://claude.ai/code/session_${cse.slice(4)}`, label: label ?? (fromChat ? 'claude.ai' : 'Claude Code on the web'), app });
  }
  if (env.AXF_TERM_SESSION) { const r = ok({ kind: 'console-tab', terminal: env.AXF_TERM_SESSION, label: label ?? 'Console terminal', host, app }); if (r?.terminal) return r; }
  if (env.TMUX) {
    const name = tmuxName(env);
    const via = env.SSH_CONNECTION || env.SSH_CLIENT ? 'SSH/Moshi · ' : '';
    if (name) { const r = ok({ kind: 'tmux', tmux: { session: name }, label: label ?? `${via}tmux ${name}`, host, app }); if (r?.tmux) return r; }
  }
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return ok({ kind: 'ide', label: label ?? 'VS Code', host, app });
  if (/sdk|headless|github-action/i.test(String(env.CLAUDE_CODE_ENTRYPOINT ?? ''))) return ok({ kind: 'headless', label: label ?? 'Headless run', host, app });
  if (env.SSH_CONNECTION || env.SSH_CLIENT) return ok({ kind: 'terminal', label: label ?? 'SSH/Moshi terminal', host, app });
  return ok({ kind: 'terminal', label: label ?? 'Terminal', host, app });
}
function currentTmuxName() {
  try {
    const r = spawnSync('tmux', ['display-message', '-p', '#S'], { encoding: 'utf8', timeout: 800 });
    const n = (r.stdout || '').trim();
    return r.status === 0 && /^[A-Za-z0-9_.-]{1,64}$/.test(n) ? n : '';
  } catch { return ''; }
}

/* ---------------- cost (shared prices: framework/schemas/model-pricing.json) ---------------- */

let pricingMod = null;
export async function pricing() {
  if (pricingMod) return pricingMod;
  for (const p of [join(HERE, 'model-pricing.mjs'), join(REPO, 'framework/cli/model-pricing.mjs')]) {
    if (!existsSync(p)) continue;
    try { pricingMod = await import(pathToFileURL(p).href); break; } catch { /* next */ }
  }
  pricingMod ??= { modelKey: (m) => String(m ?? '').toLowerCase(), costUsd: () => null, estimateCost: () => null, transcriptUsage: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: '', messages: 0 }) };
  return pricingMod;
}

/** Actual tokens + cost of a Claude Code transcript since `since`, or null when there's nothing to count. */
export async function usageFrom(transcriptPath, since, fallbackModel = '') {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let text = '';
  try { const st = statSync(transcriptPath); if (st.size > 200 * 1024 * 1024) return null; text = readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const p = await pricing();
  const u = p.transcriptUsage(text, { since });
  if (!u.messages) return null;
  const model = u.model || fallbackModel;
  return { model, actual: { inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite, ...(p.costUsd(model, u) != null ? { costUsd: p.costUsd(model, u) } : {}), source: 'transcript' } };
}
const minutesBetween = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 60000) : undefined; };

/* ---------------- Claude Code hook ---------------- */

const cmd = (s) => `node "${SCRIPT}" ${s}`;
export function hookContext(id, kind) {
  return [
    `[Build manager / Codebase changes] Entry ${id} (${kind}) is open on axHub and shows live in the console's Build manager.`,
    'Before you start building, record what it is and your estimates (the build it belongs to, model, minutes, files/folders you will touch):',
    `  ${cmd(`update ${id} --ref pending:<id>|queue:<epic>|plan:<feature> --model <model> --estimate-min <minutes> [--estimate-cost <usd>] --areas "path/a,path/b" [--branch b]`)}`,
    'Break the work into steps and record them as you go (every update is shown live), then record the result when you finish:',
    `  ${cmd(`step ${id} "<what this step does>" --state running`)}   (then --state done | failed | skipped)`,
    `  ${cmd(`result ${id} --state done|failed|partial|cancelled --summary "<what changed>" [--branch b] [--commit sha]… [--files N] [--test "name=before→after"]… [--link report=<path or https URL>]`)}`,
    'Tokens and cost are filled in from this session by the hook when the turn ends. If this request is not actually a change (only a question), run: ' + cmd(`result ${id} --state cancelled --summary "no change: question only"`),
  ].join('\n');
}

/* per-session hook state (this machine): entry ids, last heartbeat, open subagent steps */
function sessionState(sid) { try { const j = JSON.parse(readFileSync(sessionFile(sid), 'utf8')); return { ids: Array.isArray(j.ids) ? j.ids.filter((x) => ID_RE.test(x)) : [], beat: Number(j.beat) || 0 }; } catch { return { ids: [], beat: 0 }; } }
function saveSessionState(sid, s) { writePrivate(sessionFile(sid), JSON.stringify({ ids: s.ids.slice(-50), beat: s.beat })); }
export const BEAT_MS = 30_000;

/** What a tool call is doing, in a few words (never the command's arguments: they can hold secrets). */
export function toolActivity(ev) {
  const t = String(ev.tool_name ?? '');
  const i = ev.tool_input && typeof ev.tool_input === 'object' ? ev.tool_input : {};
  const file = (p) => String(p ?? '').split('/').slice(-2).join('/');
  if (/^(Task|Agent)$/.test(t)) return `Subagent: ${redact(i.description ?? i.subagent_type ?? 'task', 80)}`;
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return `Editing ${redact(file(i.file_path ?? i.notebook_path), 80)}`;
  if (t === 'Read') return `Reading ${redact(file(i.file_path), 80)}`;
  if (t === 'Bash') return `Running: ${redact(String(i.description ?? '').slice(0, 80) || 'a command', 90)}`;
  if (/^(Grep|Glob)$/.test(t)) return 'Searching the code';
  return redact(t ? `Using ${t}` : 'Working', 60);
}

async function readStdin() {
  const chunks = [];
  let n = 0;
  for await (const c of process.stdin) { chunks.push(c); n += c.length; if (n > 2_000_000) break; }
  return Buffer.concat(chunks).toString('utf8');
}

/** Handle one hook event. Returns the text for Claude's context (UserPromptSubmit only) or ''. */
export async function onHook(ev, b) {
  const sid = sid12(ev.session_id);
  const now = nowIso();
  if (ev.hook_event_name === 'UserPromptSubmit') {
    // A session started for an existing entry (console "Start build now" sets AXF_ADOPT_CHANGE) reports on that entry.
    const adopt = process.env.AXF_ADOPT_CHANGE;
    if (adopt && ID_RE.test(adopt)) {
      const e0 = await load(b, adopt);
      if (e0 && !e0.result) {
        const steps = (e0.steps ?? []).map((s, i) => (i === 0 && s.state === 'running' ? { ...s, state: 'done', finishedAt: now } : i === 1 && s.state === 'queued' ? { ...s, state: 'running', startedAt: now } : s));
        await save(b, { ...e0, steps, status: 'running', lastSeenAt: now, doing: 'Started', who: { ...(e0.who ?? {}), session: sid.slice(0, 12), where: detectWhere(), host: hostname(), user: process.env.USER || '' }, runner: detectRunner() ?? e0.runner, updatedAt: now });
        setLast(adopt);
        if (sid) addSessionId(sid, adopt);
        return hookContext(adopt, e0.kind);
      }
    }
    const c = classify(ev.prompt);
    if (!c.change) return '';
    const id = newId(`${sid}\n${ev.prompt}`);
    let e = await load(b, id);
    if (!e) {
      const repo = detectRepo(ev.cwd);
      const u = await usageFrom(ev.transcript_path, now);
      const model = process.env.AXF_MODEL || process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || (await usageFrom(ev.transcript_path, 0))?.model || u?.model || '';
      ({ entry: e } = await save(b, {
        id, createdAt: now, updatedAt: now, kind: c.kind, title: titleFrom(ev.prompt), asked: redact(String(ev.prompt ?? '').replace(/\s+/g, ' '), 600),
        repos: repo ? [repo] : [], model: redact(model, 40),
        who: { session: sid.slice(0, 12), where: detectWhere(), user: process.env.USER || '', host: hostname() }, steps: [], result: null, closed: null,
        status: 'running', surface: detectSurface(), startedAt: now, lastSeenAt: now, doing: 'Starting', runner: detectRunner() ?? undefined,
        ...(process.env.AXF_PARENT_CHANGE && ID_RE.test(process.env.AXF_PARENT_CHANGE) ? { parent: process.env.AXF_PARENT_CHANGE } : {}),
      }, { create: true }));
    }
    setLast(id);
    if (sid) addSessionId(sid, id);
    return hookContext(id, e.kind);
  }
  if (!sid) return '';
  const ss = sessionState(sid);
  // Live progress: each tool call (throttled to one write per BEAT_MS) and every subagent start / stop.
  if (ev.hook_event_name === 'PreToolUse' || ev.hook_event_name === 'SubagentStop' || ev.hook_event_name === 'Notification') {
    const sub = ev.hook_event_name === 'PreToolUse' && /^(Task|Agent)$/.test(String(ev.tool_name ?? ''));
    const subEnd = ev.hook_event_name === 'SubagentStop';
    if (!sub && !subEnd && Date.now() - ss.beat < BEAT_MS) return '';
    const doing = ev.hook_event_name === 'Notification' ? 'Waiting for you' : subEnd ? 'Subagent finished' : toolActivity(ev);
    for (const id of ss.ids) {
      const e = await load(b, id);
      if (!e || e.result) continue;
      let steps = e.steps ?? [];
      if (sub) steps = upsertStep(steps, { text: redact(doing, 300), state: 'running', note: 'subagent' }, now);
      if (subEnd) { const k = steps.map((s) => s.note === 'subagent' && s.state === 'running').lastIndexOf(true); if (k >= 0) steps = upsertStep(steps, { index: k, state: 'done' }, now); }
      await save(b, { ...e, steps, doing, lastSeenAt: now, updatedAt: now });
    }
    saveSessionState(sid, { ...ss, beat: Date.now() });
    return '';
  }
  if (ev.hook_event_name !== 'Stop' && ev.hook_event_name !== 'SessionEnd') return '';
  const end = ev.hook_event_name === 'SessionEnd';
  for (const id of ss.ids) {
    const e = await load(b, id);
    if (!e || (e.result && e.finishedAt && e.actual?.source === 'transcript' && !end && Date.now() - Date.parse(e.finishedAt) > 6 * 3600_000)) continue;
    let changed = false;
    const steps = (e.steps ?? []).map((s) => {
      if (s.state === 'running' && (end || s.note !== 'subagent')) { changed = true; return { ...s, state: 'done', finishedAt: now, note: s.note ?? `auto: ${end ? 'the session ended' : 'the turn ended'}` }; }
      if (end && s.state === 'queued') { changed = true; return { ...s, state: 'skipped', finishedAt: now, note: s.note ?? 'auto: the session ended' }; }
      return s;
    });
    let result = e.result;
    if (end && !result) { result = { state: 'partial', summary: 'The session ended before a result was recorded.' }; changed = true; }
    const next = { ...e, steps, result, updatedAt: now };
    // Actual tokens and cost of this session since the entry opened (Claude Code reports usage in its transcript).
    const u = await usageFrom(ev.transcript_path, e.startedAt || e.createdAt, e.model);
    if (u && (e.actual?.source == null || e.actual.source === 'transcript')) {
      next.actual = { ...(e.actual ?? {}), ...u.actual };
      if (!e.model && u.model) next.model = redact(u.model, 40);
      next.costEstimated = next.actual.costUsd == null;
      changed = true;
    }
    if (!result) { next.lastSeenAt = now; next.doing = end ? 'Session ended' : 'Waiting for the next message'; changed = true; }
    if (result && !e.finishedAt) { next.finishedAt = now; changed = true; }
    const mins = minutesBetween(next.startedAt || next.createdAt, next.finishedAt || now);
    if (mins != null && next.actual?.source === 'transcript') next.actual.minutes = mins;
    if (changed) await save(b, next);
  }
  if (end) rmSync(sessionFile(sid), { force: true });
  return '';
}

/* ---------------- installing the hook ---------------- */

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'SubagentStop', 'Notification', 'Stop', 'SessionEnd'];
const isOurs = (e) => (e?.hooks ?? []).some((h) => typeof h?.command === 'string' && MARK.test(h.command));
function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
export function withoutOurHooks(s) {
  const out = structuredClone(s ?? {});
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue;
    out.hooks[ev] = out.hooks[ev].filter((e) => !isOurs(e));
    if (!out.hooks[ev].length) delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}
export function withOurHooks(s, script = SCRIPT) {
  const out = withoutOurHooks(s);
  out.hooks ??= {};
  for (const ev of HOOK_EVENTS) out.hooks[ev] = [...(out.hooks[ev] ?? []), { hooks: [{ type: 'command', command: `node "${script}" hook`, timeout: 10 }] }];
  return out;
}
export function hooksInstalled(file) { const s = readJson(file); return !!s?.hooks && Object.values(s.hooks).some((l) => Array.isArray(l) && l.some(isOurs)); }
function saveSettings(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}
export function installHooks(file, script = SCRIPT) {
  const cur = readJson(file);
  if (existsSync(file) && cur === null) throw new Error(`${file} isn't valid JSON; not touching it`);
  saveSettings(file, withOurHooks(cur ?? {}, script));
}
export function removeHooks(file) {
  if (!existsSync(file)) return false;
  const cur = readJson(file);
  if (cur === null || !hooksInstalled(file)) return false;
  saveSettings(file, withoutOurHooks(cur));
  return true;
}
export const claudeSettings = () => join(homedir(), '.claude', 'settings.json');

/* ---------------- CLI ---------------- */

const MULTI = new Set(['repo', 'step', 'commit', 'test', 'link']);
export function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2); const v = argv[i + 1];
    const val = v === undefined || v.startsWith('--') ? true : (i++, v);
    if (MULTI.has(k)) (flags[k] ??= []).push(val); else flags[k] = val;
  }
  return { pos, flags };
}
const str = (v) => (typeof v === 'string' ? v : undefined);

/** "name=12/12", "name=10→12", "name=10->12", "name=pass" → [name, {before?, after?, state?}] */
export function parseTest(s) {
  const at = String(s).indexOf('=');
  if (at < 1) throw new Error(`--test is name=value (got "${s}")`);
  const name = s.slice(0, at), v = s.slice(at + 1).trim();
  if (['pass', 'fail', 'skip'].includes(v)) return [name, { state: v }];
  const m = v.split(/\s*(?:→|->)\s*/);
  return [name, m.length === 2 ? { before: m[0], after: m[1] } : { after: v }];
}
function parseLink(s) {
  const at = String(s).indexOf('=');
  if (at < 1) throw new Error(`--link is name=url (got "${s}")`);
  return [s.slice(0, at), s.slice(at + 1)];
}

function line(x) {
  const s = x.steps && typeof x.steps === 'object' && !Array.isArray(x.steps) ? x.steps : summary(x).steps;
  return `${(x.closed ? 'closed ' : '') + x.state}`.padEnd(15) + ` ${x.id}  [${x.kind}] ${x.title}  (${s.done}/${s.total} steps)`;
}

/** `--ref pending:<id>` | `queue:<epic>` | `plan:<feature>` | a bare id (kind other) → buildRef. */
export function parseRef(v) {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const at = s.indexOf(':');
  return at > 0 && /^[a-z][a-z0-9-]{0,23}$/.test(s.slice(0, at)) ? { kind: s.slice(0, at), id: s.slice(at + 1) } : { kind: 'other', id: s };
}
const numFlag = (v, what) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`--${what} is a number`); return n; };

/**
 * Build stats from flags (open / update / result): --ref, --model, --estimate-min, --estimate-cost, --areas "a,b",
 * --branch, --surface, --parent, --status queued|running, --doing, --progress 0..1, and the actual numbers
 * --minutes, --cost, --input-tokens, --output-tokens, --cache-read-tokens, --cache-write-tokens.
 * Without --estimate-cost the cost is estimated from the minutes and the model's prices (model-pricing@1).
 */
export async function buildFlags(flags, e = {}) {
  const o = {};
  if (flags.ref !== undefined) o.buildRef = parseRef(flags.ref);
  if (str(flags.model)) o.model = flags.model;
  if (str(flags.surface)) o.surface = flags.surface;
  if (str(flags.parent)) o.parent = flags.parent;
  if (str(flags.doing)) o.doing = flags.doing;
  if (str(flags.status)) { if (!BUILD_STATUSES.includes(flags.status)) throw new Error(`--status is one of ${BUILD_STATUSES.join(', ')}`); o.status = flags.status; }
  if (flags.progress !== undefined) o.progress = numFlag(flags.progress, 'progress');
  if (str(flags.areas)) o.areas = [...new Set([...(e.areas ?? []), ...flags.areas.split(',').map((x) => x.trim()).filter(Boolean)])];
  const min = numFlag(flags['estimate-min'], 'estimate-min'), cost = numFlag(flags['estimate-cost'], 'estimate-cost');
  if (min !== undefined || cost !== undefined) {
    const p = await pricing();
    const model = o.model || e.model || '';
    const est = { ...(e.estimate ?? {}) };
    if (min !== undefined) est.minutes = min;
    if (cost !== undefined) est.costUsd = cost; else if (min !== undefined && p.estimateCost(model, min) != null) est.costUsd = p.estimateCost(model, min);
    o.estimate = est;
  }
  const act = { inputTokens: 'input-tokens', outputTokens: 'output-tokens', cacheReadTokens: 'cache-read-tokens', cacheWriteTokens: 'cache-write-tokens' };
  const actual = { ...(e.actual ?? {}) };
  let any = false;
  if (flags.minutes !== undefined) { actual.minutes = numFlag(flags.minutes, 'minutes'); any = true; }
  if (flags.cost !== undefined) { actual.costUsd = numFlag(flags.cost, 'cost'); any = true; }
  for (const [k, f] of Object.entries(act)) if (flags[f] !== undefined) { actual[k] = Math.round(numFlag(flags[f], f)); any = true; }
  if (any) {
    if (actual.costUsd == null && actual.inputTokens != null) {
      const p = await pricing(); const c = p.costUsd(o.model || e.model, { input: actual.inputTokens, output: actual.outputTokens, cacheRead: actual.cacheReadTokens, cacheWrite: actual.cacheWriteTokens });
      if (c != null) actual.costUsd = c;
    }
    actual.source = str(flags.source) || 'manual';
    o.actual = actual;
    o.costEstimated = actual.costUsd == null;
  }
  return o;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'hook') {
    try {
      const ev = JSON.parse(await readStdin());
      const b = await pickBackend();
      const text = await onHook(ev, b);
      if (text) process.stdout.write(`${text}\n`);
    } catch { /* never get in Claude Code's way */ }
    return;
  }
  const { pos, flags } = parse(rest);
  const out = (x) => console.log(flags.json ? JSON.stringify(x, null, 2) : typeof x === 'string' ? x : line(x));
  if (command === 'validate') {
    const r = normalize(JSON.parse(await readStdin()));
    return console.log(JSON.stringify({ ok: !!r.entry, errors: r.errors, entry: r.entry }));
  }
  if (command === 'hooks') {
    const file = str(flags.settings) || claudeSettings(); const sub = pos[0] ?? 'status';
    if (sub === 'install') { installHooks(file); return console.log(`Claude Code hooks added to ${file} (backup ${file}.bak). New requests to build, edit, remove or fix something now open a Codebase changes entry.`); }
    if (sub === 'remove') return console.log(removeHooks(file) ? `hooks removed from ${file}` : `no Codebase changes hooks in ${file}`);
    return console.log(hooksInstalled(file) ? `installed in ${file}` : `not installed in ${file}`);
  }
  const b = await pickBackend(flags);
  if (command !== 'where' && !b.queue) { const f = await flush(b); if (f.sent && !flags.json) console.error(`(sent ${f.sent} queued entr${f.sent === 1 ? 'y' : 'ies'} to the ${b.label})`); }
  const now = nowIso();
  const change = async (id, fn) => {
    const e = await load(b, id);
    if (!e) throw new Error(`no entry ${id} (${b.label})`);
    const r = await save(b, { ...(await fn(e)), updatedAt: now });
    if (r.queued && !flags.json) console.error(`(${r.where})`);
    return r.entry;
  };
  switch (command) {
    case 'where': {
      const q = existsSync(queueDir()) ? new DirStore(queueDir()).all().length : 0;
      return console.log(`${b.label}${b.root ? `: ${b.root}` : ''}${q && !b.queue ? `\n${q} entr${q === 1 ? 'y' : 'ies'} waiting in the local queue (${queueDir()}): run flush` : ''}`);
    }
    case 'flush': { const f = await flush(b); return console.log(b.queue ? 'nothing to send to: no shared folder, console token or --to-repo here' : `sent ${f.sent}, ${f.left} still queued`); }
    case 'open': {
      const title = pos.join(' ');
      if (!title) throw new Error('open "<title>" [--kind …] [--asked …]');
      const id = str(flags.id) || newId();
      if (!ID_RE.test(id)) throw new Error(`"${id}" is not a change id`);
      const repos = flags.repo?.filter((r) => typeof r === 'string') ?? (() => { const r = detectRepo(process.cwd()); return r ? [r] : []; })();
      const steps = (flags.step ?? []).filter((s) => typeof s === 'string').map((text) => ({ text, state: 'queued' }));
      const build = await buildFlags(flags);
      const r = await save(b, { id, createdAt: now, updatedAt: now, kind: str(flags.kind) || 'other', title, asked: str(flags.asked) || '', repos, model: str(flags.model) || process.env.AXF_MODEL || '',
        who: { session: str(flags.session) || '', where: detectWhere(), user: process.env.USER || '', host: hostname() }, steps, result: null, closed: null,
        surface: detectSurface(), startedAt: now, lastSeenAt: now, ...(str(flags.branch) ? { branch: flags.branch } : {}),
        ...(process.env.AXF_PARENT_CHANGE && ID_RE.test(process.env.AXF_PARENT_CHANGE) ? { parent: process.env.AXF_PARENT_CHANGE } : {}), ...build }, { create: true });
      setLast(id);
      if (flags.json) return out(r.entry);
      return console.log(`${id}${r.queued ? `  (${r.where})` : ''}`);
    }
    case 'update': { // build stats on an open entry: --ref --model --estimate-min --estimate-cost --areas --branch --doing --progress …
      const id = resolveId(pos[0]);
      return out(await change(id, async (e) => ({ ...e, ...(await buildFlags(flags, e)), ...(str(flags.branch) ? { branch: flags.branch } : {}), ...(e.result ? {} : { lastSeenAt: now }) })));
    }
    case 'beat': { // heartbeat: still working (optionally what on)
      const id = resolveId(pos[0]);
      return out(await change(id, (e) => ({ ...e, lastSeenAt: now, ...(str(flags.doing) ? { doing: flags.doing } : {}) })));
    }
    case 'step': {
      const id = resolveId(pos[0]); const text = pos.slice(1).join(' ');
      const state = str(flags.state);
      if (state && !STEP_STATES.includes(state)) throw new Error(`--state is one of ${STEP_STATES.join(', ')}`);
      const index = flags.index !== undefined ? Number(flags.index) - 1 : undefined;
      return out(await change(id, (e) => {
        const steps = upsertStep(e.steps, { index, text: text || undefined, state: state || (index === undefined ? 'running' : undefined), note: str(flags.note) }, now);
        const run = steps.find((s) => s.state === 'running');
        const fin = steps.filter((s) => ['done', 'skipped'].includes(s.state)).length;
        return { ...e, steps, ...(e.result ? {} : { lastSeenAt: now, doing: run ? redact(run.text, 160) : e.doing, ...(steps.length ? { progress: Math.round((fin / steps.length) * 1000) / 1000 } : {}) }) };
      }));
    }
    case 'result': {
      const id = resolveId(pos[0]);
      const state = str(flags.state);
      if (!RESULT_STATES.includes(state)) throw new Error(`--state is one of ${RESULT_STATES.join(', ')}`);
      const cur = await load(b, id);
      const build = await buildFlags(flags, cur ?? {});
      return out(await change(id, (e0) => {
        const e = { ...e0, ...build, finishedAt: e0.finishedAt || now };
        delete e.doing;
        if (!e.actual?.minutes && minutesBetween(e.startedAt || e.createdAt, now) != null && e.actual) e.actual = { ...e.actual, minutes: minutesBetween(e.startedAt || e.createdAt, now) };
        if (state === 'done' || state === 'partial') e.progress = 1;
        const prev = e.result ?? {};
        const r = { ...prev, state, summary: str(flags.summary) ?? prev.summary ?? '' };
        if (str(flags.branch)) r.branch = flags.branch;
        if (flags.commit) r.commits = [...(prev.commits ?? []), ...flags.commit.filter((c) => typeof c === 'string').map((sha) => ({ sha }))];
        if (flags.files !== undefined) r.filesChanged = Number(flags.files);
        if (flags.test) r.tests = { ...(prev.tests ?? {}), ...Object.fromEntries(flags.test.map(parseTest)) };
        if (flags.link) r.links = { ...(prev.links ?? {}), ...Object.fromEntries(flags.link.map(parseLink)) };
        // A finished entry has no running steps left.
        const steps = (e.steps ?? []).map((s) => (s.state === 'running' ? { ...s, state: state === 'done' ? 'done' : state === 'failed' ? 'failed' : 'skipped', finishedAt: now } : s));
        return { ...e, steps, result: r };
      }));
    }
    case 'close': return out(await change(resolveId(pos[0]), (e) => ({ ...e, closed: { at: now, by: str(flags.by) || `cli:${process.env.USER || 'unknown'}` } })));
    case 'reopen': return out(await change(resolveId(pos[0]), (e) => ({ ...e, closed: null })));
    case 'show': {
      const id = resolveId(pos[0]); const e = await load(b, id);
      if (!e) throw new Error(`no entry ${id} (${b.label})`);
      if (flags.json) return out(e);
      console.log(`${e.title}\n${e.id} · ${e.kind} · ${e.state}${e.closed ? ` · closed ${e.closed.at}` : ''} · ${e.createdAt}`);
      if (e.asked) console.log(`asked: ${e.asked}`);
      for (const [i, s] of (e.steps ?? []).entries()) console.log(`  ${i + 1}. [${s.state}] ${s.text}${s.note ? ` — ${s.note}` : ''}`);
      if (e.result) console.log(`result: ${e.result.state} — ${e.result.summary}`);
      return;
    }
    case 'list': {
      let items = await b.list({ open: flags.open ? '1' : '', kind: str(flags.kind), q: str(flags.q) });
      items = items.filter((x) => (!flags.open || !x.closed) && (!str(flags.kind) || x.kind === flags.kind) && (!str(flags.q) || JSON.stringify([x.title, x.asked, x.id]).toLowerCase().includes(String(flags.q).toLowerCase())));
      items = items.slice(0, Number(flags.limit) || 50);
      if (flags.json) return console.log(JSON.stringify(items.map((x) => (Array.isArray(x.steps) ? summary(x) : x)), null, 2));
      return console.log(items.length ? items.map(line).join('\n') : `no entries (${b.label})`);
    }
    default:
      console.log(readFileSync(SCRIPT, 'utf8').split('\n').slice(1, 30).join('\n').replace(/^ ?\*\/?/gm, ''));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  main().catch((e) => { if (process.argv[2] === 'hook') process.exit(0); console.error(`changes: ${e.message}`); process.exit(1); });
}

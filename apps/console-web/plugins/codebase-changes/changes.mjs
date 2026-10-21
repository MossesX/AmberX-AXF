#!/usr/bin/env node
/**
 * changes.mjs — the Codebase changes log (change-log@1): one entry per request to build, edit, remove or fix something.
 *
 *   node changes.mjs open "<title>" [--kind build|edit|remove|fix|other] [--asked "what was asked"] [--repo owner/name]…
 *                         [--model opus] [--step "first step"]… [--json]                → prints the new id
 *   node changes.mjs step <id|last> "<text>" [--state queued|running|done|failed|skipped] [--index n] [--note "…"]
 *   node changes.mjs result <id|last> --state done|failed|partial|cancelled --summary "…" [--branch b] [--commit sha]…
 *                         [--files N] [--test "name=before→after" | "name=pass"]… [--link report=path|https://…]…
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
 *   3. the console API, when AXF_TOKEN is set (AXF_CONSOLE_URL, default https://console.amberxai.com; https only, no
 *      redirects, the token is never printed)
 *   4. --to-repo (or AXF_CHANGES_REPO=1): this clone's changes/ folder (in the root manifest's data.shared, so claude-sync
 *      carries it to the hub; commit it)
 *   5. otherwise a local queue (~/.axf-changes/queue, 0700), sent on by the next command that can reach 1–3 (or `flush`)
 * `last` = the entry most recently opened on this machine (the hook opens one per request and says its id).
 *
 * The hook never blocks Claude Code: it always exits 0, quickly. Prompts are cut short and anything that looks like a
 * token or password is hidden before it's written.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, DirStore, ID_RE, newId, normalize, nowIso, redact, summary, titleFrom, upsertStep, RESULT_STATES, STEP_STATES } from './changes-core.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const HERE = dirname(SCRIPT);
const REPO = resolve(HERE, '../../../..');
const MARK = /changes\.mjs"? hook$/;
const DEFAULT_CONSOLE = 'https://console.amberxai.com';

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
      const out = await call('PATCH', `entries/${e.id}`, { title: e.title, kind: e.kind, asked: e.asked, repos: e.repos, model: e.model, steps: e.steps, result: e.result });
      if (!!e.closed !== !!cur.closed) return call('POST', `entries/${e.id}/${e.closed ? 'close' : 'reopen'}`, { by: e.closed?.by });
      return out;
    },
    async list(q = {}) {
      const p = new URLSearchParams({ limit: '200', ...Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '')) });
      return (await call('GET', `entries?${p}`)).items;
    },
  };
}

/** The backend this run writes to (see the header). `quiet` skips the queue notice. */
export async function pickBackend(flags = {}, env = process.env) {
  if (flags.dir || env.AXF_CHANGES_DIR) return dirBackend(resolve(String(flags.dir || env.AXF_CHANGES_DIR)), 'folder');
  const shared = await persistChangesDir();
  if (shared) return dirBackend(shared, 'shared data folder (axHub)');
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
function addSessionId(sid, id) { const ids = [...new Set([...sessionIds(sid), id])].slice(-50); writePrivate(sessionFile(sid), JSON.stringify({ ids })); }

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

/* ---------------- Claude Code hook ---------------- */

const cmd = (s) => `node "${SCRIPT}" ${s}`;
export function hookContext(id, kind) {
  return [
    `[Codebase changes] Entry ${id} (${kind}) was opened for this request in the console's Codebase changes log.`,
    'Break the work into steps and record them as you go, then record the result when you finish:',
    `  ${cmd(`step ${id} "<what this step does>" --state running`)}   (then --state done | failed | skipped)`,
    `  ${cmd(`result ${id} --state done|failed|partial|cancelled --summary "<what changed>" [--branch b] [--commit sha]… [--files N] [--test "name=before→after"]… [--link report=<path or https URL>]`)}`,
    'If this request is not actually a change (only a question), run: ' + cmd(`result ${id} --state cancelled --summary "no change: question only"`),
  ].join('\n');
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
    const c = classify(ev.prompt);
    if (!c.change) return '';
    const id = newId(`${sid}\n${ev.prompt}`);
    let e = await load(b, id);
    if (!e) {
      const repo = detectRepo(ev.cwd);
      ({ entry: e } = await save(b, {
        id, createdAt: now, updatedAt: now, kind: c.kind, title: titleFrom(ev.prompt), asked: redact(String(ev.prompt ?? '').replace(/\s+/g, ' '), 600),
        repos: repo ? [repo] : [], model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || '',
        who: { session: sid.slice(0, 12), where: detectWhere(), user: process.env.USER || '', host: hostname() }, steps: [], result: null, closed: null,
      }, { create: true }));
    }
    setLast(id);
    if (sid) addSessionId(sid, id);
    return hookContext(id, e.kind);
  }
  if (ev.hook_event_name !== 'Stop' && ev.hook_event_name !== 'SessionEnd') return '';
  if (!sid) return '';
  const end = ev.hook_event_name === 'SessionEnd';
  for (const id of sessionIds(sid)) {
    const e = await load(b, id);
    if (!e || (e.result && !end)) continue;
    let changed = false;
    const steps = (e.steps ?? []).map((s) => {
      if (s.state === 'running') { changed = true; return { ...s, state: 'done', finishedAt: now, note: s.note ?? `auto: ${end ? 'the session ended' : 'the turn ended'}` }; }
      if (end && s.state === 'queued') { changed = true; return { ...s, state: 'skipped', finishedAt: now, note: s.note ?? 'auto: the session ended' }; }
      return s;
    });
    let result = e.result;
    if (end && !result) { result = { state: 'partial', summary: 'The session ended before a result was recorded.' }; changed = true; }
    if (changed) await save(b, { ...e, steps, result, updatedAt: now });
  }
  if (end) rmSync(sessionFile(sid), { force: true });
  return '';
}

/* ---------------- installing the hook ---------------- */

const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'SessionEnd'];
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
    const r = await save(b, { ...fn(e), updatedAt: now });
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
      const r = await save(b, { id, createdAt: now, updatedAt: now, kind: str(flags.kind) || 'other', title, asked: str(flags.asked) || '', repos, model: str(flags.model) || '',
        who: { session: str(flags.session) || '', where: detectWhere(), user: process.env.USER || '', host: hostname() }, steps, result: null, closed: null }, { create: true });
      setLast(id);
      if (flags.json) return out(r.entry);
      return console.log(`${id}${r.queued ? `  (${r.where})` : ''}`);
    }
    case 'step': {
      const id = resolveId(pos[0]); const text = pos.slice(1).join(' ');
      const state = str(flags.state);
      if (state && !STEP_STATES.includes(state)) throw new Error(`--state is one of ${STEP_STATES.join(', ')}`);
      const index = flags.index !== undefined ? Number(flags.index) - 1 : undefined;
      return out(await change(id, (e) => ({ ...e, steps: upsertStep(e.steps, { index, text: text || undefined, state: state || (index === undefined ? 'running' : undefined), note: str(flags.note) }, now) })));
    }
    case 'result': {
      const id = resolveId(pos[0]);
      const state = str(flags.state);
      if (!RESULT_STATES.includes(state)) throw new Error(`--state is one of ${RESULT_STATES.join(', ')}`);
      return out(await change(id, (e) => {
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

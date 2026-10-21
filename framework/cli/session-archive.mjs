#!/usr/bin/env node
/**
 * session-archive — the recorder and reader for session-archive@1 (logic: framework/plan/session-archive-core.mjs).
 *
 * Where: shared data, sessions/archive/<YYYY>/<MM>/<id>.json (on the hub: /projects/amberx-axf/_data/sessions/archive/),
 * one file per session, rewritten whenever the session is ingested again (the id is stable: cc-<Claude Code session id>,
 * ai-<claude.ai chat id>). Archives sessions of every project (amberx-axf, axhub, build-pilot, other) in one place.
 *
 *   node framework/cli/session-archive.mjs                         newest sessions
 *   node framework/cli/session-archive.mjs ingest <transcript.jsonl>… [--host h] [--container c] [--via moshi] [--user u]
 *   node framework/cli/session-archive.mjs ingest-dir <dir> [same flags]        every *.jsonl under it (~/.claude/projects)
 *   node framework/cli/session-archive.mjs ingest-chat < chat.json             a claude.ai chat (fromChat shape) or {chats: [...]}
 *   node framework/cli/session-archive.mjs ingest-inbox                         chats claude.ai sessions wrote to sessions/archive-inbox/
 *   node framework/cli/session-archive.mjs show <id> | costs [--json] | --json [filters]
 *   node framework/cli/session-archive.mjs hooks install|remove|status [--settings file]   Claude Code Stop/SessionEnd → ingest
 *
 * The hook (`hook`) reads Claude Code's event on stdin and ingests its transcript_path; it never blocks Claude Code.
 * Host facts come from the machine (hostname, OS, a container's name from AXF_CONTAINER or /.dockerenv) and the session's
 * own environment (AXF_RUNNER_APP / TMUX / SSH_CONNECTION → via). Nothing secret is stored: prompts and replies are cut
 * short and secret-looking text is hidden.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, platform, release, userInfo } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './persist.mjs';
import { costUsd } from './model-pricing.mjs';
import { aggregate, attachFeatures, costRecord, filterSessions, fromChat, parseTranscript, summary } from '../plan/session-archive-core.mjs';

export const ARCHIVE_REL = 'sessions/archive/';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const root = () => process.env.AXF_SESSION_ARCHIVE_DIR || dataPath(ARCHIVE_REL);
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const pricing = { costUsd };

function writeAtomic(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  renameSync(tmp, p);
}
const fileFor = (rec) => { const d = (rec.startedAt || new Date().toISOString()).slice(0, 7); return join(root(), d.slice(0, 4), d.slice(5, 7), `${rec.id}.json`); };

/* ---------------- what the machine is ---------------- */

export function machine(env = process.env) {
  let container = env.AXF_CONTAINER || '';
  if (!container && existsSync('/.dockerenv')) container = hostname();
  const via = env.AXF_RUNNER_APP || (env.TMUX ? (env.SSH_CONNECTION ? 'ssh/mosh + tmux' : 'tmux') : env.SSH_CONNECTION ? 'ssh/mosh' : '');
  let user = env.AXF_SESSION_USER || '';
  if (!user) { try { user = userInfo().username; } catch { user = ''; } }
  return { host: env.AXF_HOST_NAME || hostname(), container, os: `${platform()} ${release()}`, via, user: user === 'root' ? 'Brett (root)' : user };
}

/* ---------------- features + changes (for linking) ---------------- */

function changeIndex() {
  const dir = dataPath('changes/');
  const out = {};
  if (!existsSync(dir)) return out;
  for (const y of readdirSync(dir).filter((x) => /^\d{4}$/.test(x))) for (const m of readdirSync(join(dir, y)).filter((x) => /^\d{2}$/.test(x)))
    for (const f of readdirSync(join(dir, y, m)).filter((x) => x.endsWith('.json'))) {
      const e = readJson(join(dir, y, m, f), null);
      if (e?.id) out[e.id] = { title: e.title, buildRef: e.buildRef, estimate: e.estimate, areas: e.areas ?? [], actual: e.actual };
    }
  return out;
}
function featureCatalog(changes) {
  const cat = [];
  const plan = readJson(dataPath('framework/plan/plan.json'), { features: [] });
  for (const f of plan.features ?? []) cat.push({ key: `plan:${f.id}`, id: f.id, kind: 'plan', title: f.title, paths: f.files ?? [], aliases: [] });
  const pending = readJson(dataPath('framework/plan/pending.json'), { items: [] });
  for (const it of pending.items ?? []) cat.push({ key: `pending:${it.id}`, id: it.id, kind: 'pending', title: it.title, paths: [], aliases: it.planId ? [it.planId] : [] });
  const byRef = {};
  for (const c of Object.values(changes)) if (c.buildRef) { const k = `${c.buildRef.kind}:${c.buildRef.id}`; (byRef[k] ??= new Set()); for (const a of c.areas) byRef[k].add(a.replace(/\*.*$/, '').replace(/\/$/, '')); }
  for (const [k, paths] of Object.entries(byRef)) { const hit = cat.find((x) => x.key === k); if (hit) hit.paths = [...new Set([...hit.paths, ...paths])]; else cat.push({ key: k, id: k.split(':').slice(1).join(':'), kind: k.split(':')[0], title: k, paths: [...paths], aliases: [] }); }
  const plugins = join(REPO, 'apps/console-web/plugins');
  if (existsSync(plugins)) for (const d of readdirSync(plugins).filter((x) => !x.startsWith('_') && !x.startsWith('.'))) cat.push({ key: `plugin:${d}`, id: d, kind: 'plugin', title: `${d} (console plugin)`, paths: [`apps/console-web/plugins/${d}`], aliases: [] });
  return cat;
}
const repoPath = (cwd) => (p) => {
  let s = String(p);
  for (const base of [cwd, REPO, '/axf', '/app', join(homedir(), 'AmberX-AXF'), join(homedir(), 'amberx-axf')].filter(Boolean)) if (s.startsWith(`${base}/`)) return s.slice(base.length + 1);
  return s;
};

/* ---------------- ingest ---------------- */

let cache = null;
function linking() { if (!cache) { const changes = changeIndex(); cache = { changes, catalog: featureCatalog(changes), refs: Object.fromEntries(Object.entries(changes).filter(([, c]) => c.buildRef).map(([id, c]) => [id, `${c.buildRef.kind}:${c.buildRef.id}`])) }; } return cache; }

export function save(rec) {
  const { catalog, refs } = linking();
  attachFeatures(rec, catalog, refs);
  // keep facts an earlier ingest knew and this one doesn't (e.g. the device a backfill was told)
  const p = fileFor(rec);
  const old = readJson(p, null);
  if (old?.system) for (const [k, v] of Object.entries(old.system)) if (v && !rec.system[k]) rec.system[k] = v;
  if (old?.notes?.length) rec.notes = [...new Set([...(old.notes ?? []), ...(rec.notes ?? [])])];
  rec.ingestedAt = new Date().toISOString();
  writeAtomic(p, rec);
  return { id: rec.id, file: p, prompts: rec.totals.prompts, costUsd: rec.totals.costUsd };
}

export function ingestTranscript(file, flags = {}) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('"sessionId"')) return null;
  const m = machine();
  const ctx = { file, host: flags.host ?? m.host, container: flags.container ?? m.container, via: flags.via ?? m.via, user: flags.user ?? m.user, os: flags.os ?? m.os, device: flags.device, project: flags.project, pricing,
    fallbackId: basename(file, '.jsonl') };
  const first = text.slice(0, 20000).match(/"cwd":"([^"]+)"/);
  ctx.toRepoPath = repoPath(first?.[1] ?? '');
  const rec = parseTranscript(text, ctx);
  if (!rec.prompts.length) return null;
  return save(rec);
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else if (n.endsWith('.jsonl') && st.size > 0) out.push(p);
  }
  return out;
}
export function ingestDir(dir, flags = {}) {
  const done = [], skipped = [];
  for (const f of walk(dir)) { try { const r = ingestTranscript(f, flags); (r ? done : skipped).push(r ?? f); } catch (e) { skipped.push(`${f}: ${e.message}`); } }
  return { done, skipped };
}
export function ingestChats(input) {
  const chats = Array.isArray(input) ? input : Array.isArray(input?.chats) ? input.chats : [input];
  return chats.filter((c) => c && (c.id || c.url)).map((c) => save(fromChat(c, { pricing })));
}

/* ---------------- inbox (claude.ai chats in any project record themselves) ---------------- */

export const INBOX_REL = 'sessions/archive-inbox/';
/**
 * Chats written by claude.ai sessions (they have no shell): one JSON per chat in fromChat's shape, written with
 * axhub.memory_write (project amberx-axf, area data, path sessions/archive-inbox/<chat id>.json). Each is turned into
 * a session record; the inbox file is then replaced by a one-line receipt so it isn't read twice.
 */
export function ingestInbox() {
  const dir = process.env.AXF_SESSION_INBOX_DIR || dataPath(INBOX_REL);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = join(dir, f);
    const j = readJson(p, null);
    if (!j || j.$axf === 'session-inbox-receipt@1') continue;
    try {
      const recs = ingestChats(j);
      out.push(...recs);
      writeAtomic(p, { $axf: 'session-inbox-receipt@1', ids: recs.map((r) => r.id), at: new Date().toISOString() });
    } catch (e) { out.push({ id: f, error: e.message }); }
  }
  return out;
}

/* ---------------- read ---------------- */

export function loadAll() {
  const dir = root();
  const out = [];
  if (!existsSync(dir)) return out;
  for (const y of readdirSync(dir).filter((x) => /^\d{4}$/.test(x))) for (const m of readdirSync(join(dir, y)).filter((x) => /^\d{2}$/.test(x)))
    for (const f of readdirSync(join(dir, y, m)).filter((x) => x.endsWith('.json'))) { const r = readJson(join(dir, y, m, f), null); if (r?.$axf === 'session-archive@1') out.push(r); }
  return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
export function view(f = {}) {
  try { ingestInbox(); } catch { /* the archive still lists */ }
  const all = loadAll().map(summary);
  const list = filterSessions(all, f);
  const limit = Math.min(Math.max(Number(f.limit) || 200, 1), 5000);
  return { $axf: 'session-archive@1', sessions: list.slice(0, limit), more: Math.max(0, list.length - limit), aggregate: aggregate(list), totals: aggregate(all).totals };
}
export function show(id) { return loadAll().find((r) => r.id === id) ?? null; }
export function costs(f = {}) {
  const sessions = loadAll().filter((s) => (!f.project || s.project === f.project) && (!f.since || s.startedAt >= f.since));
  return costRecord(sessions, linking().changes);
}

/* ---------------- Claude Code hooks ---------------- */

const MARK = /session-archive\.mjs"? hook/;
const settingsFile = (flags) => flags.settings || join(homedir(), '.claude', 'settings.json');
export function installHooks(file, script = fileURLToPath(import.meta.url)) {
  const s = readJson(file, {}) ?? {};
  s.hooks ??= {};
  for (const ev of ['Stop', 'SessionEnd']) {
    s.hooks[ev] = (s.hooks[ev] ?? []).filter((e) => !(e?.hooks ?? []).some((h) => MARK.test(h?.command ?? '')));
    s.hooks[ev].push({ hooks: [{ type: 'command', command: `node "${script}" hook`, timeout: 20 }] });
  }
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  writeAtomic(file, s);
}
export function removeHooks(file) {
  const s = readJson(file, null);
  if (!s?.hooks) return;
  for (const ev of Object.keys(s.hooks)) { s.hooks[ev] = (s.hooks[ev] ?? []).filter((e) => !(e?.hooks ?? []).some((h) => MARK.test(h?.command ?? ''))); if (!s.hooks[ev].length) delete s.hooks[ev]; }
  writeAtomic(file, s);
}
async function hook() {
  try {
    const chunks = []; for await (const c of process.stdin) chunks.push(c);
    const ev = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (ev.transcript_path && existsSync(ev.transcript_path)) ingestTranscript(ev.transcript_path);
  } catch { /* never get in Claude Code's way */ }
}

/* ---------------- CLI ---------------- */

const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const flags = Object.fromEntries(['host', 'container', 'via', 'user', 'os', 'device', 'project'].map((k) => [k, flag(k)]).filter(([, v]) => v !== undefined));
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  const pos = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
  if (cmd === 'hook') await hook();
  else if (cmd === 'ingest') for (const f of pos) { const r = ingestTranscript(f, flags); console.log(r ? `${r.id}: ${r.prompts} prompt(s), ${money(r.costUsd)}` : `${f}: nothing to archive`); }
  else if (cmd === 'ingest-dir') { const r = ingestDir(pos[0] ?? join(homedir(), '.claude', 'projects'), flags); console.log(`${r.done.length} session(s) archived, ${r.skipped.length} skipped`); if (argv.includes('--json')) console.log(JSON.stringify(r)); }
  else if (cmd === 'ingest-chat') { const chunks = []; for await (const c of process.stdin) chunks.push(c); const r = ingestChats(JSON.parse(Buffer.concat(chunks).toString('utf8'))); console.log(`${r.length} chat(s) archived`); }
  else if (cmd === 'ingest-inbox') { const r = ingestInbox(); console.log(`${r.length} chat(s) taken from the inbox`); }
  else if (cmd === 'show') console.log(JSON.stringify(show(pos[0]), null, 1));
  else if (cmd === 'costs') { const c = costs({ project: flag('project') }); if (argv.includes('--json')) console.log(JSON.stringify(c, null, 1)); else { for (const b of c.builds) console.log(`${money(b.costUsd).padStart(9)}  ${b.build}  ${b.title}  (${b.prompts} prompts, ${b.sessions.length} sessions${b.estimateUsd != null ? `, estimate ${money(b.estimateUsd)}` : ''})`); console.log(`total ${money(c.totals.costUsd)}, linked to builds ${money(c.totals.linkedUsd)}`); } }
  else if (cmd === 'hooks') {
    const file = settingsFile(Object.fromEntries([['settings', flag('settings')]]));
    if (argv[1] === 'install') { installHooks(file); console.log(`session archive hooks added to ${file}`); }
    else if (argv[1] === 'remove') { removeHooks(file); console.log(`session archive hooks removed from ${file}`); }
    else console.log(JSON.stringify(readJson(file, {})?.hooks ?? {}).match(MARK) ? 'installed' : 'not installed');
  } else {
    const v = view({ project: flag('project'), source: flag('source'), q: flag('q'), limit: flag('limit') ?? 30 });
    if (argv.includes('--json')) console.log(JSON.stringify(v, null, 1));
    else { for (const s of v.sessions) console.log(`${(s.startedAt || '').slice(0, 16).replace('T', ' ')}  ${s.project.padEnd(11)} ${String(s.system?.surface ?? '').padEnd(18)} ${String(s.totals?.prompts ?? 0).padStart(3)}p ${money(s.totals?.costUsd).padStart(8)}${s.totals?.costEstimated ? '~' : ' '} ${s.title}`); console.log(`${v.totals.sessions} session(s), ${money(v.totals.costUsd)}`); }
  }
}

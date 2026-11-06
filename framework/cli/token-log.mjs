#!/usr/bin/env node
/**
 * token-log — the store and watcher of the token log (token-turn@1, framework/core/token-log.mjs). Plain code, no tokens.
 *
 *   node framework/cli/token-log.mjs query [--from YYYY-MM-DD] [--to …] [--session s] [--account a] [--build b] [--model m]
 *                                          [--agent a] [--source s] [--estimated yes|no] [--rules yes] [--limit N] [--json]
 *   … scan [--root <dir>]…    read new lines of Claude Code transcripts (byte offsets kept), for sessions no stream saw
 *   … chats                   estimated turns from synced chats and session notes (marked estimated)
 *   … check [--json]          the periodic usage check: scan + chats + a tally in <dir>/tally.json (no CLAUDE.md, no model)
 *   … tally [--json]          the last tally
 *   … where                   where the log lives
 * Headless runs write theirs live: deploy/claude-stream.mjs feeds createWriter() every event.
 *
 * Store: /projects/amberx-axf/_data/token-log/<YYYY>/<MM>/<DD>.jsonl (AXF_TOKEN_LOG_DIR elsewhere; without the hub
 * .axf-console/token-log in the checkout). Transcript roots: AXF_TOKEN_LOG_ROOTS (colon separated) else the Claude
 * homes on this host and the console container's read-only mounts. Exit codes: 0 ok · 1 failed · 2 usage.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatTurns, createTurnLog, feedTurns, summarize } from '../core/token-log.mjs';
import { costUsd, loadPricing } from './model-pricing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '..', '..'));
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const r4 = (x) => Math.round(x * 10000) / 10000;

export function logDir() {
  if (process.env.AXF_TOKEN_LOG_DIR) return process.env.AXF_TOKEN_LOG_DIR;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return existsSync(projects) ? join(projects, 'amberx-axf', '_data', 'token-log') : join(ROOT, '.axf-console', 'token-log');
}
const dayFile = (iso) => { const d = String(iso || new Date().toISOString()).slice(0, 10); const [y, m, dd] = d.split('-'); return join(logDir(), y, m, `${dd}.jsonl`); };

/** Append records to their day files; readable and writable by the host user and the console container alike. */
export function append(records) {
  const byFile = new Map();
  for (const r of records) { const f = dayFile(r.at); if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(JSON.stringify(r)); }
  for (const [f, lines] of byFile) {
    const fresh = !existsSync(f);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, `${lines.join('\n')}\n`);
    if (fresh) try { chmodSync(f, 0o664); } catch { /* best effort */ }
  }
}

const dateRange = (from, to) => {
  const out = []; const end = Date.parse(to || new Date().toISOString().slice(0, 10));
  for (let t = Date.parse(from); t <= end && out.length < 800; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** Records between two days (default the last 30), every malformed line skipped. */
export function readRecords({ from = daysAgo(30), to } = {}) {
  const out = [];
  for (const d of dateRange(from, to)) {
    let text; try { text = readFileSync(dayFile(d), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line */ } }
  }
  return out;
}

/** The first open step of a build, looked up at most once a minute (the builds store in this checkout). */
function stepLookup(build, root = process.cwd()) {
  if (!build) return () => '';
  let at = 0; let step = '';
  return () => {
    if (Date.now() - at < 60000) return step;
    at = Date.now();
    const b = readJson(join(root, '_claude', 'builds', 'store.json'))?.builds?.find((x) => x.id === build);
    step = (b?.steps ?? []).find((s) => !s.done && !s.skip)?.id ?? step;
    return step;
  };
}

const pricedBy = (pricing) => (model, u) => costUsd(model, u, pricing);

/** A live writer for one headless session: feed it every stream-json event; a turn lands in the log as it completes. */
export function createWriter(ctx) {
  const pricing = loadPricing();
  const log = createTurnLog({ ctx: { source: 'headless', ...ctx, step: ctx.step ?? stepLookup(ctx.build) }, cost: pricedBy(pricing), emit: (r) => { try { append([r]); } catch { /* the log never stops a build */ } } });
  return log;
}

function transcriptRoots(extra = []) {
  if (extra.length) return extra;
  if (process.env.AXF_TOKEN_LOG_ROOTS) return process.env.AXF_TOKEN_LOG_ROOTS.split(':').filter(Boolean);
  return [join(homedir(), '.claude', 'projects'), '/home/axfbuild/.claude/projects', '/hostfs/claude/root', '/hostfs/claude/axfbuild'];
}
function walk(dir, out = [], depth = 0) {
  let names; try { names = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth < 3) walk(p, out, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
const stateFile = (n) => join(logDir(), 'state', `${n}.json`);
function saveState(n, s) {
  const f = stateFile(n); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(s)); renameSync(tmp, f);
}

/** New bytes of a file from `from`, cut at the last complete line. */
function tailLines(file, from, size) {
  const len = Math.min(size - from, 64 * 1024 * 1024);
  const buf = Buffer.alloc(len); const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, len, from); } finally { closeSync(fd); }
  const end = buf.lastIndexOf(10);
  return end < 0 ? { text: '', used: 0 } : { text: buf.toString('utf8', 0, end), used: end + 1 };
}

/** Transcripts: only what is new since the last scan. A rewritten (shorter) file is read again; ids keep turns single. */
export function scan({ roots = [], since = daysAgo(7) } = {}) {
  const pricing = loadPricing(); const offsets = readJson(stateFile('offsets')) ?? {}; const records = [];
  const cutoff = Date.parse(since); let files = 0;
  for (const root of transcriptRoots(roots)) {
    for (const file of walk(root)) {
      let st; try { st = statSync(file); } catch { continue; }
      const key = `${st.ino}:${file.slice(-120)}`;
      let from = offsets[key] ?? 0;
      if (from > st.size) from = 0;
      if (from === st.size || st.mtimeMs < cutoff) continue;
      const { text, used } = tailLines(file, from, st.size);
      files += 1;
      const session = file.split('/').pop().replace(/\.jsonl$/, '');
      const log = createTurnLog({ ctx: { source: 'vps', session }, cost: pricedBy(pricing), emit: (r) => records.push(r) });
      for (const line of text.split('\n')) { if (!line.includes('"usage"')) continue; try { log.add(JSON.parse(line)); } catch { /* a torn line */ } }
      log.end();
      offsets[key] = from + used;
    }
  }
  if (records.length) append(records);
  saveState('offsets', offsets);
  return { files, turns: records.length };
}

/** Synced chats (the hub's sessions/claude-ai drop folder) and session note feeds: estimated, each new message once. */
export function chats({ dropDir, feedsFile } = {}) {
  const pricing = loadPricing(); const cost = pricedBy(pricing); const seen = readJson(stateFile('chats')) ?? { chats: {}, feeds: {} };
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  const drop = dropDir || process.env.AXF_TOKEN_LOG_CHATS || join(projects, 'amberx-axf', '_data', 'sessions', 'claude-ai');
  const records = []; let names = [];
  try { names = readdirSync(drop).filter((f) => f.endsWith('.json')); } catch { /* none synced yet */ }
  for (const n of names) {
    const chat = readJson(join(drop, n)); if (!chat?.uuid) continue;
    const turns = chatTurns(chat, { cost, from: seen.chats[chat.uuid] ?? 0 });
    records.push(...turns);
    if (turns.length) seen.chats[chat.uuid] = turns[turns.length - 1].turn;
  }
  const feeds = readJson(feedsFile || process.env.AXF_TOKEN_LOG_FEEDS || '')?.feeds ?? {};
  for (const f of Object.values(feeds)) {
    const turns = feedTurns(f, { cost, after: seen.feeds[f.id] ?? 0 });
    records.push(...turns);
    const last = Math.max(0, ...(f.items ?? []).map((i) => i.at || 0));
    if (last) seen.feeds[f.id] = last;
  }
  if (records.length) append(records);
  saveState('chats', seen);
  return { turns: records.length };
}

/** The periodic usage check: bring the log up to date, then tally. Zero tokens: it reads files and adds numbers. */
export function check(opts = {}) {
  const scanned = scan(opts); const chatted = chats(opts);
  const today = new Date().toISOString().slice(0, 10);
  const rows = readRecords({ from: daysAgo(7) });
  const day = summarize(rows, { from: today }, { limit: 0 }); const week = summarize(rows, {}, { limit: 0 });
  const tally = { $axf: 'token-tally@1', at: new Date().toISOString(), scanned, chats: chatted, today: { ...day.totals, byAccount: day.byAccount, byModel: day.byModel }, week: { ...week.totals, byAccount: week.byAccount, byModel: week.byModel, byDay: week.byDay } };
  const f = join(logDir(), 'tally.json'); mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(tally, null, 1)); renameSync(`${f}.tmp`, f);
  return tally;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const say = (o, text) => process.stdout.write(json ? `${JSON.stringify({ ok: true, ...o })}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
  const roots = []; for (let r = flag('--root'); r; r = flag('--root')) roots.push(r);
  const line = (t) => `$${r4(t.costUsd)} · ${t.turns} turns · ${t.tokens} tokens · ${t.rulesReads} rules reads`;
  try {
    const cmd = args.shift() || 'query';
    if (cmd === 'query') {
      const f = {}; for (const k of ['from', 'to', 'session', 'account', 'build', 'model', 'agent', 'source', 'estimated', 'rules']) { const v = flag(`--${k}`); if (v) f[k] = v; }
      const limit = Number(flag('--limit')) || 200;
      const records = readRecords({ from: f.from, to: f.to });
      const s = summarize(records, f, { limit });
      say(s, [`${s.count} turns: ${line(s.totals)}`, ...s.byDay.map((d) => `${d.key}  ${line(d)}`)].join('\n'));
    } else if (cmd === 'scan') say(scan({ roots }), undefined);
    else if (cmd === 'chats') say(chats(), undefined);
    else if (cmd === 'check') { const t = check({ roots }); say({ tally: t }, `today ${line(t.today)} · 7 days ${line(t.week)} · scanned ${t.scanned.files} files, ${t.scanned.turns + t.chats.turns} new turns`); }
    else if (cmd === 'tally') say({ tally: readJson(join(logDir(), 'tally.json')) });
    else if (cmd === 'where') say({ dir: logDir(), roots: transcriptRoots() }, logDir());
    else { process.stderr.write(`token-log: unknown command ${cmd}\n`); process.exit(2); }
  } catch (e) {
    process.stdout.write(json ? `${JSON.stringify({ ok: false, code: 'failed', message: String(e?.message ?? e).slice(0, 300) })}\n` : '');
    process.stderr.write(`token-log: ${e?.message ?? e}\n`); process.exit(1);
  }
}

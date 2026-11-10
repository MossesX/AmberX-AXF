/**
 * Build search sources: turns what is on disk into engine documents (engine.mjs). Read only, no model calls.
 *
 *   build     the builds store (builds@1, `_claude/builds/store.json`): title, request, Brett's words, steps
 *   note      every build's notes, one line each (with the time)
 *   report    `_claude/builds/reports/*.md`
 *   log       each headless session's readable log (`<root>/<build>/<build>.log`, colours stripped)
 *   session   each session's messages from its stream (`<root>/<build>/<build>.jsonl`: what was asked, what Claude said,
 *             each tool call), cached in the data folder and read incrementally (only the bytes added since last time)
 *   <type>    the user's own sources (settings.sources: a file, a folder or a glob)
 *
 * Roots: AXF_BUILD_SEARCH_ROOTS (comma list) or the first of /root/axf-builds, /hostfs/axf-builds that exists (the
 * console container sees the host's worktrees at /hostfs). Repo: AXF_BUILD_SEARCH_REPO or this checkout.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSettings, DEFAULT_SETTINGS } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
export const REPO = resolve(process.env.AXF_BUILD_SEARCH_REPO || join(HERE, '../../../..'));
export const DATA = resolve(process.env.AXF_BUILD_SEARCH_DATA || join(REPO, manifest.lifecycle.dataDir));
export const SETTINGS_FILE = join(DATA, 'settings.json');

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const SECRET = /(ghp_|gho_|ghs_|github_pat_|sk-ant-|xox[bp]-)[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]{12,}/g;
const MAX_LINE = 4000;
const FILE_MAX = 8 * 1024 * 1024;
const SOURCE_FILES_MAX = 3000;
const clean = (s) => String(s ?? '').replace(ANSI, '').replace(SECRET, '[removed]').replace(/\r/g, '');
const cut = (s) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);
const linesOf = (text) => clean(text).split('\n').map(cut);
const mtimeIso = (p) => { try { return statSync(p).mtime.toISOString(); } catch { return ''; } };

export function roots() {
  const env = process.env.AXF_BUILD_SEARCH_ROOTS;
  if (env) return env.split(',').map((x) => x.trim()).filter(Boolean).filter((p) => existsSync(p));
  const first = ['/root/axf-builds', '/hostfs/axf-builds'].find((p) => existsSync(p));
  return first ? [first] : [];
}

/* ------------------------------------------------------------------ settings */

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))); } catch { return normalizeSettings(DEFAULT_SETTINGS); }
}
export function saveSettings(s) {
  const next = normalizeSettings(s);
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const tmp = `${SETTINGS_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 1)}\n`, { mode: 0o600 });
  renameSync(tmp, SETTINGS_FILE);
  return next;
}

/* ------------------------------------------------------------------ builds store */

function storeBuilds() {
  const f = process.env.AXF_BUILD_SEARCH_STORE || join(REPO, '_claude/builds/store.json');
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(s.builds) ? s.builds : Object.values(s.builds ?? {});
  } catch { return []; }
}

function buildDoc(b) {
  const steps = Array.isArray(b.steps) ? b.steps : Array.isArray(b.phases) ? b.phases.flatMap((p) => p.steps ?? []) : [];
  const lines = [
    `Title: ${b.title ?? b.id}`,
    `Id: ${b.id}`,
    `Status: ${b.status ?? ''}${b.priority ? ` · ${b.priority}` : ''}${b.branch ? ` · branch ${b.branch}` : ''}${b.pr ? ` · PR ${b.pr}` : ''}`,
    ...(b.origin?.said ? linesOf(b.origin.said).map((l, i) => (i ? l : `Brett said: ${l}`)) : []),
    ...(b.detail ? linesOf(b.detail).map((l, i) => (i ? l : `Detail: ${l}`)) : []),
    ...steps.map((s) => `Step ${s.id ?? ''}: ${clean(s.title || s.text || '')}${s.done ? ' (done)' : ''}`),
  ];
  return { id: `build:${b.id}`, type: 'build', title: b.title || b.id, build: b.id, at: b.updatedAt || b.createdAt || '', lines };
}

function noteDoc(b) {
  const notes = Array.isArray(b.notes) ? b.notes : [];
  if (!notes.length) return null;
  const lines = notes.flatMap((n) => linesOf(typeof n === 'string' ? n : n.text ?? '').map((l, i) => (i ? `  ${l}` : `${n.at ? `${String(n.at).slice(0, 16).replace('T', ' ')} · ` : ''}${l}`)));
  return { id: `note:${b.id}`, type: 'note', title: `Notes · ${b.title || b.id}`, build: b.id, at: notes[notes.length - 1]?.at ?? '', lines };
}

/* ------------------------------------------------------------------ reports */

function reportsDir() { return process.env.AXF_BUILD_SEARCH_REPORTS || join(REPO, '_claude/builds/reports'); }
function reportDoc(name) {
  const p = join(reportsDir(), `${name}.md`);
  if (!existsSync(p)) return null;
  return { id: `report:${name}`, type: 'report', title: `Report · ${name}`, build: name, path: p, at: mtimeIso(p), lines: linesOf(readFileSync(p, 'utf8')) };
}
function reportNames() { try { return readdirSync(reportsDir()).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)); } catch { return []; } }

/* ------------------------------------------------------------------ session logs and streams */

/** Every session folder under the roots: { name, dir }. A session is a folder holding <name>.log or <name>.jsonl. */
export function sessions() {
  const out = [];
  for (const root of roots()) {
    let names = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      const dir = join(root, name);
      if (existsSync(join(dir, `${name}.log`)) || existsSync(join(dir, `${name}.jsonl`))) out.push({ name, dir });
    }
  }
  return out;
}
const sessionDir = (name) => sessions().find((s) => s.name === name)?.dir ?? '';

function readTail(p, max = FILE_MAX) {
  const size = statSync(p).size;
  const from = Math.max(0, size - max);
  const fd = openSync(p, 'r');
  try { const buf = Buffer.alloc(size - from); readSync(fd, buf, 0, buf.length, from); return { text: buf.toString('utf8'), cut: from > 0 }; } finally { closeSync(fd); }
}

function logDoc(name, dir = sessionDir(name)) {
  const p = join(dir, `${name}.log`);
  if (!dir || !existsSync(p)) return null;
  const { text, cut: trimmed } = readTail(p);
  const lines = linesOf(text);
  if (trimmed) lines[0] = '… (older part of the log not shown)';
  return { id: `log:${name}`, type: 'log', title: `Session log · ${name}`, build: name, path: p, at: mtimeIso(p), lines };
}

/** One stream event (stream-json) as readable lines. */
export function eventLines(ev) {
  const content = ev?.message?.content;
  const out = [];
  const push = (who, text) => { const ls = linesOf(text).filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1)); ls.forEach((l, i) => out.push(i ? `   ${l}` : `${who}: ${l}`)); };
  if (ev?.type === 'user') {
    if (typeof content === 'string') push('Asked', content);
    else if (Array.isArray(content)) for (const c of content) if (c?.type === 'text') push('Asked', c.text);
  } else if (ev?.type === 'assistant' && Array.isArray(content)) {
    for (const c of content) {
      if (c?.type === 'text') push('Claude', c.text);
      else if (c?.type === 'tool_use') {
        const i = c.input ?? {};
        const what = i.command ?? i.file_path ?? i.pattern ?? i.description ?? JSON.stringify(i);
        out.push(`▸ ${c.name}: ${cut(clean(String(what)).replace(/\n/g, ' ⏎ ').slice(0, 400))}`);
      }
    }
  } else if (ev?.type === 'result' && typeof ev.result === 'string') push('Result', ev.result);
  return out;
}

/** The session's messages, from its cache in the data folder, reading only what was added to the stream since. */
function sessionDoc(name, dir = sessionDir(name)) {
  const p = join(dir, `${name}.jsonl`);
  if (!dir || !existsSync(p)) return null;
  const st = statSync(p);
  const cacheDir = join(DATA, 'cache');
  const cf = join(cacheDir, `session-${createHash('sha1').update(p).digest('hex').slice(0, 16)}.json`);
  let c = null;
  try { c = JSON.parse(readFileSync(cf, 'utf8')); } catch { /* first time */ }
  if (!c || c.path !== p || c.offset > st.size) c = { path: p, offset: 0, lines: [] };
  if (c.offset < st.size) {
    const fd = openSync(p, 'r');
    try {
      const chunk = 4 * 1024 * 1024;
      let rest = '';
      let pos = c.offset;
      while (pos < st.size) {
        const buf = Buffer.alloc(Math.min(chunk, st.size - pos));
        readSync(fd, buf, 0, buf.length, pos);
        pos += buf.length;
        const parts = (rest + buf.toString('utf8')).split('\n');
        rest = parts.pop() ?? '';
        for (const raw of parts) { if (!raw.trim()) continue; try { c.lines.push(...eventLines(JSON.parse(raw))); } catch { /* torn line */ } }
      }
      c.offset = st.size - Buffer.byteLength(rest, 'utf8');
    } finally { closeSync(fd); }
    try { mkdirSync(cacheDir, { recursive: true, mode: 0o700 }); writeFileSync(cf, JSON.stringify(c), { mode: 0o600 }); } catch { /* read-only data folder: still searchable */ }
  }
  return { id: `session:${name}`, type: 'session', title: `Session messages · ${name}`, build: name, path: p, at: st.mtime.toISOString(), lines: c.lines };
}

/* ------------------------------------------------------------------ user sources */

function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The files a source names: a file, every text file in a folder (recursive), or a glob. */
export function sourceFiles(src) {
  const raw = src.path.startsWith('/') ? src.path : join(REPO, src.path);
  const wild = raw.search(/[*?]/);
  const base = wild < 0 ? raw : raw.slice(0, raw.lastIndexOf('/', wild) + 1) || '/';
  const re = wild < 0 ? null : globRe(raw);
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= SOURCE_FILES_MAX || depth > 12) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && (!re || re.test(p))) out.push(p);
      if (out.length >= SOURCE_FILES_MAX) return;
    }
  };
  try {
    const st = statSync(wild < 0 ? raw : base);
    if (wild < 0 && st.isFile()) return [raw];
    walk(wild < 0 ? raw : base.replace(/\/$/, '') || '/', 0);
  } catch { return []; }
  return out;
}

function fileDoc(src, p) {
  try {
    const st = statSync(p);
    if (st.size > FILE_MAX) return null;
    const buf = readFileSync(p);
    if (buf.subarray(0, 4096).includes(0)) return null; // binary
    const rel = relative(REPO, p).startsWith('..') ? p : relative(REPO, p);
    return { id: `src:${src.id}:${rel.split(sep).join('/')}`, type: src.type, title: `${src.name} · ${basename(p)}`, build: '', path: p, at: st.mtime.toISOString(), lines: linesOf(buf.toString('utf8')) };
  } catch { return null; }
}

/* ------------------------------------------------------------------ all documents */

/** Every document of the given types. `build` narrows sessions and builds early (cheap). */
export function loadDocs({ types, build, settings } = {}) {
  const s = settings ?? loadSettings();
  const want = new Set(types?.length ? types : s.types);
  const keep = (id) => !build || String(id).toLowerCase().includes(String(build).toLowerCase());
  const docs = [];
  if (want.has('build') || want.has('note')) {
    for (const b of storeBuilds()) {
      if (!b?.id || !keep(b.id)) continue;
      if (want.has('build')) docs.push(buildDoc(b));
      if (want.has('note')) { const n = noteDoc(b); if (n) docs.push(n); }
    }
  }
  if (want.has('report')) for (const n of reportNames()) if (keep(n)) { const d = reportDoc(n); if (d) docs.push(d); }
  if (want.has('log') || want.has('session')) {
    for (const { name, dir } of sessions()) {
      if (!keep(name)) continue;
      if (want.has('log')) { const d = logDoc(name, dir); if (d) docs.push(d); }
      if (want.has('session')) { const d = sessionDoc(name, dir); if (d) docs.push(d); }
    }
  }
  for (const src of s.sources) {
    if (!want.has(src.type) && !want.has('file')) continue;
    for (const p of sourceFiles(src)) { const d = fileDoc(src, p); if (d) docs.push(d); }
  }
  return docs;
}

/** One document by id (the log viewer). */
export function loadDoc(id, settings = loadSettings()) {
  const s = String(id ?? '');
  const i = s.indexOf(':');
  const kind = s.slice(0, i), key = s.slice(i + 1);
  if (!key || /(^|\/)\.\.(\/|$)/.test(key)) return null;
  if (kind === 'build' || kind === 'note') {
    const b = storeBuilds().find((x) => x?.id === key);
    return b ? (kind === 'build' ? buildDoc(b) : noteDoc(b)) : null;
  }
  if (kind === 'report') return /^[\w.-]+$/.test(key) ? reportDoc(key) : null;
  if (kind === 'log') return /^[\w.-]+$/.test(key) ? logDoc(key) : null;
  if (kind === 'session') return /^[\w.-]+$/.test(key) ? sessionDoc(key) : null;
  if (kind === 'src') {
    const j = key.indexOf(':');
    const src = settings.sources.find((x) => x.id === key.slice(0, j));
    if (!src) return null;
    const rel = key.slice(j + 1);
    const p = rel.startsWith('/') ? rel : join(REPO, rel);
    return sourceFiles(src).includes(p) ? fileDoc(src, p) : null; // only files the source really names
  }
  return null;
}

/** What each built-in and user source holds right now (counts, no content). */
export function sourceSummary(settings = loadSettings()) {
  const ss = sessions();
  return {
    roots: roots(),
    repo: REPO,
    builtIn: [
      { id: 'build', label: 'Builds', count: storeBuilds().length },
      { id: 'note', label: 'Build notes', count: storeBuilds().filter((b) => Array.isArray(b?.notes) && b.notes.length).length },
      { id: 'report', label: 'Build reports', count: reportNames().length },
      { id: 'log', label: 'Session logs', count: ss.filter((x) => existsSync(join(x.dir, `${x.name}.log`))).length },
      { id: 'session', label: 'Session messages', count: ss.filter((x) => existsSync(join(x.dir, `${x.name}.jsonl`))).length },
    ],
    user: settings.sources.map((x) => ({ ...x, count: sourceFiles(x).length })),
  };
}

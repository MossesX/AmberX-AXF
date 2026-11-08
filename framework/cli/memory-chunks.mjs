#!/usr/bin/env node
/**
 * Chunked memory store (memory-chunks@1). Splits the project's long Claude memory (CLAUDE.md and every file it
 * imports, THREADS.md, STATUS.md, decisions.md, the rest of _claude/memory/ and its docs/, _claude/instructions/) into
 * small chunks under `_claude/chunks/`, one chunk per Status entry, thread row, decision or section, plus
 * `_claude/chunks/INDEX.md` (one short line per chunk) and `_claude/chunks/index.json`. Sessions read the index (or
 * grep it) and open only the chunks they need instead of loading ~400 KB of memory at start.
 *
 * `_claude/chunks/` sits outside claude-sync's loaded sections (rules/, instructions/, memory/), so it syncs with the
 * hub but is never printed at session start. The sources stay where they are and keep their writers; the chunks are
 * a generated view of them (`build` after a change, `check` says whether they are current).
 *
 *   node framework/cli/memory-chunks.mjs build [--json]        write _claude/chunks/ from the sources
 *   node framework/cli/memory-chunks.mjs check                 exit 1 when the chunks are behind the sources
 *   node framework/cli/memory-chunks.mjs list [--source s] [--q text]   one line per chunk (id, tokens, title)
 *   node framework/cli/memory-chunks.mjs show <chunk id>       print one chunk
 *   node framework/cli/memory-chunks.mjs find <text>           chunks whose title or text mentions it
 *   node framework/cli/memory-chunks.mjs sources [--json]      the files the store is made from
 *
 * AXF_ROOT points at another checkout (tests).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const root = () => resolve(process.env.AXF_ROOT || join(HERE, '..', '..'));
export const CHUNKS_REL = '_claude/chunks';
export const MAX_CHUNK = 6000; // characters; a longer section is split at blank lines
const tokensOf = (t) => Math.ceil(t.length / 4);

/** Sections that are not memory: the orchestrator's live log and audit logs belong to their owners. */
export const SKIP_SECTIONS = [/^Live build log/i, /^Token passes/i];
/** Entry logs: one chunk per top-level bullet or table row. Every other file is chunked per section. */
export const ENTRY_SOURCES = [/^_claude\/THREADS\.md$/, /^_claude\/memory\/STATUS\.md$/, /^_claude\/memory\/decisions\.md$/, /(^|\/)rules\/RULES\.md$/, /^_claude\/memory\/follow-ups\.md$/];

/** Every source file, in load order: CLAUDE.md, its @imports (recursively, repo files only), then the memory folders. */
export function sources(dir = root()) {
  const out = [];
  const seen = new Set();
  const add = (rel) => {
    const r = rel.replace(/^\.\//, '');
    if (seen.has(r) || !r.endsWith('.md') || r.startsWith('_claude/chunks/') || r.startsWith('_claude/handoff/')) return;
    const f = join(dir, r);
    if (!f.startsWith(dir + '/') || !existsSync(f) || !statSync(f).isFile()) return;
    seen.add(r);
    out.push(r);
    for (const m of readFileSync(f, 'utf8').matchAll(/^@([^\s~][^\s]*\.md)\s*$/gm)) add(relative(dir, resolve(dirname(f), m[1])));
  };
  add('CLAUDE.md');
  add('_claude/THREADS.md');
  add('_claude/README.md');
  const walk = (rel) => {
    const d = join(dir, rel);
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(`${rel}/${e.name}`);
      else if (e.isFile()) add(`${rel}/${e.name}`);
    }
  };
  for (const f of ['_claude/memory/STATUS.md', '_claude/memory/decisions.md']) add(f);
  walk('_claude/memory');
  walk('_claude/instructions');
  walk('_claude/rules');
  walk('_claude/shared/rules');
  walk('_claude/shared/memory');
  walk('_claude/shared/instructions');
  return out;
}

export const slug = (s, n = 48) => String(s).toLowerCase().replace(/<!--.*?-->/g, '').replace(/[`*_[\]()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n).replace(/-$/, '') || 'part';
export const sourceKey = (rel) => slug(rel.replace(/^_claude\//, '').replace(/\.md$/, '').replace(/\//g, '-'), 60);

/** A bullet or table row's title: its bold lead, else its first words. */
export function titleOf(text) {
  const t = text.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/^\|\s*/, '');
  const bold = t.match(/^\*\*(.+?)\*\*/);
  const s = (bold ? bold[1] : t.split(/\s\|\s|\n/)[0]).replace(/<!--.*?-->/g, '').replace(/[*`]/g, '').replace(/:$/, '').trim();
  return s.length > 90 ? `${s.slice(0, 87).trimEnd()}…` : s;
}

/** A date the chunk talks about (first "Mon D YYYY" or ISO date), for the index. */
export function dateOf(text) {
  const iso = text.match(/\b(20\d\d-\d\d-\d\d)\b/);
  const m = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})(?:[–-]\d{1,2})?,? (20\d\d)\b/);
  if (m) { const mo = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]) / 3 + 1; return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return iso ? iso[1] : '';
}

/**
 * Split one Markdown file into chunks. Sections are cut at #, ## and ### headings (outside code fences). A section
 * made of top-level bullets ("- **Title** …", STATUS style) gives one chunk per bullet; a table gives one chunk per
 * row (THREADS style, header kept in each); anything else is one chunk, split at blank lines past MAX_CHUNK.
 */
export function chunkFile(rel, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = { heading: '', level: 0, start: 1, lines: [] };
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { sections.push(cur); cur = { heading: h[2].trim(), level: h[1].length, start: i + 1, lines: [line] }; }
    else cur.lines.push(line);
  });
  sections.push(cur);
  const out = [];
  const key = sourceKey(rel);
  const used = new Map();
  const push = (title, body, start, end, section) => {
    const t = body.replace(/^\n+|\s+$/g, '');
    if (!t.trim() || /^#{1,3} [^\n]*$/.test(t.trim())) return;
    const base = `${key}/${slug(title || section || 'intro')}`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    out.push({ id: n > 1 ? `${base}-${n}` : base, source: rel, section, title: title || section || rel, start, end, date: dateOf(`${title} ${t.slice(0, 400)}`), tokens: tokensOf(t), text: t });
  };
  for (const s of sections) {
    const heading = s.heading.replace(/<!--.*?-->/g, '').trim();
    if (SKIP_SECTIONS.some((re) => re.test(heading))) continue;
    const body = s.lines;
    const items = []; // top-level bullets or table rows, with the line they start on
    let lead = [];
    let tableHead = [];
    let fenceIn = false;
    body.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fenceIn = !fenceIn;
      const at = s.start + i;
      if (!fenceIn && /^(?:[-*]|\d+\.) /.test(line)) items.push({ start: at, lines: [line], kind: 'bullet' });
      else if (!fenceIn && /^\|/.test(line)) {
        const sep = (l) => /^\|[\s:|-]+\|?\s*$/.test(l || '');
        if (sep(line)) return; // |---| rows carry nothing (THREADS.md has a stray one mid-table)
        if (!/^\|/.test(body[i - 1] || '')) tableHead = [line, '|---|']; // the first row of a table is its header
        else items.push({ start: at, lines: [line], kind: 'row' });
      } else if (items.length && (line.trim() === '' || /^\s/.test(line)) && items[items.length - 1].kind === 'bullet') items[items.length - 1].lines.push(line);
      else if (items.length) items[items.length - 1].lines.push(line);
      else lead.push(line);
    });
    const bulletish = items.length >= 2 && s.level === 2 && ENTRY_SOURCES.some((re) => re.test(rel)); // ### blocks (a thread's "To carry on") stay whole
    if (!bulletish) {
      // one chunk, split at blank lines when long
      const text = body.join('\n');
      if (text.length <= MAX_CHUNK) { push(heading, text, s.start, s.start + body.length - 1, heading); continue; }
      let part = [], partStart = s.start, n = 1;
      body.forEach((line, i) => {
        part.push(line);
        if ((line.trim() === '' && part.join('\n').length > MAX_CHUNK * 0.7) || i === body.length - 1) {
          push(`${heading || rel} (part ${n++})`, part.join('\n'), partStart, s.start + i, heading);
          part = []; partStart = s.start + i + 1;
        }
      });
      continue;
    }
    const leadText = lead.join('\n').trim();
    if (leadText && !/^#{1,3} [^\n]*$/.test(leadText)) push(`${heading || rel} (intro)`, lead.join('\n'), s.start, items[0].start - 1, heading);
    for (const it of items) {
      const head = it.kind === 'row' && tableHead.length ? `${tableHead.join('\n')}\n` : '';
      push(titleOf(it.lines[0]), `${heading ? `${'#'.repeat(Math.max(2, s.level))} ${heading}\n\n` : ''}${head}${it.lines.join('\n')}`, it.start, it.start + it.lines.length - 1, heading);
    }
  }
  return out;
}

/** Every chunk of every source, in source order. */
export function buildChunks(dir = root()) {
  return sources(dir).flatMap((rel) => chunkFile(rel, readFileSync(join(dir, rel), 'utf8')));
}

const indexLine = (c) => `- \`${c.id}\` ${c.title}${c.date ? ` (${c.date})` : ''} · ${c.tokens}t`;

/** INDEX.md: what the store is, how to use it, then one line per chunk grouped by source. */
export function indexText(chunks) {
  const by = new Map();
  for (const c of chunks) { if (!by.has(c.source)) by.set(c.source, []); by.get(c.source).push(c); }
  const total = chunks.reduce((a, c) => a + c.tokens, 0);
  const L = [
    '# Memory chunks (generated)',
    '',
    `${chunks.length} chunks, about ${total} tokens in all, from ${by.size} files. Do not edit: edit the source and run`,
    '`node framework/cli/memory-chunks.mjs build`. Read a chunk at `_claude/chunks/<id>.md`',
    '(or `memory-chunks.mjs show <id>`); find one with `memory-chunks.mjs find <text>` or by grepping this file.',
    '',
  ];
  for (const [src, cs] of by) {
    L.push(`## ${src} (${cs.length})`, '');
    for (const c of cs) L.push(indexLine(c));
    L.push('');
  }
  return `${L.join('\n').trimEnd()}\n`;
}

export const chunkText = (c) => `<!-- memory-chunk@1 source=${c.source} tokens=${c.tokens} -->\n${c.text}\n`; // line numbers live in index.json only, so an edit above a chunk does not rewrite it

export function indexJson(chunks) {
  return { $axf: 'memory-chunks@1', count: chunks.length, sources: [...new Set(chunks.map((c) => c.source))], chunks: chunks.map(({ text, ...c }) => c) };
}

/** Every file the store should hold, path → content. */
export function plan(dir = root()) {
  const chunks = buildChunks(dir);
  const files = new Map();
  for (const c of chunks) files.set(`${CHUNKS_REL}/${c.id}.md`, chunkText(c));
  files.set(`${CHUNKS_REL}/INDEX.md`, indexText(chunks));
  files.set(`${CHUNKS_REL}/index.json`, `${JSON.stringify(indexJson(chunks), null, 1)}\n`);
  return { chunks, files };
}

function existing(dir) {
  const base = join(dir, CHUNKS_REL);
  const out = new Map();
  const walk = (d) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else out.set(relative(dir, f), readFileSync(f, 'utf8')); } };
  walk(base);
  return out;
}

/** What `build` would change: added, changed and removed chunk files. */
export function diff(dir = root()) {
  const { files } = plan(dir);
  const have = existing(dir);
  const added = [], changed = [], removed = [];
  for (const [f, t] of files) if (!have.has(f)) added.push(f); else if (have.get(f) !== t) changed.push(f);
  for (const f of have.keys()) if (!files.has(f)) removed.push(f);
  return { added, changed, removed, current: !added.length && !changed.length && !removed.length };
}

export function build(dir = root()) {
  const { chunks, files } = plan(dir);
  const base = join(dir, CHUNKS_REL);
  const d = diff(dir);
  for (const f of d.removed) rmSync(join(dir, f), { force: true });
  for (const [f, t] of files) { const p = join(dir, f); mkdirSync(dirname(p), { recursive: true }); if (!existsSync(p) || readFileSync(p, 'utf8') !== t) writeFileSync(p, t); }
  // drop folders left empty
  if (existsSync(base)) for (const e of readdirSync(base, { withFileTypes: true })) if (e.isDirectory() && !readdirSync(join(base, e.name)).length) rmSync(join(base, e.name), { recursive: true });
  return { count: chunks.length, sources: new Set(chunks.map((c) => c.source)).size, tokens: chunks.reduce((a, c) => a + c.tokens, 0), ...d };
}

export function readIndex(dir = root()) {
  try { return JSON.parse(readFileSync(join(dir, CHUNKS_REL, 'index.json'), 'utf8')); } catch { return null; }
}

/** Chunks (from the built store, else computed) matching a text in id, title or body. */
export function find(q, dir = root()) {
  const needle = String(q).toLowerCase();
  return buildChunks(dir).filter((c) => `${c.id}\n${c.title}\n${c.text}`.toLowerCase().includes(needle));
}

function main(argv) {
  const [cmd = 'list', ...rest] = argv;
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const json = rest.includes('--json');
  const dir = root();
  if (cmd === 'build') {
    const r = build(dir);
    if (json) console.log(JSON.stringify(r));
    else console.log(`memory chunks: ${r.count} chunks from ${r.sources} files (~${r.tokens} tokens); ${r.added.length} added, ${r.changed.length} changed, ${r.removed.length} removed`);
    return 0;
  }
  if (cmd === 'check') {
    const d = diff(dir);
    if (d.current) { console.log('memory chunks: current'); return 0; }
    console.log(`memory chunks: behind the sources (${d.added.length} to add, ${d.changed.length} changed, ${d.removed.length} to remove). Run: node framework/cli/memory-chunks.mjs build`);
    return 1;
  }
  if (cmd === 'sources') { const s = sources(dir); console.log(json ? JSON.stringify(s) : s.join('\n')); return 0; }
  if (cmd === 'list') {
    let cs = buildChunks(dir);
    if (flag('--source')) cs = cs.filter((c) => c.source === flag('--source') || c.source.includes(flag('--source')));
    if (flag('--q')) cs = cs.filter((c) => `${c.id} ${c.title}`.toLowerCase().includes(flag('--q').toLowerCase()));
    console.log(json ? JSON.stringify(cs.map(({ text, ...c }) => c)) : cs.map(indexLine).join('\n'));
    return 0;
  }
  if (cmd === 'show') {
    const c = buildChunks(dir).find((x) => x.id === rest[0]);
    if (!c) { console.error(`no chunk ${rest[0]}`); return 1; }
    console.log(json ? JSON.stringify(c) : chunkText(c));
    return 0;
  }
  if (cmd === 'find') {
    const q = rest.filter((x) => x !== '--json').join(' ');
    const cs = find(q, dir);
    console.log(json ? JSON.stringify(cs.map(({ text, ...c }) => c)) : cs.map(indexLine).join('\n') || `no chunk mentions "${q}"`);
    return 0;
  }
  console.error('usage: memory-chunks.mjs build | check | list [--source s] [--q t] | show <id> | find <text> | sources');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

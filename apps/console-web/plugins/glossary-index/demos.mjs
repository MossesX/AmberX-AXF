#!/usr/bin/env node
/**
 * Demonstration Designer + Book Builder store (demonstration@1, book@1, clip@1, docs@1; rules in
 * framework/core/engines/demo-rules.mjs). Every demonstration, book, clip and documentation set made in the console is
 * an asset@1 file in this plugin's data folder, <dataDir>/<type>/<id>.json, and a glossary entry (catalog.mjs indexes
 * the folder), so it is searchable, filterable, sortable and droppable into books like everything else.
 *
 *   node apps/console-web/plugins/glossary-index/demos.mjs list [type]                 every asset of a type (default: all four)
 *   node …/demos.mjs get <type> <id>                                                   one asset
 *   node …/demos.mjs generate <entry id> [--save] [--build <id>]                       a demonstration from a glossary entry (zero tokens)
 *   node …/demos.mjs save <type> <file.json>                                           validate + store an asset
 *   node …/demos.mjs delete <type> <id>
 *   node …/demos.mjs find [type] [--q words] [--generated]                             list rows filtered like the designer's search
 *   node …/demos.mjs demo new "<name>" [--id x] [--about entry] | new-from <file.json>  a blank demonstration (saved)
 *   node …/demos.mjs demo <id> change <file.json>                                      one editor change (set, add-step, set-step, move-step, remove-step, chain-add, chain-remove)
 *   node …/demos.mjs walkthrough <type> <id>                                           as walkthrough@1 (what Molly's guide plays)
 *   node …/demos.mjs book new "<title>" [--minutes N] [--chapter-minutes N] [--chapters N] [--style s] [--docs depth,format,interactive]
 *   node …/demos.mjs book <id> add <chapter> <ref> [index] | move <chapter> <i> <chapter> <j> | move-chapter <i> <j>
 *                    | chapter add "<title>" | chapter remove <id> | chapter rename <id> "<title>" | remove <chapter> <i>
 *   node …/demos.mjs book <id> record [--dry-run]                                      hand the book to the walkthrough recorder job
 *   node …/demos.mjs clip register <file.json>                                         register a recorded clip (auto-tagged)
 *   node …/demos.mjs clip from-demo <demo id> --video <path> [--seconds N] [--poster p] [--captions c]
 *   node …/demos.mjs docs generate <book id> [--depth light|standard|deep|extreme] [--format markdown|html|interactive-html-ts] [--interactive none|examples|live]
 *
 * Env: AXF_GLOSSARY_DIR (the plugin's data folder; catalog.mjs shares it), AXF_REPO_ROOT. No model, no network.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../../../framework/core/engines/demo-rules.mjs';
import { DATA_DIR, ROOT, currentCatalog, linksTo, search as searchCatalog, writeCatalog } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TYPES = R.DEMO_TYPES;
export const STORE_DIR = DATA_DIR;
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dirOf = (type) => join(STORE_DIR, type);
const fileOf = (type, id) => join(dirOf(type), `${id}.json`);
const assertType = (type) => { if (!TYPES.includes(type)) throw new Error(`unknown type "${type}" (one of ${TYPES.join(', ')})`); };
const assertId = (id) => { if (!ID.test(id ?? '')) throw new Error(`"${id}" is not an asset id (lowercase letters, digits and dashes, 2 to 48)`); };

/* ---------------- store ---------------- */

export function list(type) {
  const types = type ? [type] : TYPES;
  const out = [];
  for (const t of types) {
    assertType(t);
    if (!existsSync(dirOf(t))) continue;
    for (const f of readdirSync(dirOf(t)).filter((n) => n.endsWith('.json')).sort()) {
      try { const a = readJson(join(dirOf(t), f)); if (a?.$axf === 'asset@1' && a.type === t && a.id) out.push(a); } catch { /* a half-written file is skipped */ }
    }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }));
}

export function get(type, id) {
  assertType(type); assertId(id);
  const f = fileOf(type, id);
  if (existsSync(f)) return readJson(f);
  // the framework's starters count too (read-only: saving one writes a copy into the store)
  const starter = join(ROOT, 'framework/assets', type, `${id}.json`);
  return existsSync(starter) ? readJson(starter) : null;
}

/** A summary row per asset (what the lists show): id, name, description, type, and the facts of its kind. */
export function summarize(a) {
  const d = a.data ?? {};
  const base = { type: a.type, id: a.id, name: a.name, description: a.description ?? '', tags: a.tags ?? [], updatedAt: a.updatedAt ?? '', keywords: (d.keywords ?? []).length };
  if (a.type === 'demonstration') return { ...base, about: d.about ?? '', steps: (d.steps ?? []).length, seconds: R.demonstrationSeconds(d), surface: d.surface, app: d.app, generated: d.generated?.from ?? '', chain: d.chain ?? [] };
  if (a.type === 'book') { const m = R.bookMinutes(d); return { ...base, chapters: (d.chapters ?? []).length, items: (d.chapters ?? []).reduce((n, c) => n + (c.items?.length ?? 0), 0), minutes: m.total, style: d.plan?.style ?? '', docs: d.docs?.enabled ? `${d.docs.depth} ${d.docs.format}` : '' }; }
  if (a.type === 'clip') return { ...base, kind: d.kind, source: d.source ?? {}, seconds: d.media?.seconds ?? 0, video: d.media?.video ?? '', recordedAt: d.recorded?.at ?? '', entries: d.entries ?? [] };
  return { ...base, source: d.source ?? {}, depth: d.depth, format: d.format, interactive: d.interactive, files: (d.files ?? []).length, generatedAt: d.generatedAt ?? '' };
}

/** The asset@1 envelope around normalised data. */
export function envelope(type, { id, name, description = '', data, tags = [], author = 'Dev Console', version = '1.0.0' }) {
  assertType(type); assertId(id);
  const errors = R.demoAssetErrors(type, data);
  if (errors.length) throw new Error(`${type} ${id}: ${errors.join('; ')}`);
  const d = R.normalizeDemoAsset(type, data);
  return { $axf: 'asset@1', type, id, name: String(name ?? id).trim().slice(0, 120) || id, version, description: String(description ?? '').slice(0, 600), author, tags: [...new Set([type, ...tags.filter((t) => typeof t === 'string')])].slice(0, 20), data: d };
}

/** Validate and store an asset; the glossary is rebuilt so the new entry shows at once. Returns the stored asset. */
export function save(type, raw, { reason = 'saved' } = {}) {
  assertType(type);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('an asset must be a JSON object');
  if (raw.$axf && raw.$axf !== 'asset@1') throw new Error('"$axf" must be "asset@1"');
  if (raw.type && raw.type !== type) throw new Error(`the file says type "${raw.type}", not ${type}`);
  const a = envelope(type, { id: raw.id, name: raw.name, description: raw.description, data: raw.data, tags: raw.tags ?? [], author: raw.author ?? 'Dev Console', version: raw.version ?? '1.0.0' });
  a.updatedAt = new Date().toISOString();
  mkdirSync(dirOf(type), { recursive: true });
  writeFileSync(fileOf(type, a.id), `${JSON.stringify(a, null, 1)}\n`);
  try { writeCatalog({ reason: `${type} ${reason}` }); } catch { /* the glossary rebuilds on its next read */ }
  return a;
}

export function remove(type, id) {
  assertType(type); assertId(id);
  const f = fileOf(type, id);
  if (!existsSync(f)) return false;
  rmSync(f);
  try { writeCatalog({ reason: `${type} removed` }); } catch { /* next read */ }
  return true;
}

/* ---------------- glossary lookups ---------------- */

let catCache = null;
const catalog = () => (catCache ??= currentCatalog());
export const lookup = (id) => catalog().entries.find((e) => e.id === id) ?? null;
export const searchEntries = (q, limit = 30) => searchCatalog(catalog().entries, q, limit);

/* ---------------- demonstrations ---------------- */

/** A demonstration from a glossary entry: zero tokens, from the entry's own text, links and API. `--save` stores it. */
export function generate(entryId, { save: store = false, build = '', at = new Date().toISOString() } = {}) {
  const e = lookup(entryId);
  if (!e) throw new Error(`no glossary entry ${entryId}`);
  const g = R.demonstrationFromEntry(e, { lookup, at, build });
  const a = envelope('demonstration', { id: g.id, name: g.name, description: g.description, data: g.data, tags: ['generated', e.kind], author: 'Glossary & Index' });
  return store ? save('demonstration', a, { reason: 'generated' }) : a;
}

/**
 * A blank demonstration (the designer's Blank button): one placeholder step, saved at once so the API can change it.
 * `id` is made from the name when not given; an id already in use gets -2, -3 … (never overwrites).
 */
export function newDemo({ name = '', id = '', description = '', about = '', app = 'console' } = {}) {
  const title = String(name ?? '').trim().slice(0, 120) || 'New demonstration';
  let base = ID.test(id ?? '') ? id : R.slugify(title, 'demonstration');
  if (!ID.test(base)) base = `${base}-demo`.slice(0, 48);
  let cid = base; for (let n = 2; get('demonstration', cid); n++) cid = `${base.slice(0, 44)}-${n}`;
  const data = { about, entries: [], app, surface: 'live', steps: [{ say: 'Say what this step shows.', do: '', target: '' }], voice: { narrator: '', speed: 1 }, chain: [], keywords: [], generated: { from: 'manual', at: '', build: '' }, editable: true };
  return save('demonstration', envelope('demonstration', { id: cid, name: title, description, data, tags: ['demonstration'] }), { reason: 'created' });
}

/** The step fields a change may set (DemoStep); anything else is ignored. */
const STEP_FIELDS = ['title', 'say', 'do', 'target', 'highlight', 'wait'];
const stepFrom = (s = {}) => Object.fromEntries(STEP_FIELDS.filter((k) => s[k] !== undefined).map((k) => [k, k === 'wait' ? Math.max(0, Math.min(30000, Number(s[k]) || 0)) : String(s[k])]));

/**
 * One change to a demonstration — everything the Demonstration Designer's editor does, so the API (REST, MCP, CLI,
 * voice) can do it too (ui-api@1, Brett Nov 8 2026: "API functions that can do everything the UI can"):
 *   { op: 'set', name?, description?, app?, surface?, speed?, narrator?, about? }   the editor's fields ('' clears about)
 *   { op: 'add-step', step?, index? }   { op: 'set-step', index, step }   { op: 'move-step', index, dir: -1|1 | to }
 *   { op: 'remove-step', index }   { op: 'chain-add', id }   { op: 'chain-remove', id }
 * Saved at once (the editor's Save after the same edits). Returns the stored asset.
 */
export function changeDemo(id, change) {
  const a = get('demonstration', id);
  if (!a) throw new Error(`no demonstration ${id}`);
  const d = R.normalizeDemonstration(a.data);
  const c = change ?? {};
  const next = { ...a };
  const at = (i) => { if (!Number.isInteger(i) || i < 0 || i >= d.steps.length) throw new Error(`no step ${i} (0 to ${d.steps.length - 1})`); return i; };
  switch (c.op) {
    case 'set': {
      if (c.name !== undefined) next.name = String(c.name).trim().slice(0, 120) || a.name;
      if (c.description !== undefined) next.description = String(c.description).slice(0, 600);
      if (c.app !== undefined) d.app = String(c.app);
      if (c.surface !== undefined) d.surface = String(c.surface);
      if (c.speed !== undefined) d.voice = { ...d.voice, speed: Number(c.speed) };
      if (c.narrator !== undefined) d.voice = { ...d.voice, narrator: String(c.narrator) };
      if (c.about !== undefined) { d.about = String(c.about); if (d.about) d.entries = [...new Set([d.about, ...d.entries])]; }
      break;
    }
    case 'add-step': { const s = { say: '', do: '', target: '', ...stepFrom(c.step) }; if (!s.say.trim()) s.say = 'Say what this step shows.'; d.steps.splice(Number.isInteger(c.index) ? Math.max(0, Math.min(d.steps.length, c.index)) : d.steps.length, 0, s); break; }
    case 'set-step': { const i = at(c.index); d.steps[i] = { ...d.steps[i], ...stepFrom(c.step) }; break; }
    case 'move-step': { const i = at(c.index); const j = Number.isInteger(c.to) ? c.to : i + (c.dir === -1 || c.dir === 'up' ? -1 : 1); if (j < 0 || j >= d.steps.length) throw new Error(`step ${i} can't move to ${j}`); const [s] = d.steps.splice(i, 1); d.steps.splice(j, 0, s); break; }
    case 'remove-step': { const i = at(c.index); if (d.steps.length === 1) throw new Error('a demonstration keeps at least one step'); d.steps.splice(i, 1); break; }
    case 'chain-add': { const cid = String(c.id ?? ''); if (cid === a.id) throw new Error('a demonstration cannot chain itself'); if (!get('demonstration', cid)) throw new Error(`no demonstration ${cid}`); if (!d.chain.includes(cid)) d.chain.push(cid); break; }
    case 'chain-remove': d.chain = d.chain.filter((x) => x !== c.id); break;
    default: throw new Error(`unknown demonstration change "${c.op}" (set, add-step, set-step, move-step, remove-step, chain-add, chain-remove)`);
  }
  next.data = d;
  return save('demonstration', next, { reason: c.op });
}

/** List rows filtered the way the designer's search and "Only generated" switch filter them. */
export function find(type, { q = '', generated = false } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return list(type).map(summarize).filter((s) => (!generated || s.generated === 'glossary') && words.every((w) => `${s.name} ${s.description} ${s.about ?? ''} ${s.id} ${(s.entries ?? []).join(' ')}`.toLowerCase().includes(w)));
}

/** What a book item plays:a demonstration's steps, a clip's transcript, a chapter of another book, or a generated demo of an entry. */
export function resolveRef(ref, depth = 0) {
  const r = R.parseRef(ref);
  if (!r) return null;
  if (r.kind === 'entry') { const e = lookup(r.id); if (!e) return { title: r.id, kind: 'entry', missing: true }; return { title: e.term, kind: 'entry', summary: e.summary, entryKind: e.kind, steps: R.demonstrationFromEntry(e, { lookup }).data.steps }; }
  const a = get(r.kind, r.id);
  if (!a) return { title: r.ref, kind: r.kind, missing: true };
  if (r.kind === 'demonstration') return { title: a.name, kind: r.kind, summary: a.description, steps: R.normalizeDemonstration(a.data).steps, seconds: R.demonstrationSeconds(a.data) };
  if (r.kind === 'clip') { const d = R.normalizeClip(a.data); return { title: a.name, kind: r.kind, summary: a.description, seconds: d.media.seconds, steps: d.transcript.map((t) => ({ say: t.say, do: '', target: '' })) }; }
  const b = R.normalizeBook(a.data);
  const chapters = r.chapter ? b.chapters.filter((c) => c.id === r.chapter) : b.chapters;
  const steps = [];
  if (depth < 2) for (const c of chapters) { steps.push({ say: c.intro || `Chapter: ${c.title}.`, do: '', target: '' }); for (const it of c.items) steps.push(...(resolveRef(it.ref, depth + 1)?.steps ?? [])); }
  return { title: r.chapter ? `${a.name} › ${chapters[0]?.title ?? r.chapter}` : a.name, kind: r.kind, summary: a.description, steps: steps.slice(0, 200) };
}

/** An asset as walkthrough@1: a demonstration's steps, a clip's transcript, a whole book (chapter intros + every item). */
export function walkthroughOf(type, id) {
  const a = get(type, id);
  if (!a) throw new Error(`no ${type} ${id}`);
  if (type === 'demonstration') return R.demonstrationToWalkthrough(a);
  if (type === 'book') return R.bookToWalkthrough(a, (ref) => resolveRef(ref));
  if (type === 'clip') { const d = R.normalizeClip(a.data); return { $axf: 'walkthrough@1', id: a.id, title: a.name, app: d.recorded.app || 'console', steps: d.transcript.map((t) => ({ say: t.say, do: '', target: '' })), source: 'clip' }; }
  throw new Error(`${type} does not play`);
}

/* ---------------- books ---------------- */

export function newBook(wizard = {}) {
  const title = String(wizard.title ?? '').trim() || 'Untitled book';
  const id = ID.test(wizard.id ?? '') ? wizard.id : R.slugify(title, 'book');
  if (!ID.test(id)) throw new Error('give the book a longer title (its id needs two characters)');
  if (get('book', id)) throw new Error(`a book "${id}" exists; pick another title or id`);
  const data = R.newBook(wizard);
  return save('book', envelope('book', { id, name: title, description: String(wizard.about ?? wizard.description ?? '').slice(0, 600), data, tags: ['book', data.plan.style] }), { reason: 'created' });
}

/** One change to a book: { op: 'add-item' | 'remove-item' | 'move-item' | 'move-chapter' | 'add-chapter' | 'remove-chapter' | 'rename-chapter' | 'set-plan' | 'set-docs' | 'set-outputs' | 'set-chapter', ... }. */
export function changeBook(id, change) {
  const a = get('book', id);
  if (!a) throw new Error(`no book ${id}`);
  let d = R.normalizeBook(a.data);
  const c = change ?? {};
  const chapter = (cid) => { const ch = d.chapters.find((x) => x.id === cid); if (!ch) throw new Error(`no chapter ${cid} in ${id}`); return ch; };
  switch (c.op) {
    case 'add-item': d = R.addItem(d, c.chapter, c.ref, c.index); if (!R.parseRef(c.ref)) throw new Error(`"${c.ref}" is not a glossary entry id or an asset ref`); break;
    case 'remove-item': { const ch = chapter(c.chapter); if (!Number.isInteger(c.index) || !ch.items[c.index]) throw new Error('no such item'); ch.items.splice(c.index, 1); break; }
    case 'move-item': d = R.moveItem(d, c.from, c.to); break;
    case 'move-chapter': d = R.moveChapter(d, c.from, c.to); break;
    case 'add-chapter': { const title = String(c.title ?? '').trim() || `Chapter ${d.chapters.length + 1}`; let cid = R.slugify(title, `chapter-${d.chapters.length + 1}`); while (d.chapters.some((x) => x.id === cid)) cid = `${cid}-2`; d.chapters.splice(Number.isInteger(c.index) ? Math.max(0, Math.min(d.chapters.length, c.index)) : d.chapters.length, 0, { id: cid, title, minutes: Number.isInteger(c.minutes) ? c.minutes : 0, intro: String(c.intro ?? '').slice(0, 600), items: [], collapsed: false }); break; }
    case 'remove-chapter': { const i = d.chapters.findIndex((x) => x.id === c.chapter); if (i < 0) throw new Error(`no chapter ${c.chapter}`); d.chapters.splice(i, 1); break; }
    case 'rename-chapter': { const ch = chapter(c.chapter); ch.title = String(c.title ?? '').trim().slice(0, 120) || ch.title; break; }
    case 'set-chapter': { const ch = chapter(c.chapter); if (c.minutes !== undefined) ch.minutes = Number.isInteger(c.minutes) ? Math.max(0, c.minutes) : ch.minutes; if (c.intro !== undefined) ch.intro = String(c.intro).slice(0, 600); if (c.collapsed !== undefined) ch.collapsed = c.collapsed === true; break; }
    case 'set-item': { const ch = chapter(c.chapter); const it = ch.items[c.index]; if (!it) throw new Error('no such item'); if (c.minutes !== undefined) { if (Number.isInteger(c.minutes) && c.minutes > 0) it.minutes = c.minutes; else delete it.minutes; } if (c.note !== undefined) { const n = String(c.note).slice(0, 300); if (n) it.note = n; else delete it.note; } break; }
    case 'set-plan': d.plan = R.normalizeBook({ ...d, plan: { ...d.plan, ...(c.plan ?? {}) } }).plan; break;
    case 'set-docs': d.docs = R.normalizeDocsOptions({ ...d.docs, ...(c.docs ?? {}) }); break;
    case 'set-outputs': d.outputs = { ...d.outputs, ...(c.outputs ?? {}) }; break;
    default: throw new Error(`unknown book change "${c.op}"`);
  }
  const next = { ...a, data: d };
  if (c.name) next.name = String(c.name).trim().slice(0, 120) || a.name;
  if (c.description !== undefined) next.description = String(c.description).slice(0, 600);
  return save('book', next, { reason: c.op });
}

/** The outline of every book (or one), labels resolved through the glossary. */
export function outline(id) {
  const books = id ? [get('book', id)].filter(Boolean) : list('book');
  return R.bookOutline(books, (ref) => resolveRef(ref));
}

/**
 * Hand a book to the walkthrough recorder: its walkthrough@1 is written beside the book (<dataDir>/video/<id>.walkthrough.json)
 * and the hired Walkthrough producer gets the amberx-walkthrough job with the chapters as its flow (framework/cli/agent-job.mjs;
 * the recorder's data-script input lands with the build-docs runner). Returns { file, job }.
 */
export function recordBook(id, { dryRun = false } = {}) {
  const a = get('book', id);
  if (!a) throw new Error(`no book ${id}`);
  const w = walkthroughOf('book', id);
  const dir = join(STORE_DIR, 'video');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.walkthrough.json`);
  writeFileSync(file, `${JSON.stringify({ ...w, book: id, plan: R.normalizeBook(a.data).plan, chapters: R.bookMinutes(a.data).chapters }, null, 1)}\n`);
  const flow = R.normalizeBook(a.data).chapters.map((c) => c.title).join(', ');
  const args = [join(ROOT, 'framework/cli/agent-job.mjs'), 'amberx-walkthrough', '--input', 'app=console', '--input', `flow=${flow}`, '--input', `reason=Book "${a.name}" (book/${id}); walkthrough@1 at ${file}`, '--json'];
  if (dryRun) args.push('--dry-run');
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, AXF_REPO_ROOT: ROOT }, timeout: 60000 });
  let job = null;
  try { job = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { job = { ok: r.status === 0, output: (r.stdout || r.stderr || '').slice(-600), status: r.status }; }
  return { file, job, dryRun };
}

/* ---------------- clips ---------------- */

/** Register a recorded clip (any source): validated, auto-tagged with the entries it shows and its source, stored, indexed. */
export function registerClip(raw) {
  const d = R.normalizeClip(raw?.data ?? raw);
  const entries = d.entries.map(lookup).filter(Boolean);
  const source = d.source.kind === 'demonstration' && d.source.id ? get('demonstration', d.source.id) : d.source.kind === 'book' && d.source.id ? get('book', d.source.id) : null;
  const steps = source?.type === 'demonstration' ? R.normalizeDemonstration(source.data).steps : [];
  d.keywords = R.autoKeywords([d.keywords, R.clipKeywords({ kind: d.kind, source: d.source, entries, steps, transcript: d.transcript, recorded: d.recorded, extra: [raw?.name, source?.name] })], 200);
  const id = ID.test(raw?.id ?? '') ? raw.id : R.slugify(`clip-${d.source.id || raw?.name || Date.now()}`, 'clip');
  return save('clip', envelope('clip', { id, name: raw?.name || `${source?.name ?? id} (clip)`, description: raw?.description || `A recorded ${d.kind}: ${Math.round(d.media.seconds)} s.`, data: d, tags: ['clip', d.kind, 'generated'] }), { reason: 'registered' });
}

/** A clip record from a demonstration that was filmed (the recorder's media facts in). */
export function clipFromDemo(demoId, media, recorded = {}) {
  const a = get('demonstration', demoId);
  if (!a) throw new Error(`no demonstration ${demoId}`);
  const d = R.normalizeDemonstration(a.data);
  const c = R.clipFromDemonstration(a, media, recorded, { entries: d.entries.map(lookup).filter(Boolean), at: new Date().toISOString() });
  return registerClip({ id: c.id, name: c.name, description: c.description, data: c.data });
}

/* ---------------- CLI ---------------- */

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, d = '') => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? d : d; };
  const has = (name) => rest.includes(name);
  const json = (v) => process.stdout.write(`${JSON.stringify(v, null, has('--json') ? 0 : 2)}\n`);
  if (cmd === 'demo') {
    const [id, op, file] = rest;
    if (id === 'new-from') { json(newDemo(readJson(op))); return 0; }
    if (id === 'new') { json(newDemo({ name: op, id: flag('--id'), about: flag('--about') })); return 0; }
    if (op === 'change') { json(changeDemo(id, readJson(file))); return 0; }
    console.error('usage: demos.mjs demo new "<name>" [--id x] [--about entry] | new-from <file.json> | <id> change <file.json>'); return 2;
  }
  if (cmd === 'find') { json(find(rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined, { q: flag('--q'), generated: has('--generated') })); return 0; }
  if (!cmd || cmd === 'list') { const items = list(rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined).map(summarize); if (has('--json')) json(items); else for (const a of items) console.log(`${a.type.padEnd(14)} ${a.id.padEnd(40)} ${a.name}`); return 0; }
  if (cmd === 'get') { const a = get(rest[0], rest[1]); if (!a) { console.error(`demos: no ${rest[0]} ${rest[1]}`); return 2; } json(a); return 0; }
  if (cmd === 'generate') { json(generate(rest[0], { save: has('--save'), build: flag('--build') })); return 0; }
  if (cmd === 'save') { json(save(rest[0], readJson(rest[1]))); return 0; }
  if (cmd === 'delete') { console.log(remove(rest[0], rest[1]) ? `demos: removed ${rest[0]} ${rest[1]}` : `demos: nothing to remove`); return 0; }
  if (cmd === 'walkthrough') { json(walkthroughOf(rest[0], rest[1])); return 0; }
  if (cmd === 'outline') { json(outline(rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined)); return 0; }
  if (cmd === 'book') {
    const [id, op, ...a] = rest;
    if (id === 'new-from') { json(newBook(readJson(op))); return 0; }
    if (op === 'change') { json(changeBook(id, readJson(a[0]))); return 0; }
    if (id === 'new') { const docs = flag('--docs'); const [depth, format, interactive] = docs.split(','); json(newBook({ title: op, totalMinutes: Number(flag('--minutes', 0)), chapterMinutes: Number(flag('--chapter-minutes', 5)), count: Number(flag('--chapters', 0)), style: flag('--style', 'tutorial'), docs: docs ? { enabled: true, depth, format, interactive } : undefined })); return 0; }
    if (op === 'add') { json(summarize(changeBook(id, { op: 'add-item', chapter: a[0], ref: a[1], index: a[2] !== undefined ? Number(a[2]) : undefined }))); return 0; }
    if (op === 'remove') { json(summarize(changeBook(id, { op: 'remove-item', chapter: a[0], index: Number(a[1]) }))); return 0; }
    if (op === 'move') { json(summarize(changeBook(id, { op: 'move-item', from: { chapter: a[0], index: Number(a[1]) }, to: { chapter: a[2], index: Number(a[3]) } }))); return 0; }
    if (op === 'move-chapter') { json(summarize(changeBook(id, { op: 'move-chapter', from: Number(a[0]), to: Number(a[1]) }))); return 0; }
    if (op === 'chapter') { const sub = a[0]; json(summarize(changeBook(id, sub === 'add' ? { op: 'add-chapter', title: a[1] } : sub === 'remove' ? { op: 'remove-chapter', chapter: a[1] } : { op: 'rename-chapter', chapter: a[1], title: a[2] }))); return 0; }
    if (op === 'record') { json(recordBook(id, { dryRun: has('--dry-run') })); return 0; }
    console.error('usage: demos.mjs book new "<title>" | <id> add|remove|move|move-chapter|chapter|record …'); return 2;
  }
  if (cmd === 'clip') {
    const show = (a) => json(has('--full') ? a : summarize(a));
    if (rest[0] === 'register') { show(registerClip(readJson(rest[1]))); return 0; }
    if (rest[0] === 'from-demo') {
      const from = flag('--from') ? readJson(flag('--from')) : {};
      show(clipFromDemo(rest[1], { video: flag('--video'), poster: flag('--poster'), captions: flag('--captions'), seconds: Number(flag('--seconds', 0)), ...(from.media ?? {}) }, from.recorded ?? {}));
      return 0;
    }
    console.error('usage: demos.mjs clip register <file.json> [--full] | from-demo <demo id> --video <path> [--from <file.json>] [--full]'); return 2;
  }
  if (cmd === 'docs') {
    // docs.mjs imports this module: run it as its own process (a dynamic import from the entry module would wait on itself)
    const r = spawnSync('node', [join(HERE, 'docs.mjs'), ...rest], { stdio: 'inherit', env: process.env });
    return r.status ?? 1;
  }
  console.error('usage: demos.mjs list [type] | get <type> <id> | generate <entry> [--save] | save <type> <file> | delete <type> <id> | walkthrough <type> <id> | outline [book] | book … | clip …');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exit(await main(process.argv.slice(2))); } catch (e) { console.error(`demos: ${e.message}`); process.exit(1); }
}
export { HERE };

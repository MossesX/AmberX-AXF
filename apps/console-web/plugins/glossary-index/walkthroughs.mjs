#!/usr/bin/env node
/**
 * Glossary walkthroughs (investor demos): pick glossary entries, write a prompt, and a chain of Claude calls writes a
 * guided, interactive walkthrough that is saved and played back later with no live Claude (the console's walkthrough
 * player, the demo sandbox). Rules and formats: walkthrough-rules.mjs (glossary-walkthrough-request@1 →
 * glossary-walkthrough@1).
 *
 * Storage (this plugin's data folder, never git):
 *   <dataDir>/walkthrough/<id>/current.json      the live version
 *   <dataDir>/walkthrough/<id>/v<version>.json   every version ever saved (restore any of them)
 * and, for the rest of the plugin, a demonstration@1 per feature (<id>-f<n>) and a book@1 (<id>, style tour).
 *
 * The chain: `plan` answers the brief and one prompt per feature; something answers each prompt (the console server
 * through axf.llm@1, `--llm claude` through the claude CLI, or a Claude Code session writing a replies file); `assemble`
 * turns the replies into the walkthrough, with the zero-token template standing in for any feature without a usable
 * reply. `generate` does all three.
 *
 *   node apps/console-web/plugins/glossary-index/walkthroughs.mjs list
 *   node …/walkthroughs.mjs plan --terms <id,id…> [--prompt "…"] [--title "…"] [--audience investors] [--depth standard] [--no-try]
 *   node …/walkthroughs.mjs plan --request <file.json>                         (or the request JSON on stdin with --stdin)
 *   node …/walkthroughs.mjs assemble --request <file.json> [--replies <file.json>] [--model <name>]   replies: { "<entry id>": "<reply text>" }
 *   node …/walkthroughs.mjs generate --terms … [--prompt …] [--llm template|claude] [--model opus]
 *   node …/walkthroughs.mjs get <id> [--version 1.2.0] | versions <id> | restore <id> <version> | delete <id>
 *   node …/walkthroughs.mjs walkthrough <id>                                   as walkthrough@1 (Molly's guide, the recorder)
 *   node …/walkthroughs.mjs export <id> [--out file.json] | import <file.json>  the self-contained file the demo sandbox loads
 *   node …/walkthroughs.mjs search <words…>                                    glossary entries to pick from
 *
 * Env: AXF_GLOSSARY_DIR, AXF_REPO_ROOT (shared with catalog.mjs / demos.mjs). --json prints one JSON line.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../../../framework/core/engines/demo-rules.mjs';
import * as W from './walkthrough-rules.mjs';
import { DATA_DIR, DEMO_KINDS, currentCatalog, linksTo, search as searchCatalog, writeCatalog } from './catalog.mjs';
import { envelope, get as getAsset } from './demos.mjs';

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const WT_DIR = join(DATA_DIR, 'walkthrough');
const dirOf = (id) => join(WT_DIR, id);
const assertId = (id) => { if (!ID.test(id ?? '')) throw new Error(`"${id}" is not a walkthrough id (lowercase letters, digits and dashes, 2 to 48)`); };

/* ---------------- the glossary ---------------- */

let cat = null;
const catalog = () => (cat ??= currentCatalog());
const byId = () => (catalog()._byId ??= new Map(catalog().entries.map((e) => [e.id, e])));
export const lookup = (id) => byId().get(id) ?? null;
export const searchEntries = (q, limit = 30) => searchCatalog(catalog().entries, q, limit);
const relatedOf = (e) => [...new Set([...(e.related ?? []), ...linksTo(catalog().entries, e.id)])].map(lookup).filter((x) => x && !DEMO_KINDS.has(x.kind)).slice(0, W.WT_LIMITS.related);

/* ---------------- plan: the brief and one prompt per feature ---------------- */

/** The template (zero-token) demonstration of an entry: the actions and targets that really exist. */
function templateOf(entry, at) {
  const g = R.demonstrationFromEntry(entry, { lookup, at });
  return g.data.steps;
}

/**
 * The plan of a request: the normalised request, its id and title, the brief, and per feature the entry, its template
 * steps and the prompt the chain sends. Entries no longer in the glossary are listed as `missing` and skipped.
 */
export function plan(rawRequest, { at = new Date().toISOString() } = {}) {
  const errors = W.requestErrors(rawRequest);
  if (errors.length) throw new Error(errors.join('; '));
  const request = W.normalizeRequest(rawRequest);
  const entries = request.terms.map(lookup);
  const missing = request.terms.filter((_, i) => !entries[i]);
  const found = entries.filter(Boolean);
  if (!found.length) throw new Error(`none of the picked entries are in the glossary (${missing.slice(0, 3).join(', ')})`);
  const id = W.walkthroughIdOf(request);
  const features = found.map((e, i) => {
    const template = templateOf(e, at);
    const related = relatedOf(e);
    return { entry: e.id, term: e.term, template, related: related.map((x) => ({ id: x.id, term: x.term })), prompt: W.featurePrompt(request, e, { template, index: i, total: found.length, related }) };
  });
  return { id, title: W.titleOf(request, found), request: { ...request, id }, brief: W.briefOf(request, found), features, missing };
}

/* ---------------- assemble: replies → saved walkthrough ---------------- */

/**
 * Put the walkthrough together from a plan's request and the chain's replies ({ "<entry id>": text }; a missing or
 * unusable reply falls back to the template, recorded in the chain log), save it as a new version, and write the
 * demonstrations and the book.
 */
export function assemble(rawRequest, replies = {}, { model = '', ms = 0, chainMs = {}, note = '', at = new Date().toISOString(), saveAssets = true } = {}) {
  const p = plan(rawRequest, { at });
  const previous = current(p.id);
  const chain = [];
  const features = p.features.map((f, i) => {
    const e = lookup(f.entry);
    const text = replies?.[f.entry];
    const reply = typeof text === 'string' && text.trim() ? W.parseFeatureReply(text, { template: f.template, tryIt: p.request.tryIt }) : null;
    const demonstration = `${p.id.slice(0, 40).replace(/-+$/, '')}-f${i + 1}`;
    const feature = W.featureOf(e, f.template, p.request, { reply, demonstration, related: f.related });
    chain.push({ entry: f.entry, source: feature.source, ms: Number(chainMs?.[f.entry]) || 0, error: reply && !reply.ok ? reply.error : text === undefined && p.request.mode === 'claude' ? 'no reply' : '' });
    return feature;
  });
  const bundle = W.assembleBundle({ request: p.request, brief: p.brief, features, previous, at, generator: { model, ms, chain }, note, book: p.id });
  const errors = W.bundleErrors(bundle);
  if (errors.length) throw new Error(errors.join('; '));
  save(bundle);
  if (saveAssets) writeAssets(bundle);
  return bundle;
}

/** One demonstration@1 per feature and one book@1 whose chapters are the features (the rest of the plugin plays and edits them). */
export function writeAssets(bundle) {
  const tags = ['walkthrough', 'glossary-walkthrough', bundle.request.audience];
  const write = (type, a) => { mkdirSync(join(DATA_DIR, type), { recursive: true }); writeFileSync(join(DATA_DIR, type, `${a.id}.json`), `${JSON.stringify({ ...a, updatedAt: bundle.updatedAt }, null, 1)}\n`); };
  const chapters = [];
  bundle.features.forEach((f, i) => {
    if (!f.demonstration) return;
    const data = R.normalizeDemonstration({
      about: f.entry, entries: [f.entry, ...f.docs.related.map((x) => x.id)], app: bundle.request.app, surface: 'live',
      steps: f.steps.map((s) => ({ say: s.say, do: s.do, target: s.target, title: s.title || (s.kind === 'try' ? 'Try it' : ''), highlight: s.highlight, wait: s.wait })),
      keywords: R.autoKeywords(['walkthrough', bundle.name, f.term, f.kind, f.category, f.docs.points], 80), generated: { from: 'book', at: bundle.updatedAt, build: '' },
    });
    write('demonstration', envelope('demonstration', { id: f.demonstration, name: `${f.term} (${bundle.name})`, description: f.docs.headline || f.docs.summary, data, tags, author: f.source === 'claude' ? 'Claude' : 'Dev Console', version: bundle.version }));
    chapters.push({ id: `part-${i + 1}`, title: f.term, intro: f.docs.headline, minutes: 0, items: [{ ref: `demonstration/${f.demonstration}`, minutes: 0, note: '' }] });
  });
  // a shorter regeneration leaves no stale feature demonstrations behind
  const keep = new Set(bundle.features.map((f) => f.demonstration));
  const prefix = `${bundle.id.slice(0, 40).replace(/-+$/, '')}-f`;
  if (existsSync(join(DATA_DIR, 'demonstration'))) for (const f of readdirSync(join(DATA_DIR, 'demonstration'))) {
    const id = f.replace(/\.json$/, '');
    if (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) && !keep.has(id)) rmSync(join(DATA_DIR, 'demonstration', f), { force: true });
  }
  const book = R.normalizeBook({ about: bundle.request.prompt || bundle.name, plan: { style: 'tour', totalMinutes: 0, chapterMinutes: 5 }, chapters, keywords: R.autoKeywords(['walkthrough', bundle.name, bundle.features.map((f) => f.term)], 60) });
  write('book', envelope('book', { id: bundle.book || bundle.id, name: bundle.name, description: `Generated walkthrough: ${bundle.features.map((f) => f.term).join(', ')}`.slice(0, 600), data: book, tags, version: bundle.version }));
  try { writeCatalog({ reason: `walkthrough ${bundle.id} ${bundle.version}` }); } catch { /* the glossary rebuilds on its next read */ }
}

/* ---------------- store + versions ---------------- */

export function save(bundle) {
  const b = W.normalizeBundle(bundle);
  assertId(b.id);
  mkdirSync(dirOf(b.id), { recursive: true });
  const text = `${JSON.stringify(b, null, 1)}\n`;
  writeFileSync(join(dirOf(b.id), `v${b.version}.json`), text);
  writeFileSync(join(dirOf(b.id), 'current.json'), text);
  // keep at most WT_LIMITS.versions version files (the oldest go)
  const vs = versionFiles(b.id);
  for (const v of vs.slice(W.WT_LIMITS.versions)) rmSync(join(dirOf(b.id), `v${v}.json`), { force: true });
  return b;
}

const cmpVersion = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };
function versionFiles(id) {
  if (!existsSync(dirOf(id))) return [];
  return readdirSync(dirOf(id)).map((f) => /^v(\d+\.\d+\.\d+)\.json$/.exec(f)?.[1]).filter(Boolean).sort(cmpVersion);
}

export function current(id) {
  assertId(id);
  const f = join(dirOf(id), 'current.json');
  try { return existsSync(f) ? W.normalizeBundle(readJson(f)) : null; } catch { return null; }
}

export function get(id, version = '') {
  assertId(id);
  if (!version) return current(id);
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version (1.2.0)`);
  const f = join(dirOf(id), `v${version}.json`);
  return existsSync(f) ? W.normalizeBundle(readJson(f)) : null;
}

export function list() {
  if (!existsSync(WT_DIR)) return [];
  return readdirSync(WT_DIR).filter((d) => ID.test(d)).map(current).filter(Boolean).map(W.summarizeBundle)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Every saved version, newest first, with what changed from the one before it. */
export function versions(id) {
  const vs = versionFiles(id);
  return vs.map((v, i) => {
    const b = get(id, v);
    const older = vs[i + 1] ? get(id, vs[i + 1]) : null;
    const h = b.history[0] ?? {};
    return { version: v, at: b.updatedAt, mode: b.generator.mode, model: b.generator.model, features: b.features.length, note: h.note ?? '', current: i === 0 || v === current(id)?.version, diff: older ? W.diffBundles(older, b) : null };
  });
}

/** Make an older version the live one again: it is saved as a new version (nothing is lost). */
export function restore(id, version) {
  const old = get(id, version);
  if (!old) throw new Error(`no version ${version} of ${id}`);
  const cur = current(id);
  const at = new Date().toISOString();
  const next = W.normalizeBundle({ ...old, version: W.nextVersion(cur?.version ?? old.version), updatedAt: at, history: [{ version: W.nextVersion(cur?.version ?? old.version), at, mode: old.generator.mode, terms: old.features.length, note: `Restored ${version}` }, ...(cur?.history ?? old.history)].slice(0, W.WT_LIMITS.versions) });
  save(next);
  writeAssets(next);
  return next;
}

export function remove(id) {
  assertId(id);
  const cur = current(id);
  if (!cur) return false;
  rmSync(dirOf(id), { recursive: true, force: true });
  for (const f of cur.features) if (f.demonstration) rmSync(join(DATA_DIR, 'demonstration', `${f.demonstration}.json`), { force: true });
  rmSync(join(DATA_DIR, 'book', `${cur.book || id}.json`), { force: true });
  try { writeCatalog({ reason: `walkthrough ${id} removed` }); } catch { /* next read */ }
  return true;
}

/* ---------------- export / import (the demo sandbox's file) ---------------- */

/** The self-contained file: the bundle plus the demonstrations and the book, so a sandbox can import it with no glossary build. */
export function exportBundle(id) {
  const b = current(id);
  if (!b) throw new Error(`no walkthrough ${id}`);
  const assets = [...b.features.map((f) => f.demonstration && getAsset('demonstration', f.demonstration)), getAsset('book', b.book || id)].filter(Boolean);
  return { $axf: 'glossary-walkthrough-export@1', exportedAt: new Date().toISOString(), walkthrough: b, assets };
}

export function importBundle(raw) {
  const w = raw?.$axf === 'glossary-walkthrough-export@1' ? raw.walkthrough : raw;
  const errors = W.bundleErrors(w);
  if (errors.length) throw new Error(errors.join('; '));
  const b = save(w);
  const assets = Array.isArray(raw?.assets) ? raw.assets : [];
  if (assets.length) {
    for (const a of assets) {
      if (!a || a.$axf !== 'asset@1' || !['demonstration', 'book'].includes(a.type) || !ID.test(a.id ?? '')) continue;
      const env = envelope(a.type, { id: a.id, name: a.name, description: a.description, data: a.data, tags: a.tags ?? [], author: a.author ?? 'Import', version: a.version ?? '1.0.0' });
      mkdirSync(join(DATA_DIR, a.type), { recursive: true });
      writeFileSync(join(DATA_DIR, a.type, `${a.id}.json`), `${JSON.stringify(env, null, 1)}\n`);
    }
    try { writeCatalog({ reason: `walkthrough ${b.id} imported` }); } catch { /* next read */ }
  } else writeAssets(b);
  return b;
}

/* ---------------- the claude CLI as the chain's model (ahead of time, from a shell) ---------------- */

/** Answer each feature prompt with `claude -p` (Opus by default: never Sonnet or Haiku, model-policy). */
export function claudeReplies(p, { model = 'opus', log = () => {} } = {}) {
  const replies = {}; const chainMs = {};
  const m = /sonnet|haiku/i.test(model) ? 'opus' : model;
  for (const f of p.features) {
    const t0 = Date.now();
    log(`chain: ${f.term} …`);
    const r = spawnSync('claude', ['-p', f.prompt.messages[0].content, '--append-system-prompt', f.prompt.system, '--model', m, '--output-format', 'json'], { encoding: 'utf8', timeout: 240000, maxBuffer: 8 << 20 });
    chainMs[f.entry] = Date.now() - t0;
    if (r.status === 0) { try { replies[f.entry] = JSON.parse(r.stdout).result ?? r.stdout; } catch { replies[f.entry] = r.stdout; } }
    else log(`chain: ${f.term} failed (${(r.stderr || r.error?.message || '').trim().split('\n').at(-1)}), template stands in`);
  }
  return { replies, chainMs, model: m };
}

/* ---------------- CLI ---------------- */

function requestFrom(rest, flag, has) {
  if (flag('--request')) return readJson(flag('--request'));
  if (has('--stdin')) return JSON.parse(readFileSync(0, 'utf8'));
  return {
    terms: flag('--terms').split(',').map((s) => s.trim()).filter(Boolean), prompt: flag('--prompt'), title: flag('--title'), id: flag('--id') || undefined,
    audience: flag('--audience') || undefined, style: flag('--style') || undefined, depth: flag('--depth') || undefined, tryIt: !has('--no-try'), intro: !has('--no-intro'),
    mode: flag('--llm') === 'template' ? 'template' : 'claude',
  };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, d = '') => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? d : d; };
  const has = (name) => rest.includes(name);
  const json = (v) => process.stdout.write(`${JSON.stringify(v, null, has('--json') ? 0 : 2)}\n`);
  const log = (s) => { if (!has('--json')) console.error(s); };
  if (!cmd || cmd === 'list') { const items = list(); if (has('--json') || !items.length) json(items); else for (const w of items) console.log(`${w.id.padEnd(40)} v${w.version.padEnd(8)} ${String(w.features).padStart(3)} features  ${w.name}`); return 0; }
  if (cmd === 'search') { json(searchEntries(rest.filter((x) => !x.startsWith('--')).join(' '), Number(flag('--limit', 20))).map((e) => ({ id: e.id, term: e.term, kind: e.kind, summary: e.summary }))); return 0; }
  if (cmd === 'plan') { const p = plan(requestFrom(rest, flag, has)); if (has('--brief')) console.log(p.brief); else json(p); return 0; }
  if (cmd === 'assemble') {
    const replies = flag('--replies') ? readJson(flag('--replies')) : has('--replies-stdin') ? JSON.parse(readFileSync(0, 'utf8')) : {};
    const b = assemble(requestFrom(rest, flag, has), replies.replies ?? replies, { model: flag('--model') || replies.model || '', ms: Number(replies.ms) || 0, chainMs: replies.chainMs ?? {}, note: flag('--note') });
    json(has('--full') ? b : W.summarizeBundle(b)); return 0;
  }
  if (cmd === 'generate') {
    const req = requestFrom(rest, flag, has);
    const p = plan(req);
    const t0 = Date.now();
    const llm = flag('--llm', 'template');
    const r = llm === 'claude' ? claudeReplies(p, { model: flag('--model', 'opus'), log }) : { replies: {}, chainMs: {}, model: '' };
    const b = assemble({ ...req, mode: llm === 'claude' ? 'claude' : 'template' }, r.replies, { model: r.model, ms: Date.now() - t0, chainMs: r.chainMs, note: flag('--note') });
    json(has('--full') ? b : W.summarizeBundle(b)); return 0;
  }
  if (cmd === 'get') { const b = get(rest[0], flag('--version')); if (!b) { console.error(`walkthroughs: no walkthrough ${rest[0]}`); return 2; } json(b); return 0; }
  if (cmd === 'versions') { json(versions(rest[0])); return 0; }
  if (cmd === 'restore') { json(W.summarizeBundle(restore(rest[0], rest[1]))); return 0; }
  if (cmd === 'delete') { const ok = remove(rest[0]); json({ removed: ok }); return ok ? 0 : 2; }
  if (cmd === 'walkthrough') { const b = current(rest[0]); if (!b) { console.error(`walkthroughs: no walkthrough ${rest[0]}`); return 2; } json(W.bundleToWalkthrough(b)); return 0; }
  if (cmd === 'export') { const x = exportBundle(rest[0]); if (flag('--out')) { writeFileSync(flag('--out'), `${JSON.stringify(x, null, 1)}\n`); json({ wrote: flag('--out'), features: x.walkthrough.features.length, assets: x.assets.length }); } else json(x); return 0; }
  if (cmd === 'import') { json(W.summarizeBundle(importBundle(has('--stdin') ? JSON.parse(readFileSync(0, 'utf8')) : readJson(rest[0])))); return 0; }
  console.error('usage: walkthroughs.mjs list | search <words> | plan --terms a,b [--prompt …] | assemble --request f [--replies f] | generate --terms a,b [--llm template|claude] | get <id> [--version v] | versions <id> | restore <id> <v> | delete <id> | walkthrough <id> | export <id> [--out f] | import <file>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exit(await main(process.argv.slice(2))); } catch (e) { console.error(`walkthroughs: ${e.message}`); process.exit(1); }
}

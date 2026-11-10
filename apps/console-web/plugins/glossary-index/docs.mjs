#!/usr/bin/env node
/**
 * Documentation generator (docs@1; rules in framework/core/engines/demo-rules.mjs → docsPlan). Writes the documentation
 * of a book (or one demonstration, or a list of glossary entries) from the same sources as the book: the glossary and
 * index entries (what it is, what it does, where it appears, its API, what it links to and contains), the demonstration
 * steps, the clips. Depth light → extreme, format markdown / html / interactive-html-ts, interactivity none / examples /
 * live, exactly the files docsPlan lists:
 *
 *   index.<md|html>            contents (light: everything on this one page)
 *   chapters/<id>.<md|html>    one page per chapter (standard+)
 *   items/<ref>.<md|html>      one page per item with its full API, links, children and demonstration steps (deep+)
 *   docs.css                   the look, from the theme tokens only (data/tokens.css carries their values: the live
 *                              console's when generated from the console, the framework's defaults from the CLI)
 *   docs.ts + docs.js          the interactive runtime (TypeScript source + compiled): search, collapsing, the Run
 *                              buttons of API examples (read-only REST calls against the console, token pasted once),
 *                              keyboard navigation (interactive-html-ts)
 *   live.ts + live.js          live components: the real screen of an item in a frame of the console (interactive live)
 *   data/book.json, data/examples.json, data/search.json
 *
 * The files go to <dataDir>/docs-out/<docs id>/ and the docs@1 asset (files, generatedAt, sourceHash) is saved beside the
 * books, so the glossary indexes it and the Book Builder opens it. No model, no tokens.
 *
 *   node apps/console-web/plugins/glossary-index/docs.mjs generate <book id> [--kind book|demonstration] [--depth d] [--format f] [--interactive i] [--out <dir>]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../../../framework/core/engines/demo-rules.mjs';
import { ROOT, currentCatalog } from './catalog.mjs';
import { STORE_DIR, envelope, get, lookup, resolveRef, save } from './demos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DOCS_OUT = join(STORE_DIR, 'docs-out');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fileKey = (s) => R.slugify(s, 'item');

/* ================================================================== tokens (the look comes from assets) */

/** The theme tokens docs.css reads, from the framework's default assets (the console passes its live values instead). */
export function defaultTokens() {
  const defaults = readJson(join(ROOT, 'framework/defaults.json'));
  const asset = (type) => { const f = join(ROOT, 'framework/assets', type, `${defaults[type]}.json`); return existsSync(f) ? readJson(f).data : {}; };
  const c = asset('color-theme').tokens ?? {}; const s = asset('style-theme'); const ty = asset('typography'); const de = asset('density'); const si = asset('sizing');
  const out = {};
  for (const [k, v] of Object.entries(c)) out[`--fx-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] = v;
  out['--fx-font'] = s.fontFamily ?? 'system-ui, sans-serif'; out['--fx-font-display'] = s.fontDisplay ?? out['--fx-font']; out['--fx-font-mono'] = s.fontMono ?? 'ui-monospace, monospace';
  out['--fx-font-size'] = `${s.fontSize ?? 14}px`; out['--fx-space'] = `${s.space ?? 8}px`; out['--fx-border-w'] = `${s.borderWidth ?? 1}px`;
  for (const k of ['sm', 'md', 'lg']) out[`--fx-radius-${k}`] = `${s.radius?.[k] ?? 8}px`;
  for (const [k, v] of Object.entries(ty.scale ?? {})) out[`--fx-type-scale-${k}`] = `calc(var(--fx-font-size) * ${v})`;
  for (const [k, v] of Object.entries(ty.weights ?? {})) out[`--fx-type-weights-${k}`] = String(v);
  for (const [k, v] of Object.entries(de.gap ?? {})) out[`--fx-dens-gap-${k}`] = `calc(var(--fx-space) * ${v})`;
  out['--fx-row-h'] = `calc(var(--fx-space) * ${de.row?.list ?? 2.3})`; out['--fx-card-pad'] = `calc(var(--fx-space) * ${si.card?.pad ?? de.pad?.card ?? 1.1})`;
  out['--fx-opacity-tint'] = String(s.opacityTint ?? 0.1);
  return out;
}
const tokensCss = (tokens) => `/* theme tokens: generated from assets, never hand-written */\n:root {\n${Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;

/** docs.css: layout + the tokens, nothing else (swap the tokens and the docs restyle). */
const DOCS_CSS = `/* Generated documentation (docs@1). Layout only; every colour, size, font and radius is a theme token from data/tokens.css. */
*, *::before, *::after { box-sizing: border-box }
html { font: var(--fx-font-size) / 1.5 var(--fx-font); color: var(--fx-text); background: var(--fx-bg) }
/* nav + main wrap by themselves below the token widths: no pixel breakpoint */
body { margin: 0; display: flex; flex-wrap: wrap; align-items: start; min-height: 100dvh }
.docs-nav { flex: 1 1 calc(var(--fx-space) * 28); max-width: calc(var(--fx-space) * 44) }
.docs-main { flex: 999 1 calc(var(--fx-space) * 64) }
.docs-nav { position: sticky; top: 0; max-height: 100dvh; overflow: auto; padding: var(--fx-card-pad); border-right: var(--fx-border-w) solid var(--fx-border); border-bottom: var(--fx-border-w) solid var(--fx-border); background: var(--fx-surface) }
.docs-nav h2 { margin: 0 0 var(--fx-dens-gap-sm); font-family: var(--fx-font-display); font-size: var(--fx-type-scale-md) }
.docs-nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--fx-dens-gap-xs) }
.docs-nav ul ul { padding-left: var(--fx-dens-gap-lg) }
.docs-nav a { color: var(--fx-text); text-decoration: none; display: block; padding: var(--fx-dens-gap-xs) var(--fx-dens-gap-sm); border-radius: var(--fx-radius-sm) }
.docs-nav a:hover, .docs-nav a[aria-current='page'] { background: var(--fx-surface2); color: var(--fx-accent) }
.docs-main { min-width: 0; padding: var(--fx-card-pad) calc(var(--fx-card-pad) * 2); display: flex; flex-direction: column; gap: var(--fx-dens-gap-lg) }
.docs-main h1 { margin: 0; font-family: var(--fx-font-display); font-size: var(--fx-type-scale-2xl) }
.docs-main h2 { margin: var(--fx-dens-gap-lg) 0 0; font-family: var(--fx-font-display); font-size: var(--fx-type-scale-xl) }
.docs-main h3 { margin: var(--fx-dens-gap-md) 0 0; font-size: var(--fx-type-scale-lg) }
.docs-main h4 { margin: var(--fx-dens-gap-sm) 0 0; font-size: var(--fx-type-scale-sm); color: var(--fx-muted); text-transform: uppercase; letter-spacing: 0.06em }
.docs-eyebrow { margin: 0; color: var(--fx-muted); font-size: var(--fx-type-scale-sm); text-transform: uppercase; letter-spacing: 0.06em }
.docs-muted { color: var(--fx-muted) }
.docs-kind { display: inline-block; padding: 0 var(--fx-dens-gap-sm); border-radius: var(--fx-radius-sm); background: var(--fx-surface2); color: var(--fx-muted); font-size: var(--fx-type-scale-xs); font-weight: var(--fx-type-weights-strong); vertical-align: middle }
.docs-item { padding: var(--fx-card-pad); border: var(--fx-border-w) solid var(--fx-border); border-radius: var(--fx-radius-md); background: var(--fx-surface); display: flex; flex-direction: column; gap: var(--fx-dens-gap-sm) }
.docs-item > summary { cursor: pointer; font-weight: var(--fx-type-weights-strong); font-size: var(--fx-type-scale-lg) }
.docs-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--fx-dens-gap-xs) var(--fx-dens-gap-md); margin: 0; font-size: var(--fx-type-scale-sm) }
.docs-facts dt { color: var(--fx-muted) } .docs-facts dd { margin: 0; overflow-wrap: anywhere }
.docs-api { width: 100%; border-collapse: collapse; font-size: var(--fx-type-scale-sm) }
.docs-api th, .docs-api td { text-align: left; padding: var(--fx-dens-gap-xs) var(--fx-dens-gap-sm); border-bottom: var(--fx-border-w) solid var(--fx-border); vertical-align: top; overflow-wrap: anywhere }
code, pre, .docs-mono { font-family: var(--fx-font-mono); font-size: var(--fx-type-scale-sm) }
pre { margin: 0; padding: var(--fx-dens-gap-sm) var(--fx-dens-gap-md); border-radius: var(--fx-radius-sm); background: var(--fx-surface2); overflow: auto }
.docs-example { display: flex; flex-direction: column; gap: var(--fx-dens-gap-xs) }
.docs-example__bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--fx-dens-gap-sm) }
.docs-btn { font: inherit; font-size: var(--fx-type-scale-sm); padding: 0 var(--fx-dens-gap-md); min-height: var(--fx-row-h); border: var(--fx-border-w) solid var(--fx-border); border-radius: var(--fx-radius-sm); background: var(--fx-surface); color: var(--fx-text); cursor: pointer }
.docs-btn--primary { background: var(--fx-accent); color: var(--fx-accent-text); border-color: var(--fx-accent) }
.docs-btn:focus-visible, .docs-input:focus-visible { outline: var(--fx-border-w) solid var(--fx-focus); outline-offset: var(--fx-border-w) }
.docs-input { font: inherit; min-height: var(--fx-row-h); padding: 0 var(--fx-dens-gap-sm); border: var(--fx-border-w) solid var(--fx-border); border-radius: var(--fx-radius-sm); background: var(--fx-surface); color: var(--fx-text); min-width: 0; flex: 1 1 auto }
.docs-steps { margin: 0; padding-left: var(--fx-dens-gap-xl); display: flex; flex-direction: column; gap: var(--fx-dens-gap-xs) }
.docs-steps li::marker { color: var(--fx-accent); font-weight: var(--fx-type-weights-strong) }
.docs-live { display: flex; flex-direction: column; gap: var(--fx-dens-gap-sm) }
.docs-live iframe { width: 100%; aspect-ratio: 16 / 10; border: var(--fx-border-w) solid var(--fx-border); border-radius: var(--fx-radius-md); background: var(--fx-surface) }
.docs-chips { display: flex; flex-wrap: wrap; gap: var(--fx-dens-gap-xs); margin: 0 }
.docs-chip { padding: 0 var(--fx-dens-gap-sm); border-radius: var(--fx-radius-sm); background: var(--fx-surface2); font-size: var(--fx-type-scale-xs) }
.docs-search { display: flex; gap: var(--fx-dens-gap-sm); align-items: center }
.docs-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--fx-dens-gap-xs); font-size: var(--fx-type-scale-sm) }
.docs-out { white-space: pre-wrap; max-height: calc(var(--fx-row-h) * 12); }
.docs-mark { background: color-mix(in srgb, var(--fx-accent) calc(var(--fx-opacity-tint) * 100%), transparent); color: inherit }
.docs-foot { color: var(--fx-muted); font-size: var(--fx-type-scale-xs); border-top: var(--fx-border-w) solid var(--fx-border); padding-top: var(--fx-dens-gap-md) }
a { color: var(--fx-accent) }
`;

/* ================================================================== the runtime (TypeScript source; compiled to JS) */

const DOCS_TS = `/** Interactive documentation runtime (docs@1, interactive-html-ts). Search, collapsing, runnable read-only API examples, keyboard navigation. */
interface Example { id: string; kind: 'rest' | 'mcp' | 'cli'; name: string; method: string; path: string; snippet: string; runnable: boolean; item: string }
interface SearchHit { ref: string; title: string; kind: string; summary: string; path: string }
interface Book { title: string; consoleOrigin: string; generatedAt: string }
const root: string = (document.documentElement.dataset.root ?? '').replace(/\\/?$/, '/');
const load = async <T,>(file: string): Promise<T> => (await fetch(root + 'data/' + file, { cache: 'no-store' })).json() as Promise<T>;
const TOKEN_KEY = 'axf-docs-console-token';
let examples: Example[] = [];
let hits: SearchHit[] = [];
let book: Book | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

/** Search over every item of the book (data/search.json): every word must match; matches are listed under the box. */
function installSearch(): void {
  const box = document.querySelector<HTMLInputElement>('[data-docs-search]');
  const out = document.querySelector<HTMLUListElement>('[data-docs-hits]');
  if (!box || !out) return;
  box.addEventListener('input', () => {
    const words = box.value.toLowerCase().split(/\\s+/).filter(Boolean);
    out.replaceChildren();
    if (!words.length) return;
    for (const h of hits.filter((x) => words.every((w) => (x.title + ' ' + x.summary + ' ' + x.kind + ' ' + x.ref).toLowerCase().includes(w))).slice(0, 30)) {
      const li = el('li'); const a = el('a', '', h.title); a.href = root + h.path; const k = el('span', 'docs-kind', h.kind); const s = el('span', 'docs-muted', ' ' + h.summary);
      li.append(a, ' ', k, s); out.append(li);
    }
  });
}

/** Every API example gets a Run button when it is a read (GET) against the console; the token is asked once per session. */
function installExamples(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-example]')) {
    const ex = examples.find((x) => x.id === node.dataset.example);
    if (!ex || !ex.runnable) continue;
    const bar = el('div', 'docs-example__bar');
    const run = el('button', 'docs-btn docs-btn--primary', 'Run'); run.type = 'button';
    const out = el('pre', 'docs-out'); out.hidden = true;
    run.addEventListener('click', async () => {
      const origin = book?.consoleOrigin || location.origin;
      let token = sessionStorage.getItem(TOKEN_KEY) ?? '';
      if (!token) { token = prompt('Console token (kept in this tab only):') ?? ''; if (!token) return; sessionStorage.setItem(TOKEN_KEY, token); }
      out.hidden = false; out.textContent = 'Running ' + ex.method + ' ' + ex.path + ' …';
      try {
        const r = await fetch(origin + ex.path, { headers: { Authorization: 'Bearer ' + token } });
        const text = await r.text();
        out.textContent = r.status + ' ' + r.statusText + '\\n' + text.slice(0, 4000);
      } catch (e) { out.textContent = 'Failed: ' + (e as Error).message; }
    });
    bar.append(run); node.append(bar, out);
  }
}

/** Keyboard: / focuses search, [ and ] move between items, Escape clears. */
function installKeys(): void {
  const items = () => Array.from(document.querySelectorAll<HTMLElement>('.docs-item'));
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) { if (e.key === 'Escape') (t as HTMLInputElement).blur(); return; }
    if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('[data-docs-search]')?.focus(); }
    if (e.key === ']' || e.key === '[') { const all = items(); const at = all.findIndex((x) => x.contains(document.activeElement)); const next = all[Math.max(0, Math.min(all.length - 1, at + (e.key === ']' ? 1 : -1)))]; next?.scrollIntoView({ block: 'start' }); next?.querySelector<HTMLElement>('summary')?.focus(); }
  });
}

async function main(): Promise<void> {
  try { [examples, hits, book] = await Promise.all([load<Example[]>('examples.json').catch(() => []), load<SearchHit[]>('search.json').catch(() => []), load<Book>('book.json').catch(() => null)]); } catch { /* static pages still read fine */ }
  installSearch(); installExamples(); installKeys();
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.docs-item')) if (location.hash && d.id === location.hash.slice(1)) d.open = true;
  const mark = document.querySelector<HTMLElement>('[data-docs-ready]'); if (mark) mark.textContent = examples.length + ' runnable examples · ' + hits.length + ' searchable items';
}
void main();
export {};
`;

const LIVE_TS = `/** Live components (docs@1, interactive live): the real screen of an item, in a frame of the console, shown on demand. */
interface Book { consoleOrigin: string }
const root: string = (document.documentElement.dataset.root ?? '').replace(/\\/?$/, '/');
async function main(): Promise<void> {
  let origin = location.origin;
  try { origin = ((await (await fetch(root + 'data/book.json', { cache: 'no-store' })).json()) as Book).consoleOrigin || origin; } catch { /* the docs' own origin then */ }
  for (const host of document.querySelectorAll<HTMLElement>('[data-live-view]')) {
    const view = host.dataset.liveView ?? '';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'docs-btn'; btn.textContent = 'Show it live';
    btn.addEventListener('click', () => {
      if (host.querySelector('iframe')) { host.quervarySelectorAll; return; }
      const f = document.createElement('iframe'); f.title = view; f.loading = 'lazy';
      f.src = origin + '/?axf-view=' + encodeURIComponent(view) + '&axf-embed=docs';
      host.append(f); btn.textContent = 'Live: ' + view;
    });
    host.prepend(btn);
  }
}
void main();
export {};
`.replace("host.quervarySelectorAll; return;", 'return;');

/** TypeScript → JavaScript with the console's TypeScript when present, else a careful strip of the annotations used above. */
export function compileTs(src) {
  try {
    const req = createRequire(join(ROOT, 'apps/console-web/package.json'));
    const ts = req('typescript');
    return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false } }).outputText;
  } catch {
    return src
      .replace(/^interface [\s\S]*?\n}\n/gm, '')
      .replace(/<K extends keyof HTMLElementTagNameMap>|<T,>|<T>|<HTMLInputElement>|<HTMLUListElement>|<HTMLElement>|<HTMLDetailsElement>|<Example\[\]>|<SearchHit\[\]>|<Book>|<HTMLElementTagNameMap\[K\]>/g, '')
      .replace(/\): [A-Za-z<>\[\]| ,.]+(?= =>| \{)/g, ')')
      .replace(/: (string|number|boolean|void|Promise<[^>]+>|HTMLElement \| null|Example\[\]|SearchHit\[\]|Book \| null|K|E)(?=[ ,)=;])/g, '')
      .replace(/ as [A-Za-z<>\[\]| .]+(?=[;,)\]])/g, '')
      .replace(/export \{\};\n?/g, '');
  }
}

/* ================================================================== content */

const API_LABEL = { rest: 'REST', mcp: 'MCP tool', cli: 'Command line' };

/** One item of a chapter, resolved: the entry's facts (glossary) or the asset's (demonstration, clip, book chapter). */
function itemModel(ref) {
  const r = R.parseRef(ref);
  if (!r) return null;
  const base = { ref, key: fileKey(ref), kind: r.kind, title: ref, summary: '', detail: '', where: [], api: [], related: [], children: [], steps: [], seconds: 0, view: '' };
  if (r.kind === 'entry') {
    const e = lookup(r.id);
    if (!e) return { ...base, title: r.id, summary: 'This entry is no longer in the glossary.', missing: true };
    const rel = (ids) => (ids ?? []).map((id) => lookup(id)).filter(Boolean).map((x) => ({ id: x.id, term: x.term, kind: x.kind, summary: x.summary }));
    const demo = R.demonstrationFromEntry(e, { lookup });
    return { ...base, entryKind: e.kind, title: e.term, summary: e.summary, detail: e.detail ?? '', where: [e.app, ...(e.where ?? []).filter((w) => !w.includes(':'))].filter(Boolean), api: e.api ?? [], related: rel(e.related), children: rel(e.children), steps: demo.data.steps, seconds: R.demonstrationSeconds(demo.data), source: e.source ?? '', category: e.category, keywords: e.keywords ?? [], view: R.viewOf(e, lookup), plugin: e.plugin ?? '' };
  }
  const a = get(r.kind, r.id);
  if (!a) return { ...base, summary: `No ${r.kind} ${r.id} any more.`, missing: true };
  if (r.kind === 'demonstration') { const d = R.normalizeDemonstration(a.data); return { ...base, title: a.name, summary: a.description ?? '', steps: d.steps, seconds: R.demonstrationSeconds(d), related: d.entries.map((id) => lookup(id)).filter(Boolean).map((x) => ({ id: x.id, term: x.term, kind: x.kind, summary: x.summary })), keywords: d.keywords }; }
  if (r.kind === 'clip') { const d = R.normalizeClip(a.data); return { ...base, title: a.name, summary: a.description ?? '', steps: d.transcript.map((t) => ({ say: t.say, do: '', target: '', title: `${Math.round(t.at)} s` })), seconds: d.media.seconds, media: d.media, recorded: d.recorded, keywords: d.keywords }; }
  const res = resolveRef(ref);
  return { ...base, title: res?.title ?? a.name, summary: a.description ?? '', steps: res?.steps ?? [] };
}

/** What the docs are about: a book's chapters, one demonstration as one chapter, or a list of entries as one chapter. */
function chaptersOf(source) {
  if (source.kind === 'book') {
    const a = get('book', source.id);
    if (!a) throw new Error(`no book ${source.id}`);
    const d = R.normalizeBook(a.data); const m = R.bookMinutes(d);
    return { id: a.id, title: a.name, about: a.description || d.about, plan: d.plan, docs: d.docs, chapters: d.chapters.map((c, i) => ({ id: c.id, title: c.title, intro: c.intro, minutes: m.chapters[i].minutes, items: c.items })) };
  }
  if (source.kind === 'demonstration') {
    const a = get('demonstration', source.id);
    if (!a) throw new Error(`no demonstration ${source.id}`);
    return { id: a.id, title: a.name, about: a.description ?? '', chapters: [{ id: 'demonstration', title: a.name, intro: '', minutes: Math.round(R.demonstrationSeconds(a.data) / 60 * 10) / 10, items: [{ ref: `demonstration/${a.id}` }, ...R.normalizeDemonstration(a.data).entries.map((ref) => ({ ref }))] }] };
  }
  const entries = (source.entries ?? []).filter((id) => lookup(id));
  if (!entries.length) throw new Error('no glossary entries to document');
  const title = entries.length === 1 ? lookup(entries[0]).term : `${entries.length} glossary entries`;
  return { id: `entries-${createHash('sha256').update(entries.join('|')).digest('hex').slice(0, 8)}`, title, about: '', chapters: [{ id: 'entries', title, intro: '', minutes: 0, items: entries.map((ref) => ({ ref })) }] };
}

/* ================================================================== rendering */

const snippetFor = (a, origin) => {
  if (a.kind === 'rest') { const [method = 'GET', path = ''] = a.name.split(' '); return { method, path, snippet: method === 'GET' ? `curl -H "Authorization: Bearer $AXF_TOKEN" ${origin}${path}` : `curl -X ${method} -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" -d '{}' ${origin}${path}`, runnable: method === 'GET' }; }
  if (a.kind === 'mcp') return { method: '', path: '', snippet: `# MCP (AmberX-AXF console server)\n${a.name} {}`, runnable: false };
  return { method: '', path: '', snippet: a.name, runnable: false };
};

function examplesOf(items, origin) {
  const out = [];
  for (const it of items) for (const [i, a] of (it.api ?? []).entries()) { const s = snippetFor(a, origin); out.push({ id: `${it.key}-${i}`, kind: a.kind, name: a.name, item: it.ref, ...s }); }
  return out;
}

function itemHtml(it, { depth, interactive, includeApi, includeScreens, origin, rel, open }) {
  const level = R.DEMO_ENUMS.docsDepth.indexOf(depth);
  const parts = [];
  parts.push(`<p>${esc(it.summary)}</p>`);
  if (it.detail && it.detail !== it.summary) parts.push(`<p>${esc(it.detail)}</p>`);
  const facts = [];
  if (it.where?.length) facts.push(['Appears in', [...new Set(it.where)].join(', ')]);
  if (it.category) facts.push(['Filed under', it.category.split('›').map((s) => s.trim()).join(' › ')]);
  if (it.plugin) facts.push(['Plugin', it.plugin]);
  if (it.seconds) facts.push(['Plays for', `${Math.round(it.seconds)} s`]);
  if (it.media?.video) facts.push(['Video', it.media.video]);
  if (it.source && level >= 2) facts.push(['Defined in', it.source]);
  facts.push(['Id', it.ref]);
  parts.push(`<dl class="docs-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === 'Id' || k === 'Defined in' || k === 'Video' ? ' class="docs-mono"' : ''}>${esc(v)}</dd>`).join('')}</dl>`);
  if (includeApi && it.api?.length && level >= 1) {
    parts.push(`<h4>API</h4><table class="docs-api"><thead><tr><th>Through</th><th>Call</th></tr></thead><tbody>${it.api.map((a) => `<tr><td>${esc(API_LABEL[a.kind] ?? a.kind)}</td><td><code>${esc(a.name)}</code></td></tr>`).join('')}</tbody></table>`);
    if (interactive !== 'none' && level >= 2) parts.push(`<h4>Try it</h4>${it.api.map((a, i) => { const s = snippetFor(a, origin); return `<div class="docs-example" data-example="${esc(`${it.key}-${i}`)}"><pre><code>${esc(s.snippet)}</code></pre></div>`; }).join('')}`);
  }
  if (includeScreens && interactive === 'live' && it.view) parts.push(`<h4>Live</h4><div class="docs-live" data-live-view="${esc(it.view)}"><p class="docs-muted">The real ${esc(it.title)} screen, with real data, from the console.</p></div>`);
  if (level >= 2 && it.steps?.length) parts.push(`<h4>Walkthrough</h4><ol class="docs-steps">${it.steps.map((s) => `<li>${s.title ? `<strong>${esc(s.title)}.</strong> ` : ''}${esc(s.say)}${s.do || s.target ? ` <span class="docs-muted docs-mono">${esc([s.do && `do ${s.do}`, s.target && `target ${s.target}`].filter(Boolean).join(' · '))}</span>` : ''}</li>`).join('')}</ol>`);
  if (level >= 2 && it.children?.length) parts.push(`<h4>Contains</h4><ul>${it.children.slice(0, 60).map((c) => `<li><strong>${esc(c.term)}</strong> <span class="docs-kind">${esc(c.kind)}</span> <span class="docs-muted">${esc(c.summary)}</span></li>`).join('')}</ul>`);
  if (it.related?.length) parts.push(`<h4>See also</h4><p class="docs-chips">${it.related.slice(0, 20).map((c) => `<span class="docs-chip">${esc(c.term)}</span>`).join('')}</p>`);
  if (level >= 3 && it.keywords?.length) parts.push(`<p class="docs-chips">${it.keywords.slice(0, 40).map((k) => `<span class="docs-chip">${esc(k)}</span>`).join('')}</p>`);
  return `<details class="docs-item" id="${esc(it.key)}"${open ? ' open' : ''}><summary><span class="docs-kind">${esc(it.entryKind ?? it.kind)}</span> ${esc(it.title)}</summary>${parts.join('\n')}</details>`;
}

function itemMd(it, { depth, includeApi }) {
  const level = R.DEMO_ENUMS.docsDepth.indexOf(depth);
  const out = [`### ${it.title}`, '', `*${it.entryKind ?? it.kind}* — ${it.summary}`, ''];
  if (it.detail && it.detail !== it.summary) out.push(it.detail, '');
  if (it.where?.length) out.push(`- Appears in: ${[...new Set(it.where)].join(', ')}`);
  if (it.category) out.push(`- Filed under: ${it.category}`);
  out.push(`- Id: \`${it.ref}\``, '');
  if (includeApi && it.api?.length && level >= 1) out.push('| Through | Call |', '| --- | --- |', ...it.api.map((a) => `| ${API_LABEL[a.kind] ?? a.kind} | \`${a.name}\` |`), '');
  if (level >= 2 && it.steps?.length) out.push('Walkthrough:', '', ...it.steps.map((s, i) => `${i + 1}. ${s.title ? `**${s.title}.** ` : ''}${s.say}`), '');
  if (level >= 2 && it.children?.length) out.push('Contains:', '', ...it.children.slice(0, 60).map((c) => `- **${c.term}** (${c.kind}): ${c.summary}`), '');
  if (it.related?.length) out.push(`See also: ${it.related.slice(0, 20).map((c) => c.term).join(', ')}`, '');
  return out.join('\n');
}

function page({ title, eyebrow, body, nav, rel, interactive, generatedAt, current }) {
  const scripts = interactive ? `<script type="module" src="${rel}docs.js"></script>${interactive === 'live' ? `<script type="module" src="${rel}live.js"></script>` : ''}` : '';
  return `<!doctype html>
<html lang="en" data-root="${esc(rel)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="${rel}data/tokens.css"><link rel="stylesheet" href="${rel}docs.css"></head>
<body data-nav="${nav ? 'on' : 'off'}">
${nav ? `<nav class="docs-nav" aria-label="Contents"><h2><a href="${rel}index.html">${esc(nav.title)}</a></h2>${interactive ? `<div class="docs-search"><input class="docs-input" type="search" placeholder="Search (/)" aria-label="Search the documentation" data-docs-search></div><ul class="docs-hits" data-docs-hits></ul>` : ''}<ul>${nav.chapters.map((c) => `<li><a href="${rel}${c.path}"${current === c.path ? ' aria-current="page"' : ''}>${esc(c.title)}</a>${c.items?.length ? `<ul>${c.items.map((it) => `<li><a href="${rel}${it.path}">${esc(it.title)}</a></li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></nav>` : ''}
<main class="docs-main">${eyebrow ? `<p class="docs-eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(title)}</h1>
${body}
<p class="docs-foot">Generated ${esc(generatedAt)} from the AmberX AXF glossary, index and registry (docs@1). <span data-docs-ready></span></p></main>
${scripts}
</body></html>
`;
}

/* ================================================================== generate */

/**
 * Generate the documentation of a source: { source: { kind: book | demonstration | entries, id?, entries? }, options:
 * { depth, format, interactive, includeApi?, includeScreens? }, build?, tokens? (the live --fx-* values), consoleOrigin?,
 * out? }. Writes the files and saves the docs@1 asset. Returns the asset.
 */
export function generateDocs({ source, options = {}, build = '', tokens, consoleOrigin = '', out } = {}) {
  if (!source || !R.DEMO_ENUMS.docsSource.includes(source.kind)) throw new Error('source.kind must be book, demonstration or entries');
  const src = chaptersOf(source);
  const fromBook = src.docs ?? {};
  const o = R.normalizeDocsOptions({ ...fromBook, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== '')), enabled: true });
  const plan = R.docsPlan(o, src.chapters);
  const level = R.DEMO_ENUMS.docsDepth.indexOf(o.depth);
  const md = o.format === 'markdown'; const x = md ? 'md' : 'html';
  const interactive = o.format === 'interactive-html-ts' ? o.interactive : 'none';
  const docsId = R.slugify(`docs-${src.id}`, 'docs');
  const dir = out || join(DOCS_OUT, docsId);
  const generatedAt = new Date().toISOString();
  const origin = consoleOrigin || 'http://127.0.0.1:7090';

  // resolve every item once
  const models = new Map();
  const chapters = src.chapters.map((c) => ({ ...c, path: `chapters/${fileKey(c.id)}.${x}`, items: c.items.map((it) => { if (!models.has(it.ref)) models.set(it.ref, itemModel(it.ref)); return { ...it, model: models.get(it.ref), path: `items/${fileKey(it.ref)}.${x}` }; }).filter((it) => it.model) }));
  const allItems = [...models.values()].filter(Boolean);
  const nav = level >= 1 ? { title: src.title, chapters: chapters.map((c) => ({ title: c.title, path: c.path, items: level >= 2 ? c.items.map((it) => ({ title: it.model.title, path: it.path })) : [] })) } : null;
  const ctx = { depth: o.depth, interactive, includeApi: o.includeApi, includeScreens: o.includeScreens, origin, generatedAt };

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  const written = [];
  const write = (path, content, kind, title = '') => { const f = join(dir, path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); written.push({ path, kind, title, bytes: statSync(f).size }); };

  // index
  const about = src.about ? (md ? `${src.about}\n\n` : `<p>${esc(src.about)}</p>`) : '';
  const plan_ = src.plan ? (md ? `*${src.plan.style}* · ${chapters.length} chapters · ${Math.round(chapters.reduce((s, c) => s + (c.minutes || 0), 0))} min\n\n` : `<p class="docs-muted">${esc(src.plan.style)} · ${chapters.length} chapters · ${Math.round(chapters.reduce((s, c) => s + (c.minutes || 0), 0))} min</p>`) : '';
  if (md) {
    const body = [`# ${src.title}`, '', about + plan_, ...chapters.flatMap((c) => level >= 1
      ? [`- [${c.title}](${c.path}) (${c.items.length} items${c.minutes ? `, ${Math.round(c.minutes)} min` : ''})`]
      : [`## ${c.title}`, '', c.intro ? `${c.intro}\n` : '', ...c.items.map((it) => `- **${it.model.title}** (${it.model.entryKind ?? it.model.kind}): ${it.model.summary}`), ''])];
    write(`index.${x}`, `${body.join('\n')}\n`, 'index', 'Contents');
  } else {
    const body = about + plan_ + chapters.map((c) => level >= 1
      ? `<h2><a href="${c.path}">${esc(c.title)}</a></h2>${c.intro ? `<p>${esc(c.intro)}</p>` : ''}<p class="docs-muted">${c.items.length} items${c.minutes ? ` · ${Math.round(c.minutes)} min` : ''}</p><ul>${c.items.map((it) => `<li>${level >= 2 ? `<a href="${it.path}">${esc(it.model.title)}</a>` : `<strong>${esc(it.model.title)}</strong>`} <span class="docs-kind">${esc(it.model.entryKind ?? it.model.kind)}</span> <span class="docs-muted">${esc(it.model.summary)}</span></li>`).join('')}</ul>`
      : `<h2>${esc(c.title)}</h2>${c.intro ? `<p>${esc(c.intro)}</p>` : ''}${c.items.map((it) => itemHtml(it.model, { ...ctx, rel: '', open: true })).join('\n')}`).join('\n');
    write(`index.${x}`, page({ title: src.title, eyebrow: 'Documentation · contents', body, nav, rel: '', interactive, generatedAt, current: 'index.html' }), 'index', 'Contents');
  }
  // chapters
  if (level >= 1) for (const c of chapters) {
    if (md) write(c.path, `# ${c.title}\n\n${c.intro ? `${c.intro}\n\n` : ''}${c.items.map((it) => (level >= 2 ? `- [${it.model.title}](../${it.path}): ${it.model.summary}` : itemMd(it.model, ctx))).join('\n\n')}\n`, 'page', c.title);
    else write(c.path, page({ title: c.title, eyebrow: `${src.title} · chapter`, body: `${c.intro ? `<p>${esc(c.intro)}</p>` : ''}${c.items.map((it) => itemHtml(it.model, { ...ctx, rel: '../', open: level < 2 })).join('\n')}`, nav, rel: '../', interactive, generatedAt, current: c.path }), 'page', c.title);
  }
  // items
  if (level >= 2) for (const it of allItems) {
    const path = `items/${it.key}.${x}`;
    if (md) write(path, `${itemMd(it, ctx)}\n`, 'page', it.title);
    else write(path, page({ title: it.title, eyebrow: `${src.title} · ${it.entryKind ?? it.kind}`, body: itemHtml(it, { ...ctx, rel: '../', open: true }), nav, rel: '../', interactive, generatedAt, current: path }), 'page', it.title);
  }
  // styles, tokens, runtime, data
  if (!md) {
    write('docs.css', DOCS_CSS, 'style', 'Styles (theme tokens)');
    write('data/tokens.css', tokensCss(tokens && Object.keys(tokens).length ? tokens : defaultTokens()), 'data', tokens ? 'Theme tokens (the live console look)' : 'Theme tokens (framework defaults)');
  }
  if (o.format === 'interactive-html-ts') {
    write('docs.ts', DOCS_TS, 'script', 'Interactive runtime (TypeScript)');
    write('docs.js', compileTs(DOCS_TS), 'script', 'Interactive runtime (compiled)');
    write('data/book.json', `${JSON.stringify({ $axf: 'docs-book@1', title: src.title, about: src.about, consoleOrigin: origin, generatedAt, depth: o.depth, interactive, chapters: chapters.map((c) => ({ id: c.id, title: c.title, intro: c.intro, minutes: c.minutes, path: c.path, items: c.items.map((it) => ({ ref: it.ref, title: it.model.title, kind: it.model.entryKind ?? it.model.kind, summary: it.model.summary, path: it.path, minutes: it.minutes ?? 0, note: it.note ?? '' })) })) }, null, 1)}\n`, 'data', 'The book and its entries');
    if (level >= 3 || interactive !== 'none') write('data/examples.json', `${JSON.stringify(examplesOf(allItems, origin), null, 1)}\n`, 'data', 'Runnable API examples');
    if (interactive === 'live') { write('live.ts', LIVE_TS, 'script', 'Live components (TypeScript)'); write('live.js', compileTs(LIVE_TS), 'script', 'Live components (compiled)'); }
  }
  if (level >= 3) write('data/search.json', `${JSON.stringify(allItems.map((it) => ({ ref: it.ref, title: it.title, kind: it.entryKind ?? it.kind, summary: it.summary, path: level >= 2 ? `items/${it.key}.${x}` : `index.${x}` })), null, 0)}\n`, 'data', 'Search index');

  // the plan is the contract: every planned file was written (extra data files are fine)
  const planned = new Set(plan.files.map((f) => f.path));
  const missing = [...planned].filter((p) => !written.some((w) => w.path === p));
  if (missing.length) throw new Error(`docs plan not met: ${missing.join(', ')}`);

  const sourceHash = createHash('sha256').update(JSON.stringify({ chapters: src.chapters, items: allItems.map((it) => [it.ref, it.title, it.summary, it.detail, it.api, it.steps]) })).digest('hex').slice(0, 16);
  const data = R.normalizeDocs({
    source: { kind: source.kind, id: source.kind === 'entries' ? '' : src.id, entries: source.kind === 'entries' ? source.entries : [] },
    depth: o.depth, format: o.format, interactive, files: written, generatedAt, sourceHash, build,
    keywords: R.autoKeywords(['documentation', 'docs', o.depth, o.format, interactive, src.title, src.about, chapters.map((c) => c.title), allItems.map((it) => [it.title, it.keywords ?? []])], 200),
  });
  const asset = envelope('docs', { id: docsId, name: `${src.title} (documentation)`, description: `${R.DOCS_DEPTH_ABOUT[o.depth]} Format ${o.format}${interactive !== 'none' ? `, ${interactive}` : ''}: ${written.length} files for ${chapters.length} chapter${chapters.length === 1 ? '' : 's'} and ${allItems.length} items.`, data, tags: ['docs', 'generated', o.depth, o.format], author: 'Glossary & Index' });
  return out ? asset : save('docs', asset, { reason: 'generated' });
}

async function main(argv) {
  const [cmd, id, ...rest] = argv;
  const flag = (n, d = '') => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] ?? d : d; };
  if (cmd === 'generate-from' && id) { const r = readJson(id); const a = generateDocs({ source: r.source, options: r.options ?? {}, build: r.build ?? '', tokens: r.tokens, consoleOrigin: r.consoleOrigin ?? '' }); process.stdout.write(`${JSON.stringify(a)}\n`); return 0; }
  if (cmd !== 'generate' || !id) { console.error('usage: docs.mjs generate <id> [--kind book|demonstration] [--depth d] [--format f] [--interactive i] [--out <dir>] [--json] | generate-from <file.json>'); return 2; }
  const a = generateDocs({ source: { kind: flag('--kind', 'book'), id }, options: { depth: flag('--depth'), format: flag('--format'), interactive: flag('--interactive') }, build: flag('--build'), out: flag('--out') || undefined });
  if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(a)}\n`); else console.log(`docs: ${a.name} — ${a.data.files.length} files (${a.data.depth}, ${a.data.format}) in ${flag('--out') || join(DOCS_OUT, a.id)}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exit(await main(process.argv.slice(2))); } catch (e) { console.error(`docs: ${e.message}`); process.exit(1); }
}
export { HERE };

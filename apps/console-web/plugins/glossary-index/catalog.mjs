#!/usr/bin/env node
/**
 * Glossary & Index catalog (glossary-catalog@1, plugin-local): one entry for every plugin, feature, screen, control,
 * setting, command, asset, asset type, CLI tool, build option, job type and core concept in AmberX AXF, built only from
 * what the repo already registers, so it never needs a hand-kept list:
 *
 *   - concepts         plugins/glossary-index/terms.json (the hand-written definitions: asset@1, hot-swap, veto call, …)
 *   - plugins          apps/console-web/plugins/<folder>/plugin.json (+ its declared commands = REST / MCP / CLI)
 *   - controls         every help@1 entry (framework chrome, Dev Console + plugins, axHub web): buttons, switches,
 *                      settings, tabs, columns, screens, menu items…
 *   - assets           framework/assets/<type>/*.json, and asset types from framework/schemas/asset-types.json
 *   - demos            demonstrations, books, clips and docs (demonstration@1, book@1, clip@1, docs@1): the framework's
 *                      starters and every one made in the console (this plugin's data folder, <type>/<id>.json)
 *   - CLI tools        framework/cli/*.mjs (first line of the header comment)
 *   - build options    framework/schemas/build-options.json
 *   - features         framework/catalog/catalog.json (the feature tracker)
 *   - UI registry      apps/<app>/src/assets/ui-registry/*.json when an app ships one (ui-registry@1)
 *
 *   node apps/console-web/plugins/glossary-index/catalog.mjs build        rebuild the catalog in the plugin's data folder
 *                                                                   (.axf-console/plugins/glossary, not in git) + change log
 *   node apps/console-web/plugins/glossary-index/catalog.mjs --check      CI: every registered item has an entry with a summary;
 *                                                                   items without a description of their own never grow
 *   node apps/console-web/plugins/glossary-index/catalog.mjs --update-ratchet   lower that allowance after describing things
 *   node apps/console-web/plugins/glossary-index/catalog.mjs changes      what each rebuild added, changed and removed
 *   node apps/console-web/plugins/glossary-index/catalog.mjs stats        counts per kind and category
 *   node apps/console-web/plugins/glossary-index/catalog.mjs search <q>   matching entries (term, summary, keywords)
 *   node apps/console-web/plugins/glossary-index/catalog.mjs get <id>     one entry, with what links to it
 *   node apps/console-web/plugins/glossary-index/catalog.mjs --json       the whole catalog on stdout
 *
 * No model, no network, no tokens. The orchestrator's post-build hook runs `build` so the catalog follows every build.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.AXF_REPO_ROOT || join(HERE, '../../../..');
/** The built catalog lives in the plugin's data folder (plugin-lifecycle@1 dataDir), never in git: it is rebuilt on demand. */
export const DATA_DIR = process.env.AXF_GLOSSARY_DIR || join(ROOT, '.axf-console/plugins/glossary-index');
export const CATALOG_FILE = join(DATA_DIR, 'catalog.json');
export const CHANGES_FILE = join(DATA_DIR, 'changes.json');
/** The completeness ratchet (committed): how many entries may still fall back to a generated summary. Only goes down. */
export const RATCHET_FILE = join(HERE, 'coverage.json');
export const TERMS_FILE = join(HERE, 'terms.json');
export const FRAME = 'glossary-catalog@1';

/** Every kind an entry can be, in index order, with the label the views show. Open list: add a kind at the end. */
export const KINDS = {
  concept: 'Concept',
  plugin: 'Plugin',
  feature: 'Feature',
  screen: 'Screen',
  control: 'Control',
  setting: 'Setting',
  command: 'Command',
  'asset-type': 'Asset type',
  asset: 'Asset',
  cli: 'CLI tool',
  'build-option': 'Build option',
  'job-type': 'Job type',
  'ui-element': 'UI element',
  demonstration: 'Demonstration',
  book: 'Book',
  clip: 'Clip',
  docs: 'Documentation',
};
/** Asset types that are glossary kinds of their own (demonstration@1, book@1, clip@1, docs@1: the demo system's registry assets). */
export const DEMO_KINDS = new Set(['demonstration', 'book', 'clip', 'docs']);

/** Help scopes read for controls, and the app each belongs to. */
const HELP_SCOPES = [
  { scope: 'framework', app: 'Framework', dirs: ['framework/assets/help'], plugins: null },
  { scope: 'console-web', app: 'Dev Console', dirs: ['apps/console-web/src/assets/help'], plugins: 'apps/console-web/plugins' },
  { scope: 'axhub-web', app: 'axHub web', dirs: ['apps/axhub-web/src/assets/help'], plugins: 'apps/axhub-web/src/plugins' },
];
const HELP_KIND_TO_KIND = { screen: 'screen', toggle: 'setting', slider: 'setting', field: 'setting' };
const UI_REGISTRY_APPS = ['console-web', 'axhub-web', 'amberx-droid', 'walkthrough-studio', 'molly', 'demo'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => join(dir, n)) : []);
const clean = (s, n = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const STOP = new Set('the a an and or of to in on for is it its as by at be with from this that are was not no can any every each one into than then when what which who how your you his her their our out up all also only more most so do does use used uses'.split(' '));

/** First sentence (or the first `n` characters, cut on a word). */
export function firstSentence(s, n = 220) {
  const t = clean(s, 2000);
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const one = m ? m[1] : t;
  if (one.length <= n) return one;
  return `${one.slice(0, n).replace(/\s+\S*$/, '')}…`;
}

/** Keywords for search and auto-tagging: words of the term, category and summary, minus stop words, deduped. */
export function keywordsFor(...parts) {
  const out = new Set();
  for (const p of parts.flat()) {
    for (const w of String(p ?? '').toLowerCase().split(/[^a-z0-9@.-]+/)) {
      const k = w.replace(/^[.-]+|[.-]+$/g, '');
      if (k.length > 2 && !STOP.has(k) && !/^\d+$/.test(k)) out.add(k);
    }
  }
  return [...out].slice(0, 24);
}

const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function entry(e) {
  const term = clean(e.term, 120) || e.id;
  const summary = firstSentence(e.summary || e.detail || '');
  const detail = clean(e.detail, 1600);
  const out = { id: e.id, term, kind: e.kind, category: e.category, summary };
  if (detail && detail !== summary) out.detail = detail;
  if (e.source) out.source = e.source;
  if (e.plugin) out.plugin = e.plugin;
  if (e.app) out.app = e.app;
  if (e.where?.length) out.where = [...new Set(e.where)].slice(0, 12);
  if (e.api?.length) out.api = e.api.slice(0, 40);
  if (e.related?.length) out.related = [...new Set(e.related)].filter((r) => r !== e.id).slice(0, 24);
  if (e.draft) out.draft = true;
  if (e.generic || !clean(e.summary || e.detail)) out.generic = true;
  out.keywords = keywordsFor(term, e.category, summary, e.tags ?? []);
  return out;
}

/* ---------------- sources ---------------- */

function concepts() {
  if (!existsSync(TERMS_FILE)) return [];
  return (readJson(TERMS_FILE).terms ?? []).map((t) => entry({
    id: `concept:${t.id}`, term: t.term, kind: 'concept', category: `Concepts › ${t.group || 'General'}`,
    summary: t.summary, detail: t.detail, source: rel(TERMS_FILE), related: t.related, tags: t.aka,
  }));
}

function pluginEntries() {
  const dir = join(ROOT, 'apps/console-web/plugins');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const folder of readdirSync(dir).filter((n) => !n.startsWith('_') && !n.startsWith('.')).sort()) {
    const pj = join(dir, folder, 'plugin.json');
    if (!existsSync(pj)) continue;
    let p;
    try { p = readJson(pj); } catch { continue; }
    const name = p.name || titleCase(folder);
    const items = Array.isArray(p.commands?.items) ? p.commands.items : [];
    const routes = serverRoutes(join(dir, folder, 'server/__init__.py'));
    const api = [
      ...items.map((c) => ({ kind: 'mcp', name: `${folder.replace(/-/g, '_')}_${String(c.id).replace(/-/g, '_')}`, route: c.route })),
      ...routes.map((r) => ({ kind: 'rest', name: `${r.method} /api/plugins/${folder}${r.path}` })),
      { kind: 'cli', name: `axf ${folder} …` },
    ];
    const provides = (p.provides ?? []).map(String);
    out.push(entry({
      id: `plugin:${folder}`, term: name, kind: 'plugin', category: `Plugins › ${name}`, plugin: folder, app: 'Dev Console',
      summary: p.description, detail: p.description, source: rel(pj), api,
      where: provides.filter((x) => /^(view|settings-tab|dialog|banner):/.test(x)),
      tags: [folder, ...provides],
    }));
    for (const c of items) {
      if (!c?.id) continue;
      out.push(entry({
        id: `command:${folder}:${c.id}`, term: c.title || titleCase(c.id), kind: 'command', category: `Plugins › ${name} › Commands`,
        plugin: folder, app: 'Dev Console', summary: c.description || c.title || titleCase(c.id), generic: !c.description, detail: c.description, source: rel(pj),
        api: [{ kind: 'rest', name: `${c.route?.split(' ')[0] || 'GET'} /api/plugins/${folder}${c.route?.split(' ')[1] || `/${c.id}`}` }, { kind: 'mcp', name: `${folder.replace(/-/g, '_')}_${String(c.id).replace(/-/g, '_')}` }, { kind: 'cli', name: `axf ${folder} ${c.id}` }],
        related: [`plugin:${folder}`], tags: [c.readOnly ? 'read-only' : 'changes'],
      }));
    }
  }
  return out;
}

/** `@router.get("/x")` routes of a plugin's server part (the same static read plugin-commands does). */
function serverRoutes(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const m of readFileSync(file, 'utf8').matchAll(/@router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) out.push({ method: m[1].toUpperCase(), path: m[2] });
  return out.slice(0, 40);
}

function pluginNames() {
  const dir = join(ROOT, 'apps/console-web/plugins');
  const names = {};
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir)) {
    const pj = join(dir, f, 'plugin.json');
    if (existsSync(pj)) { try { names[f] = readJson(pj).name || titleCase(f); } catch { /* skipped */ } }
  }
  return names;
}

function helpEntries() {
  const names = pluginNames();
  const out = [];
  const seen = new Set();
  const load = (file, sc, plugin) => {
    let raw;
    try { raw = readJson(file); } catch { return; }
    if (raw?.$axf !== 'asset@1' || raw.type !== 'help') return;
    const where = plugin ? `Plugins › ${names[plugin] || titleCase(plugin)}` : `${sc.app}`;
    for (const h of raw.data?.entries ?? []) {
      const target = String(h.target ?? h.id ?? '').trim();
      if (!target || !h.title || !h.text) continue;
      const id = `${HELP_KIND_TO_KIND[h.kind] === 'screen' ? 'screen' : 'control'}:${sc.scope}:${plugin ? `${plugin}:` : ''}${target}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const kind = HELP_KIND_TO_KIND[h.kind] || (target.startsWith('view:') ? 'screen' : 'control');
      const group = kind === 'screen' ? 'Screens' : kind === 'setting' ? 'Settings' : 'Controls';
      out.push(entry({
        id, term: h.title, kind, category: `${plugin ? where : `${sc.app} › ${titleCase(raw.data.scope?.split(':').pop() || 'chrome')}`} › ${group}`,
        plugin, app: sc.app, summary: h.text, detail: [h.text, h.more, h.tryIt ? `Try it: ${h.tryIt}` : ''].filter(Boolean).join(' '),
        source: rel(file), where: [sc.app], related: [...(plugin ? [`plugin:${plugin}`] : []), ...(h.related ?? []).map((r) => `control:${sc.scope}:${plugin ? `${plugin}:` : ''}${r}`)],
        draft: h.draft === true, tags: [target, h.kind ?? ''],
      }));
    }
  };
  for (const sc of HELP_SCOPES) {
    for (const d of sc.dirs) for (const f of listJson(join(ROOT, d))) load(f, sc, undefined);
    if (sc.plugins && existsSync(join(ROOT, sc.plugins))) {
      for (const folder of readdirSync(join(ROOT, sc.plugins)).filter((n) => !n.startsWith('_')).sort()) {
        const pj = join(ROOT, sc.plugins, folder, 'plugin.json');
        let file = 'help.json';
        if (existsSync(pj)) { try { file = readJson(pj).help || 'help.json'; } catch { /* plugin checks report it */ } }
        const p = join(ROOT, sc.plugins, folder, file);
        if (existsSync(p)) load(p, sc, sc.scope === 'console-web' ? folder : undefined);
      }
    }
  }
  return out;
}

function assetEntries() {
  const out = [];
  const typesFile = join(ROOT, 'framework/schemas/asset-types.json');
  const types = existsSync(typesFile) ? readJson(typesFile).types ?? {} : {};
  for (const [type, t] of Object.entries(types)) {
    out.push(entry({
      id: `asset-type:${type}`, term: t.label || titleCase(type), kind: 'asset-type', category: `Assets › ${t.group || 'Other'}`,
      summary: t.description || `The ${t.label || type} asset type (asset@1, type "${type}")${t.required?.length ? `: needs ${t.required.join(', ')}` : ''}.`, generic: !t.description,
      source: rel(typesFile), tags: [type, ...(t.required ?? [])],
    }));
  }
  const dir = join(ROOT, 'framework/assets');
  if (existsSync(dir)) {
    for (const type of readdirSync(dir).sort()) {
      const td = join(dir, type);
      if (!statSync(td).isDirectory() || type === 'help') continue;
      for (const f of listJson(td)) {
        let a;
        try { a = readJson(f); } catch { continue; }
        if (!a?.id) continue;
        const kind = type === 'job-type' ? 'job-type' : DEMO_KINDS.has(type) ? type : 'asset';
        const label = types[type]?.label || titleCase(type);
        out.push(entry({
          id: `${kind}:${DEMO_KINDS.has(type) ? '' : `${type}/`}${a.id}`, term: a.name || titleCase(a.id), kind, category: kind === 'job-type' ? 'Agents › Job types' : DEMO_KINDS.has(type) ? `Demos › ${label}s` : `Assets › ${types[type]?.group || 'Other'} › ${label}`,
          summary: a.description || `A ${label.toLowerCase()} asset that ships with the framework.`, generic: !a.description, source: rel(f),
          related: [...(types[type] ? [`asset-type:${type}`] : []), ...demoLinks(type, a.data)], tags: [type, ...(a.tags ?? []), ...(DEMO_KINDS.has(type) ? a.data?.keywords ?? [] : [])],
        }));
      }
    }
  }
  return out;
}

/** What a demo-system asset links to: the entries it is about / covers, the demonstrations and clips a book holds, a clip's source. */
function demoLinks(type, d) {
  if (!d || typeof d !== 'object') return [];
  const out = [];
  if (type === 'demonstration') out.push(...(d.about ? [d.about] : []), ...(d.entries ?? []), ...(d.chain ?? []).map((c) => `demonstration:${c}`));
  if (type === 'book') for (const c of d.chapters ?? []) for (const it of c.items ?? []) { const r = String(it?.ref ?? ''); const m = /^(demonstration|clip|book)\/([a-z0-9-]+)/.exec(r); out.push(m ? `${m[1]}:${m[2]}` : r); }
  if (type === 'clip') out.push(...(d.entries ?? []), ...(d.source?.kind === 'demonstration' && d.source.id ? [`demonstration:${d.source.id}`] : []), ...(d.source?.kind === 'book' && d.source.id ? [`book:${d.source.id}`] : []), ...(d.chain ?? []).map((c) => `clip:${c}`));
  if (type === 'docs') out.push(...(d.source?.kind === 'book' && d.source.id ? [`book:${d.source.id}`] : []), ...(d.source?.kind === 'demonstration' && d.source.id ? [`demonstration:${d.source.id}`] : []), ...(d.source?.entries ?? []));
  return out.filter((x) => typeof x === 'string' && x);
}

/**
 * Demonstrations, books, clips and docs made in the console (the Demonstration Designer and Book Builder keep them as
 * asset@1 files in this plugin's data folder, <dataDir>/<type>/<id>.json): every one is a registry entry too, so it is
 * searchable, filterable and sortable like everything else and droppable into books.
 */
/**
 * Other plugins that keep demonstrations (they provide `service:demonstrations@1`; found by capability, never by
 * folder): their lifecycle data folders are indexed like this plugin's own, so every demo made anywhere is a registry entry.
 */
function demoStoreDirs() {
  const dirs = [DATA_DIR];
  const plugins = join(ROOT, 'apps/console-web/plugins');
  if (!existsSync(plugins)) return dirs;
  for (const folder of readdirSync(plugins).filter((n) => !n.startsWith('_') && !n.startsWith('.')).sort()) {
    const pj = join(plugins, folder, 'plugin.json');
    if (!existsSync(pj)) continue;
    try {
      const p = readJson(pj);
      if ((p.provides ?? []).includes('service:demonstrations@1') && p.lifecycle?.dataDir) dirs.push(join(ROOT, p.lifecycle.dataDir));
    } catch { /* not a plugin */ }
  }
  return [...new Set(dirs)];
}

function demoStoreEntries() {
  const out = [];
  const seen = new Set();
  for (const type of DEMO_KINDS) {
    for (const f of demoStoreDirs().flatMap((d) => listJson(join(d, type)))) {
      if (seen.has(f)) continue;
      seen.add(f);
      let a;
      try { a = readJson(f); } catch { continue; }
      if (a?.$axf !== 'asset@1' || a.type !== type || !a.id) continue;
      const label = KINDS[type];
      const d = a.data ?? {};
      const facts = type === 'clip' ? `${Math.round(d.media?.seconds ?? 0)} s, from ${d.source?.kind ?? 'manual'}${d.source?.id ? ` ${d.source.id}` : ''}.`
        : type === 'demonstration' ? `${(d.steps ?? []).length} steps${d.about ? `, about ${d.about}` : ''}.`
        : type === 'book' ? `${(d.chapters ?? []).length} chapters, ${(d.chapters ?? []).reduce((n, c) => n + (c.items?.length ?? 0), 0)} items.`
        : `${d.depth ?? ''} ${d.format ?? ''}, ${(d.files ?? []).length} files.`;
      out.push(entry({
        id: `${type}:${a.id}`, term: a.name || titleCase(a.id), kind: type, category: `Demos › ${label}s`, app: 'Dev Console',
        summary: a.description || `A ${label.toLowerCase()} made in the console: ${facts}`, detail: a.description ? `${a.description} ${facts}` : '', generic: !a.description,
        source: `${rel(DATA_DIR)}/${type}/${a.id}.json`, where: ['Dev Console'], related: demoLinks(type, d), tags: [type, ...(a.tags ?? []), ...(d.keywords ?? [])],
      }));
    }
  }
  return out;
}

function cliEntries() {
  const dir = join(ROOT, 'framework/cli');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => /\.(mjs|mts)$/.test(n) && !/\.test\./.test(n)).sort()) {
    const src = readFileSync(join(dir, f), 'utf8').slice(0, 4000);
    const head = src.match(/\/\*\*([\s\S]*?)\*\//);
    const text = head ? head[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ') : '';
    const name = f.replace(/\.(mjs|mts)$/, '');
    out.push(entry({
      id: `cli:${name}`, term: `${name} (CLI)`, kind: 'cli', category: 'Tools › Command line',
      summary: text || `The ${name} command-line tool in framework/cli.`, generic: !text, source: `framework/cli/${f}`,
      api: [{ kind: 'cli', name: `node framework/cli/${f}` }], tags: [name],
    }));
  }
  return out;
}

function buildOptionEntries() {
  const f = join(ROOT, 'framework/schemas/build-options.json');
  if (!existsSync(f)) return [];
  const opts = readJson(f).options ?? [];
  const list = Array.isArray(opts) ? opts : Object.entries(opts).map(([id, o]) => ({ id, ...o }));
  return list.filter((o) => o?.id || o?.flag).map((o) => {
    const id = String(o.id || o.flag).replace(/^--/, '');
    return entry({
      id: `build-option:${id}`, term: `--${id}`, kind: 'build-option', category: 'Tools › Build options',
      summary: o.description || o.label || `The --${id} build switch.`, generic: !(o.description || o.label), source: rel(f),
      api: [{ kind: 'cli', name: `axf init --${id}` }], tags: [id, o.token ?? ''],
    });
  });
}

function featureEntries() {
  const f = join(ROOT, 'framework/catalog/catalog.json');
  if (!existsSync(f)) return [];
  const out = [];
  for (const tab of readJson(f).tabs ?? []) {
    for (const g of tab.groups ?? []) {
      for (const it of g.items ?? []) {
        if (!it?.id) continue;
        out.push(entry({
          id: `feature:${it.id}`, term: it.title, kind: 'feature', category: `Features › ${tab.label} › ${clean(g.label, 60)}`,
          summary: it.note || it.title, generic: !it.note, detail: it.note, source: rel(f), tags: [it.id],
        }));
      }
    }
  }
  return out;
}

function uiRegistryEntries() {
  const out = [];
  for (const app of UI_REGISTRY_APPS) {
    for (const f of listJson(join(ROOT, 'apps', app, 'src/assets/ui-registry'))) {
      let a;
      try { a = readJson(f); } catch { continue; }
      const items = a?.data?.items ?? a?.data?.entries ?? [];
      for (const it of Array.isArray(items) ? items : []) {
        if (!it?.id) continue;
        out.push(entry({
          id: `ui-element:${app}:${it.id}`, term: it.label || it.title || it.id, kind: 'ui-element', category: `UI registry › ${titleCase(app)} › ${titleCase(it.kind || 'element')}`,
          summary: it.description || it.help || `${titleCase(it.kind || 'element')} "${it.label || it.id}" in ${app}.`, generic: !(it.description || it.help), source: rel(f),
          app, tags: [it.kind ?? '', ...(it.voice ?? [])],
        }));
      }
    }
  }
  return out;
}

/** Every source, deduped by id (first wins: concepts before generated entries). */
export function collect() {
  const all = [...concepts(), ...pluginEntries(), ...featureEntries(), ...helpEntries(), ...assetEntries(), ...demoStoreEntries(), ...cliEntries(), ...buildOptionEntries(), ...uiRegistryEntries()];
  const seen = new Map();
  for (const e of all) if (!seen.has(e.id)) seen.set(e.id, e);
  const entries = [...seen.values()];
  // back-links: every plugin lists its controls and commands
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    if (e.plugin && e.kind !== 'plugin') {
      const p = byId.get(`plugin:${e.plugin}`);
      if (p) (p.children ??= []).push(e.id);
    }
  }
  for (const e of entries) if (e.related) e.related = e.related.filter((r) => byId.has(r));
  for (const e of entries) if (e.related && !e.related.length) delete e.related;
  return entries.sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** Content hash of the entries (generatedAt aside), so a rebuild with nothing new writes nothing. */
export const hashOf = (entries) => createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);

export function buildCatalog() {
  const entries = collect();
  const counts = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const generic = entries.filter((e) => e.generic).length;
  return { $axf: FRAME, generatedAt: new Date().toISOString(), hash: hashOf(entries), kinds: KINDS, counts, total: entries.length, generic, entries };
}

/** What changed between two catalogs: ids added, removed, and entries whose text or links moved. */
export function diffCatalogs(prev, next) {
  const before = new Map((prev?.entries ?? []).map((e) => [e.id, JSON.stringify(e)]));
  const after = new Map((next?.entries ?? []).map((e) => [e.id, JSON.stringify(e)]));
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id));
  return { added, removed, changed };
}

export function readRatchet() { return existsSync(RATCHET_FILE) ? readJson(RATCHET_FILE) : { generic: Infinity }; }

/**
 * Completeness (CI): built fresh from the registries, every registered item must yield an entry with a real
 * summary. Items that only get a generated fallback ("A toolbar asset that ships with the framework.") are counted,
 * and that count may never rise above the committed ratchet (coverage.json; --update-ratchet lowers it).
 */
export function checkCatalog(fresh = buildCatalog(), ratchet = readRatchet()) {
  const errors = [];
  const empty = fresh.entries.filter((e) => !e.summary);
  if (empty.length) errors.push(`${empty.length} registered item(s) have no summary at all, e.g. ${empty.slice(0, 5).map((e) => e.id).join(', ')}`);
  const ids = new Set();
  for (const e of fresh.entries) { if (ids.has(e.id)) errors.push(`duplicate entry id ${e.id}`); ids.add(e.id); }
  const generic = fresh.entries.filter((e) => e.generic);
  if (generic.length > (ratchet.generic ?? Infinity)) {
    const fresh_ = generic.filter((e) => !(ratchet.known ?? []).includes(e.id)).slice(0, 8).map((e) => `${e.id} (${e.source})`);
    errors.push(`${generic.length} item(s) have no description of their own (the ratchet allows ${ratchet.generic}); describe the new one(s): ${fresh_.join(', ')}`);
  }
  // every plugin folder, asset type and framework asset must be in the catalog (the sources are the registry)
  const pluginsDir = join(ROOT, 'apps/console-web/plugins');
  if (existsSync(pluginsDir)) {
    for (const f of readdirSync(pluginsDir).filter((n) => !n.startsWith('_') && !n.startsWith('.'))) {
      if (existsSync(join(pluginsDir, f, 'plugin.json')) && !ids.has(`plugin:${f}`)) errors.push(`plugin ${f} has no glossary entry (is its plugin.json valid JSON?)`);
    }
  }
  return { ok: !errors.length, errors, total: fresh.total, generic: generic.length, allowed: ratchet.generic };
}

export function loadCatalog() { try { return existsSync(CATALOG_FILE) ? readJson(CATALOG_FILE) : null; } catch { return null; } }

/** Build and save the catalog when anything moved; the change list is kept for "what's new in the glossary". */
export function writeCatalog({ reason = 'manual', build = '' } = {}) {
  const c = buildCatalog();
  const prev = loadCatalog();
  if (prev?.hash === c.hash) return { wrote: false, catalog: prev, diff: { added: [], removed: [], changed: [] } };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CATALOG_FILE, `${JSON.stringify(c)}\n`);
  const diff = diffCatalogs(prev, c);
  let log = [];
  try { log = existsSync(CHANGES_FILE) ? readJson(CHANGES_FILE) : []; } catch { log = []; }
  log.unshift({ at: c.generatedAt, reason, build, total: c.total, added: diff.added.slice(0, 200), removed: diff.removed.slice(0, 200), changed: diff.changed.slice(0, 200), counts: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length } });
  writeFileSync(CHANGES_FILE, `${JSON.stringify(log.slice(0, 50), null, 1)}\n`);
  return { wrote: true, catalog: c, diff };
}

/** The catalog to read: the saved one, rebuilt first when it is missing. */
export function currentCatalog() { return loadCatalog() ?? writeCatalog({ reason: 'first read' }).catalog; }

export function search(entries, q, limit = 50) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries.slice(0, limit);
  const scored = [];
  for (const e of entries) {
    const term = e.term.toLowerCase();
    const hay = `${term} ${e.summary.toLowerCase()} ${e.keywords.join(' ')} ${e.category.toLowerCase()} ${e.id}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let s = 0;
    for (const w of words) s += term === w ? 50 : term.startsWith(w) ? 20 : term.includes(w) ? 10 : e.keywords.includes(w) ? 4 : 1;
    if (e.kind === 'concept') s += 5;
    if (e.kind === 'plugin') s += 3;
    scored.push([s, e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].term.localeCompare(b[1].term)).slice(0, limit).map((x) => x[1]);
}

export function linksTo(entries, id) {
  return entries.filter((e) => e.related?.includes(id) || e.children?.includes(id)).map((e) => e.id);
}

/* ---------------- CLI ---------------- */

async function main(argv) {
  const [cmd = 'stats', ...rest] = argv;
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? '' : ''; };
  if (cmd === 'build') {
    const r = writeCatalog({ reason: flag('--reason') || 'manual', build: flag('--build') });
    if (rest.includes('--json')) { process.stdout.write(`${JSON.stringify({ wrote: r.wrote, total: r.catalog.total, counts: r.catalog.counts, diff: { added: r.diff.added.length, removed: r.diff.removed.length, changed: r.diff.changed.length } })}\n`); return 0; }
    if (!r.wrote) { console.log(`glossary: up to date (${r.catalog.total} entries)`); return 0; }
    console.log(`glossary: wrote ${rel(CATALOG_FILE)} — ${r.catalog.total} entries (+${r.diff.added.length} new, ${r.diff.changed.length} changed, -${r.diff.removed.length} gone)`);
    return 0;
  }
  if (cmd === '--check' || cmd === 'check') {
    const r = checkCatalog();
    if (r.ok) { console.log(`glossary: complete — ${r.total} entries, every registered item has one; ${r.generic} without a description of their own (ratchet ${r.allowed})`); return 0; }
    for (const e of r.errors) console.error(`glossary: ${e}`);
    return 1;
  }
  if (cmd === '--update-ratchet') {
    const c = buildCatalog();
    const old = readRatchet();
    const generic = Math.min(c.generic, Number.isFinite(old.generic) ? old.generic : c.generic);
    writeFileSync(RATCHET_FILE, `${JSON.stringify({ $axf: 'glossary-coverage@1', description: 'How many glossary entries may still fall back to a generated summary (their source has no description). Only goes down: node catalog.mjs --update-ratchet.', generic }, null, 2)}\n`);
    console.log(`glossary: ratchet ${generic}`);
    return 0;
  }
  if (cmd === '--json') { process.stdout.write(`${JSON.stringify(currentCatalog())}\n`); return 0; }
  const cat = currentCatalog();
  if (cmd === 'stats') {
    if (rest.includes('--json')) { process.stdout.write(`${JSON.stringify({ total: cat.total, counts: cat.counts, generic: cat.generic, generatedAt: cat.generatedAt })}\n`); return 0; }
    console.log(`${cat.total} entries, built ${cat.generatedAt}; ${cat.generic} without a description of their own`);
    for (const [k, n] of Object.entries(cat.counts)) console.log(`  ${String(n).padStart(5)}  ${KINDS[k] ?? k}`);
    return 0;
  }
  if (cmd === 'search') {
    const hits = search(cat.entries, rest.filter((x) => x !== '--json').join(' '), 30);
    if (rest.includes('--json')) { process.stdout.write(`${JSON.stringify(hits)}\n`); return 0; }
    for (const e of hits) console.log(`${e.id.padEnd(48)} ${e.term} — ${e.summary.slice(0, 90)}`);
    return 0;
  }
  if (cmd === 'get') {
    const e = cat.entries.find((x) => x.id === rest[0]);
    if (!e) { console.error(`glossary: no entry ${rest[0]}`); return 2; }
    console.log(JSON.stringify({ ...e, linkedFrom: linksTo(cat.entries, e.id) }, null, 2));
    return 0;
  }
  if (cmd === 'changes') { console.log(existsSync(CHANGES_FILE) ? readFileSync(CHANGES_FILE, 'utf8') : '[]'); return 0; }
  console.error('usage: catalog.mjs build [--reason r] [--build id] | --check | --update-ratchet | stats | search <q> | get <id> | changes | --json');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));

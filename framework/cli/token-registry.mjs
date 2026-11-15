#!/usr/bin/env node
/**
 * Token registry (token-registry@1, engine core/engines/token-registry.mjs): every `--fx-*` token in the system, with
 * element type, area, state, light / dark, level, a plain-English description, the default and the source. The document
 * is framework/schemas/token-registry.json; `sync` derives the token set the way check-theme.mjs does (axf.css, the
 * engines' literals, the colour themes' keys, the scale and layout registries, the component prefixes found in use) and
 * merges the manifests' `tokens.defines`, keeping every hand-edited description, level, area, state and element.
 *
 *   node framework/cli/token-registry.mjs list [--level basic|pro|advanced] [--area a] [--element e] [--state s] [--q words] [--json]
 *   node framework/cli/token-registry.mjs search <words…> [--json]
 *   node framework/cli/token-registry.mjs get <--fx-token> [--json]          the entry, its control@1 set and where it is read
 *   node framework/cli/token-registry.mjs usage <--fx-token>                  the files that read it
 *   node framework/cli/token-registry.mjs sync [--write] [--json]             derive + merge; --write saves the document
 *   node framework/cli/token-registry.mjs check [--json]                      CI: registry valid, every used token registered,
 *                                                                              every registered token used, manifests current
 *   node framework/cli/token-registry.mjs manifest <plugin folder> [--write]  the plugin's `tokens.uses` from its files
 *   node framework/cli/token-registry.mjs sets [--json]                       token → control@1 set map (what an edit applies to)
 *   node framework/cli/token-registry.mjs voice "<phrase>"                    the Skin editor intent of a phrase
 *   node framework/cli/token-registry.mjs fixture [--write]                   spec/fixtures/token-registry.json from the pure engine
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALE_ENUMS, SCALE_FIELDS, SCALE_TYPES, scaleToken, scaleVars } from '../core/engines/scale-rules.mjs';
import { LAYOUT_FIELDS, layoutToken, layoutTokenVars } from '../core/engines/layout-rules.mjs';
import {
  DEFAULT_SKIN_ID, SKIN_VOICE_FRAME, TOKEN_ID, TOKEN_REGISTRY_FRAME, applyEdits, chainErrors, chainTo, classifyToken, diffStates, editSnapshot, exportSkin,
  manifestTokenErrors, manifestTokens, manifestUsesDiff, normalizeRegistry, normalizeToken, registryCoverage, registryErrors, registrySummary, revertSnapshot,
  rootSnapshot, searchTokens, skinState, skinVoiceIntent, snapshotBefore, snapshotRows, tokenSet, tokensAtLevel,
} from '../core/engines/token-registry.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FRAMEWORK = join(ROOT, 'framework');
export const REGISTRY_FILE = join(FRAMEWORK, 'schemas/token-registry.json');
export const BASELINE_FILE = join(FRAMEWORK, 'spec/token-manifest-baseline.json');
export const FIXTURE_FILE = join(FRAMEWORK, 'spec/fixtures/token-registry.json');
const PLUGIN_ROOTS = ['apps/console-web/plugins'];
/** Where UI reads tokens: the framework, every app's source and plugins, the shared libraries. */
const SOURCE_ROOTS = ['framework/ui', 'framework/react', 'framework/core', 'framework/libs', 'framework/library-templates', 'framework/boilerplates', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'vendor', 'build', 'coverage', '.git', 'android', 'fixtures', 'schemas']);
const SOURCE_EXT = /\.(css|tsx?|mjs|mts|jsx?|html|kt)$/;
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) return [dir];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* ================================================================== deriving the token set */

/** Style theme vars → the style theme field (engines/theme.ts styleThemeVars + surfaceThemeVars). */
export const STYLE_FIELDS = {
  font: 'fontFamily', 'font-display': 'fontDisplay', 'font-mono': 'fontMono', 'font-size': 'fontSize', 'radius-sm': 'radius.sm', 'radius-md': 'radius.md', 'radius-lg': 'radius.lg',
  space: 'space', 'border-w': 'borderWidth', 'shadow-sm': 'shadow.sm', 'shadow-md': 'shadow.md', 'shadow-lg': 'shadow.lg', motion: 'motion', blur: 'blur', 'heading-weight': 'headingWeight',
  tracking: 'tracking', 'opacity-disabled': 'opacityDisabled', 'opacity-muted': 'opacityMuted', 'opacity-hover': 'opacityHover', 'opacity-tint': 'opacityTint', 'opacity-scrim': 'opacityScrim',
  'opacity-glass': 'opacityGlass', 'opacity-dialog': 'opacityDialog', 'opacity-settings': 'opacitySettings', 'opacity-panel': 'opacityPanel', 'opacity-menu': 'opacityMenu', 'opacity-toolbar': 'opacityToolbar', 'opacity-banner': 'opacityBanner',
};

function colourThemes() {
  const out = [];
  for (const dir of [join(FRAMEWORK, 'assets/color-theme'), join(ROOT, 'apps/console-web/src/assets/color-theme')]) {
    for (const f of walk(dir).filter((x) => x.endsWith('.json'))) { const a = readJson(f); if (a?.data?.tokens) out.push({ id: a.id, scheme: a.data.scheme, tokens: a.data.tokens, file: relative(ROOT, f) }); }
  }
  return out;
}

/** The maps tokenSet() needs, from the engines. */
export function setMaps() {
  const colourKeys = [...new Set(colourThemes().flatMap((t) => Object.keys(t.tokens)))];
  const layoutFields = {}; for (const f of Object.keys(LAYOUT_FIELDS)) layoutFields[kebab(f)] = f;
  for (const k of Object.keys(layoutTokenVars(null))) { const f = k.replace(/^--fx-layout-/, ''); if (!layoutFields[f]) layoutFields[f] = f.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); }
  const scaleFields = {};
  for (const type of SCALE_TYPES) for (const path of [...Object.keys(SCALE_FIELDS[type]), ...Object.keys(SCALE_ENUMS[type] ?? {})]) scaleFields[scaleToken(type, path).replace(/^--fx-/, '')] = { type, path };
  return { colourKeys, styleFields: STYLE_FIELDS, layoutFields, scaleFields };
}

/**
 * Every token the engines, axf.css, the colour themes and the manifests define: { id → { sources: Set, default, element?… } }
 * plus the run-time prefixes (component engines build names from them).
 */
export function derive() {
  const defs = new Map();
  const add = (id, source, extra = {}) => {
    if (!TOKEN_ID.test(id)) return;
    const d = defs.get(id) ?? { sources: new Set(), default: '' };
    d.sources.add(source);
    if (extra.default !== undefined && extra.default !== '' && d.default === '') d.default = extra.default;
    for (const k of ['element', 'area', 'state', 'scheme', 'level', 'description']) if (extra[k]) d[k] = extra[k];
    defs.set(id, d);
  };
  // the base stylesheet
  const css = readFileSync(join(FRAMEWORK, 'ui/axf.css'), 'utf8');
  for (const m of css.matchAll(/(--fx-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) add(m[1], 'framework/ui/axf.css', { default: m[2].trim().slice(0, 120) });
  // engine literals (core) and variables the React layer sets itself (style.setProperty)
  for (const dir of ['core', 'react']) for (const f of walk(join(FRAMEWORK, dir)).filter((x) => /\.(tsx?|mjs)$/.test(x) && !NOT_UI.test(relative(ROOT, x)))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`](--fx-[a-z0-9-]+)['"`]/g)) add(m[1], `engine:${relative(ROOT, f)}`);
  }
  // style theme defaults (the console's default style theme)
  const style = readJson(join(FRAMEWORK, 'assets/style-theme/hub.json'))?.data ?? {};
  for (const [suffix, field] of Object.entries(STYLE_FIELDS)) {
    const v = field.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), style);
    add(`--fx-${suffix}`, 'engine:framework/core/engines/theme.ts', { default: v === undefined ? '' : String(v) });
  }
  // scale and layout registries
  for (const t of SCALE_TYPES) for (const [k, v] of Object.entries(scaleVars(t, null))) add(k, `engine:${t}@1`, { default: String(v) });
  for (const [k, v] of Object.entries(layoutTokenVars(null))) add(k, 'engine:layout@1', { default: String(v) });
  add(layoutToken('navOrientation'), 'engine:layout@1');
  // colour themes: one token per key; the default from the console's default colour theme
  const themes = colourThemes();
  const def = themes.find((t) => t.id === 'hub-night') ?? themes[0];
  for (const t of themes) for (const [k, v] of Object.entries(t.tokens)) add(`--fx-${kebab(k)}`, `color-theme:${t.id}`, { default: def?.tokens?.[k] ?? v, element: 'palette', area: 'colour' });
  // run-time prefixes
  const prefixes = new Set();
  for (const f of walk(join(FRAMEWORK, 'core/engines')).filter((x) => x.endsWith('.ts'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/`(--fx-[a-z0-9-]+-)\$\{/g)) prefixes.add(m[1]);
  }
  // manifests: plugin.json / axf.manifest.json `tokens.defines`
  for (const { manifest, label } of manifests()) {
    const b = manifestTokens(manifest, label);
    for (const d of b?.defines ?? []) add(d.id, label, d);
  }
  return { defs, prefixes: [...prefixes].sort() };
}

/** Every manifest with a possible `tokens` block: plugins (plugin.json) and apps (axf.manifest.json). */
export function manifests() {
  const out = [];
  for (const rootRel of PLUGIN_ROOTS) {
    const root = join(ROOT, rootRel);
    if (!existsSync(root)) continue;
    for (const folder of readdirSync(root)) {
      const f = join(root, folder, 'plugin.json');
      if (folder.startsWith('_') || folder.startsWith('.') || !existsSync(f)) continue;
      const manifest = readJson(f);
      if (manifest) out.push({ kind: 'plugin', folder, dir: join(root, folder), file: relative(ROOT, f), manifest, label: `plugin:${folder}` });
    }
  }
  const appsDir = join(ROOT, 'apps');
  if (existsSync(appsDir)) for (const app of readdirSync(appsDir)) {
    const f = join(appsDir, app, 'axf.manifest.json');
    const manifest = existsSync(f) ? readJson(f) : null;
    if (manifest) out.push({ kind: 'app', folder: app, dir: join(appsDir, app), file: relative(ROOT, f), manifest, label: `app:${manifest.app?.id ?? app}` });
  }
  return out;
}

/** { token → [files] } over the UI sources: where every token is read or written. */
/** Test files and scripts are not UI: what they mention is not a read. */
const NOT_UI = /(^|\/)(test|tests|__tests__|scripts|spec)\/|(\.|-|\/)test\.(m?[jt]sx?|mts)$|\.test\.|\.spec\./;
/** Whole token names in a text: a template-literal prefix (`--fx-navs-` + `${…}`) is not a token and is skipped. */
export function tokenNamesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/--fx-[a-z0-9-]+/g)) if (!m[0].endsWith('-') && TOKEN_ID.test(m[0])) out.add(m[0]);
  return out;
}

export function usage(roots = SOURCE_ROOTS) {
  const used = {};
  for (const r of roots) for (const f of walk(join(ROOT, r)).filter((x) => SOURCE_EXT.test(x))) {
    const rel = relative(ROOT, f);
    if (NOT_UI.test(rel)) continue;
    for (const id of tokenNamesIn(readFileSync(f, 'utf8'))) (used[id] ??= []).push(rel);
  }
  return used;
}

/** The tokens one folder's files read (a plugin's `tokens.uses`). */
export function folderUses(dir) {
  const out = new Set();
  for (const f of walk(dir).filter((x) => SOURCE_EXT.test(x) && !NOT_UI.test(relative(ROOT, x)))) for (const id of tokenNamesIn(readFileSync(f, 'utf8'))) out.add(id);
  return [...out].sort();
}

/* ================================================================== the document */

export function readRegistry() {
  const raw = readJson(REGISTRY_FILE);
  return raw ? normalizeRegistry(raw) : { $axf: TOKEN_REGISTRY_FRAME, version: 1, updatedAt: '', tokens: [] };
}

/** Derive + merge into the current document; hand-edited fields win, defaults and sources refresh, new tokens are drafted. */
export function sync({ used = usage() } = {}) {
  const current = readRegistry();
  const byId = new Map(current.tokens.map((t) => [t.id, t]));
  const { defs, prefixes } = derive();
  const maps = setMaps();
  // tokens built from a run-time prefix are known by the names the UI reads
  for (const [id, files] of Object.entries(used)) if (!defs.has(id) && prefixes.some((p) => id.startsWith(p))) defs.set(id, { sources: new Set([`engine:prefix ${prefixes.find((p) => id.startsWith(p))}`, ...files.slice(0, 3)]), default: '' });
  const tokens = [];
  for (const [id, d] of defs) {
    const prev = byId.get(id);
    const guess = classifyToken(id, maps.colourKeys);
    const sources = [...d.sources].sort();
    const entry = normalizeToken({
      id,
      element: prev?.element ?? d.element ?? guess.element, area: prev?.area ?? d.area ?? guess.area, state: prev?.state ?? d.state ?? guess.state,
      scheme: prev?.scheme ?? d.scheme ?? guess.scheme, level: prev?.level ?? d.level ?? guess.level, description: prev?.description ?? d.description ?? guess.description,
      default: d.default !== '' ? d.default : prev?.default ?? '', source: sources[0], sources, deprecated: prev?.deprecated,
    });
    if (!entry) continue; // a template-literal prefix (`--fx-navs-`), not a token
    const set = tokenSet(id, maps);
    if (set) entry.set = set;
    tokens.push(entry);
  }
  // hand-registered tokens with no derivable source stay (the check reports them when nothing reads them)
  for (const t of current.tokens) if (!defs.has(t.id)) tokens.push(t);
  const doc = normalizeRegistry({ $axf: TOKEN_REGISTRY_FRAME, version: current.version, updatedAt: current.updatedAt, tokens });
  const added = tokens.filter((t) => !byId.has(t.id)).map((t) => t.id).sort();
  return { doc, added, prefixes };
}

export function writeRegistry(doc) {
  const out = { ...doc, updatedAt: new Date().toISOString().slice(0, 10) };
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

/* ================================================================== the CI check */

export function readBaseline() { return readJson(BASELINE_FILE) ?? { $axf: 'token-manifest-baseline@1', exempt: [] }; }

/** Every problem the CI check fails on. */
export function check() {
  const problems = [];
  const raw = readJson(REGISTRY_FILE);
  if (!raw) return { ok: false, problems: [`${relative(ROOT, REGISTRY_FILE)} is missing: run node framework/cli/token-registry.mjs sync --write`] };
  for (const e of registryErrors(raw)) problems.push(`registry: ${e}`);
  const doc = normalizeRegistry(raw);
  const used = usage();
  const { doc: fresh, added, prefixes } = sync({ used });
  for (const id of added) problems.push(`not registered: ${id} is defined by ${fresh.tokens.find((t) => t.id === id)?.source} (run sync --write)`);
  const cov = registryCoverage(doc.tokens.map((t) => t.id), used, prefixes);
  for (const u of cov.unregistered) problems.push(`not registered: ${u.id} is read in ${u.files.join(', ')}`);
  for (const id of cov.unused) {
    const t = doc.tokens.find((x) => x.id === id);
    const generated = (t?.sources ?? [t?.source]).some((s) => /^engine:(typography|density|sizing|layout)@1$/.test(s ?? ''));
    if (!generated && !t?.deprecated) problems.push(`unused: ${id} is registered (${t?.source}) but nothing reads it`);
  }
  // manifests: the block is valid where present; required (and current) on every plugin not in the baseline
  const baseline = readBaseline();
  const exempt = new Set(baseline.exempt ?? []);
  for (const m of manifests()) {
    const required = m.kind === 'plugin' && !exempt.has(m.folder) && folderUses(m.dir).length > 0;
    for (const e of manifestTokenErrors(m.manifest, { required })) problems.push(`${m.file}: ${e}`);
    const block = manifestTokens(m.manifest, m.label);
    if (block && m.kind === 'plugin') {
      const diff = manifestUsesDiff(block.uses, folderUses(m.dir));
      for (const id of diff.missing) problems.push(`${m.file}: tokens.uses is missing ${id} (its files read it; run token-registry.mjs manifest ${m.folder} --write)`);
      for (const id of diff.stale) problems.push(`${m.file}: tokens.uses lists ${id} but nothing in the folder reads it`);
      if (exempt.has(m.folder)) problems.push(`${relative(ROOT, BASELINE_FILE)}: ${m.folder} now carries a tokens block; drop it from the baseline (it only shrinks)`);
    }
  }
  for (const folder of exempt) if (!manifests().some((m) => m.kind === 'plugin' && m.folder === folder)) problems.push(`${relative(ROOT, BASELINE_FILE)}: ${folder} is not a plugin folder; drop it`);
  return { ok: problems.length === 0, problems, tokens: doc.tokens.length, used: Object.keys(used).length, prefixes };
}

/* ================================================================== fixture (golden outputs of the pure engine) */

export function fixture() {
  const colourKeys = ['bg', 'surface', 'text', 'accent', 'accentSoft', 'danger'];
  const names = ['--fx-accent', '--fx-accent-soft', '--fx-btn-bg-hover', '--fx-layout-nav-width', '--fx-type-scale-sm', '--fx-opacity-dialog', '--fx-tab-indicator-h', '--fx-grid-row-bg-selected', '--fx-motion', '--fx-shadow-md', '--fx-dialog-radius', '--fx-navs-pill-bg-active'];
  const classify = Object.fromEntries(names.map((n) => [n, classifyToken(n, colourKeys)]));
  const at = (i) => new Date(Date.UTC(2026, 10, 13, 20, i)).toISOString();
  const root = rootSnapshot({ kind: 'view', id: 'home', label: 'Home' }, 'test', at(0));
  const chain = [root];
  const s1 = editSnapshot(chain, root, { token: '--fx-accent', to: '#ff8800' }, { by: 'test', at: at(5) }); chain.push(s1);
  const s2 = editSnapshot(chain, s1, [{ token: '--fx-radius-md', to: '12px' }, { token: '--fx-accent', to: '#ff8800' }], { by: 'test', at: at(12) }); chain.push(s2);
  const s3 = editSnapshot(chain, s2, { token: '--fx-accent', to: null }, { by: 'test', at: at(20) }); chain.push(s3);
  const noop = editSnapshot(chain, s3, { token: '--fx-accent', to: null }, { by: 'test', at: at(21) });
  const rev = revertSnapshot(chain, s3, s1.id, { by: 'test', at: at(30) }); chain.push(rev);
  const sets = { '--fx-accent': { target: 'tokens.theme', path: 'accent' }, '--fx-radius-md': { target: 'tokens.style', path: 'radius.md' } };
  const base = { layoutTheme: 'focus-top', colorTheme: 'hub-night', styleTheme: 'hub', behaviorTheme: 'standard', assets: { button: 'rounded-solid' } };
  const exported = exportSkin({ ...s2.state, '--fx-btn-bg-hover': '#333' }, { id: 'Midnight Sky', name: 'Midnight', base, sets });
  const voice = [
    'revert the skin to 10 minutes ago', 'Amber, roll the skin back to two hours ago', 'revert the skin to the default', 'revert the skin to snapshot s12',
    'export this as a new skin called Midnight', 'save this skin as Deep Ocean', 'undo the last skin edit', 'open the skin editor', 'open plan studio in the skin editor',
    'set the accent to #ff8800 in the skin', 'skin: set --fx-radius-md to 12px', 'search the token registry for hover', 'show the token registry', 'turn the lights off',
  ].map((phrase) => ({ phrase, intent: skinVoiceIntent(phrase) }));
  return {
    $axf: 'fixture@1', frame: TOKEN_REGISTRY_FRAME, voiceFrame: SKIN_VOICE_FRAME,
    classify,
    registryErrors: { empty: registryErrors({ $axf: TOKEN_REGISTRY_FRAME, tokens: [] }), bad: registryErrors({ $axf: 'x', tokens: [{ id: 'accent', area: 'nope', level: 'basic', state: 'any', scheme: 'both', element: 'palette', description: 'no stop', source: 's' }, { id: '--fx-a', area: 'colour', level: 'basic', state: 'any', scheme: 'both', element: 'palette', description: 'Fine.', source: 's' }, { id: '--fx-a', area: 'colour', level: 'basic', state: 'any', scheme: 'both', element: 'palette', description: 'Fine.', source: 's' }] }) },
    search: searchTokens(Object.entries(classify).map(([id, c]) => normalizeToken({ id, ...c, source: 'test' })), { q: 'button hover' }).map((t) => t.id),
    levels: { basic: tokensAtLevel(Object.entries(classify).map(([id, c]) => ({ id, ...c })), 'basic').map((t) => t.id), pro: tokensAtLevel(Object.entries(classify).map(([id, c]) => ({ id, ...c })), 'pro').map((t) => t.id) },
    manifest: { ok: manifestTokenErrors({ tokens: { $axf: TOKEN_REGISTRY_FRAME, uses: ['--fx-accent'], defines: [{ id: '--fx-x-y', description: 'X: y.' }] } }), missing: manifestTokenErrors({}, { required: true }), bad: manifestTokenErrors({ tokens: { $axf: 'nope', uses: ['accent'], defines: [{ id: '--fx-z' }] } }) },
    coverage: registryCoverage(['--fx-accent', '--fx-old'], { '--fx-accent': ['a.css'], '--fx-new': ['b.css'], '--fx-navs-pill-bg': ['c.css'] }, ['--fx-navs-']),
    usesDiff: manifestUsesDiff(['--fx-a', '--fx-b'], ['--fx-b', '--fx-c']),
    tokenSet: { accent: tokenSet('--fx-accent', { colourKeys }), layout: tokenSet('--fx-layout-nav-width', {}), style: tokenSet('--fx-radius-md', { styleFields: { 'radius-md': 'radius.md' } }), scale: tokenSet('--fx-type-scale-sm', { scaleFields: { 'type-scale-sm': { type: 'typography', path: 'scale.sm' } } }), none: tokenSet('--fx-btn-bg-hover', { colourKeys }) },
    chain, noop, rows: snapshotRows(chain, rev.id), pathToS3: chainTo(chain, s3.id).map((s) => s.id),
    before: { tenMinutesAgo: snapshotBefore(chain, rev.id, at(20))?.id, beforeAll: snapshotBefore(chain, rev.id, at(-5))?.id, afterAll: snapshotBefore(chain, rev.id, at(99))?.id },
    chainErrors: { ok: chainErrors(chain), bad: chainErrors([{ ...root, kind: 'edit' }, { ...s1, parent: 'ghost' }, s1]) },
    diff: diffStates(s2.state, s1.state), apply: applyEdits({ '--fx-a': 1 }, [{ token: '--fx-a', to: null }, { token: '--fx-b', to: 'x' }]),
    exported, roundTrip: skinState(exported.asset.data, sets), defaultSkin: DEFAULT_SKIN_ID, voice,
  };
}

/* ================================================================== CLI */

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; out[k] = v; } else out._.push(a);
  }
  return out;
}

const row = (t) => `${t.id.padEnd(40)} ${t.level.padEnd(8)} ${t.area.padEnd(9)} ${t.element.padEnd(14)} ${t.state.padEnd(8)} ${String(t.default).slice(0, 24).padEnd(24)} ${t.description}`;

export async function main(argv = process.argv.slice(2)) {
  const f = flags(argv);
  const [cmd, ...rest] = f._;
  const json = Boolean(f.json);
  switch (cmd) {
    case 'list': case 'search': {
      const doc = readRegistry();
      const q = cmd === 'search' ? rest.join(' ') : (f.q ?? '');
      const hits = searchTokens(doc.tokens, { q, area: f.area, element: f.element, level: f.level, state: f.state, scheme: f.scheme, source: f.source });
      if (json) console.log(JSON.stringify({ total: doc.tokens.length, hits: hits.length, tokens: hits }, null, 2));
      else { for (const t of hits) console.log(row(t)); console.log(`\n${hits.length} of ${doc.tokens.length} tokens`); }
      return 0;
    }
    case 'get': {
      const doc = readRegistry();
      const t = doc.tokens.find((x) => x.id === rest[0]);
      if (!t) { console.error(`no token ${rest[0]} in the registry`); return 1; }
      const files = usage()[t.id] ?? [];
      console.log(json ? JSON.stringify({ ...t, readIn: files }, null, 2) : `${row(t)}\n  set: ${t.set ? `${t.set.target} ${t.set.path}` : 'stylesheet variable (no control@1 set)'}\n  sources: ${(t.sources ?? [t.source]).join(', ')}\n  read in ${files.length} file(s):\n    ${files.join('\n    ')}`);
      return 0;
    }
    case 'usage': { const files = usage()[rest[0]] ?? []; console.log(json ? JSON.stringify(files) : files.join('\n') || `${rest[0]} is not read anywhere`); return 0; }
    case 'sync': {
      const r = sync();
      if (f.write) writeRegistry(r.doc);
      const summary = { tokens: r.doc.tokens.length, added: r.added, prefixes: r.prefixes, written: Boolean(f.write) };
      console.log(json ? JSON.stringify(summary, null, 2) : `${summary.tokens} tokens, ${r.added.length} new${r.added.length ? `: ${r.added.join(', ')}` : ''}${f.write ? `\nwritten ${relative(ROOT, REGISTRY_FILE)}` : '\n(dry run: add --write)'}`);
      return 0;
    }
    case 'check': {
      const r = check();
      if (json) console.log(JSON.stringify(r, null, 2));
      else if (r.ok) console.log(`✓ token registry: ${r.tokens} tokens registered, ${r.used} read in the sources, manifests current`);
      else { for (const p of r.problems) console.log(`✗ ${p}`); console.log(`\n${r.problems.length} token registry problem(s). Register tokens in framework/schemas/token-registry.json (node framework/cli/token-registry.mjs sync --write) and in the plugin's manifest (token-registry.mjs manifest <folder> --write).`); }
      return r.ok ? 0 : 1;
    }
    case 'manifest': {
      const m = manifests().find((x) => x.kind === 'plugin' && x.folder === rest[0]);
      if (!m) { console.error(`no plugin folder "${rest[0]}"`); return 1; }
      const uses = folderUses(m.dir);
      if (f.write) {
        const block = { $axf: TOKEN_REGISTRY_FRAME, uses, ...(Array.isArray(m.manifest.tokens?.defines) ? { defines: m.manifest.tokens.defines } : {}) };
        writeFileSync(join(ROOT, m.file), `${JSON.stringify({ ...m.manifest, tokens: block }, null, 2)}\n`);
        console.log(`written ${m.file}: ${uses.length} token(s)`);
      } else console.log(json ? JSON.stringify(uses) : uses.join('\n') || '(no tokens read)');
      return 0;
    }
    case 'sets': {
      const maps = setMaps();
      const out = {};
      for (const t of readRegistry().tokens) { const s = tokenSet(t.id, maps); if (s) out[t.id] = s; }
      console.log(json ? JSON.stringify(out, null, 2) : Object.entries(out).map(([k, v]) => `${k.padEnd(40)} ${v.target} ${v.path}`).join('\n'));
      return 0;
    }
    case 'voice': { console.log(JSON.stringify(skinVoiceIntent(rest.join(' ')), null, 2)); return 0; }
    case 'fixture': {
      const fx = fixture();
      if (f.write) { writeFileSync(FIXTURE_FILE, `${JSON.stringify(fx, null, 2)}\n`); console.log(`written ${relative(ROOT, FIXTURE_FILE)}`); } else console.log(JSON.stringify(fx, null, 2));
      return 0;
    }
    case 'summary': { console.log(JSON.stringify(registrySummary(readRegistry().tokens), null, 2)); return 0; }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].split('\n').filter((l) => l.includes('node framework/cli/token-registry.mjs')).map((l) => l.replace(/^\s*\*\s?/, '')).join('\n'));
      return cmd ? 1 : 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());

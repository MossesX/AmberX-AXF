/**
 * Plan Studio Catalog: every console plugin, every app in apps/, every framework library and module, and axHub,
 * found automatically with the framework's own discovery (framework/cli/plugins.mjs builtPlugins + the plugin index,
 * app-bundle's rule for apps, libraries.json + framework/libs + the tracker's modules). Nothing here lists a plugin or
 * app by name, so a new one appears with no code change; one that was seen before and is gone now is marked "gone".
 *
 * Features are read, never copied: the tracker (tracker.json, statuses from catalog/status.json) by module, each
 * plugin's `provides` (its pages, settings tab, banner, services) and the feature matrices of builds linked to plans.
 * Plans add what they plan (plan.features) on top (plan-core overlayCatalog). Planned features that are tracker items
 * are written back through the tracker's path (catalog/status.json → `plan` on the item, tracker.mjs regenerates).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const STATE = { built: 'have', partial: 'partial', placeholder: 'partial', planned: 'planned' };

/** Tracker module → catalog key (null = a framework module entry of its own). */
function moduleKey(mod, { libs, apps }) {
  if (!mod || mod === '-') return null;
  const lib = libs.find((l) => l.module === mod);
  if (lib) return `library:${lib.id}`;
  if (mod.startsWith('apps/')) { const a = apps.find((x) => x.dir === mod); return a ? `app:${a.project}` : null; }
  if (mod === 'app-console') { const a = apps.find((x) => x.dir === 'apps/console-web'); return a ? `app:${a.project}` : null; }
  return null;
}

function scanApps(root) {
  const out = [];
  const dir = join(root, 'apps');
  for (const d of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name.startsWith('_')) continue;
    const pm = readJson(join(dir, d.name, 'project.manifest.json'));
    if (!pm?.name) continue;
    const am = readJson(join(dir, d.name, 'axf.manifest.json'), {});
    const pkg = readJson(join(dir, d.name, 'package.json'), {});
    out.push({ dir: `apps/${d.name}`, project: pm.name, name: am.app?.name ?? pm.displayName ?? pm.name, description: pm.description ?? am.app?.description ?? '', version: am.app?.version ?? pkg.version ?? pm.version ?? '', targets: am.targets ?? [], template: am.framework?.template ?? '', repo: pm.repo ?? '' });
  }
  return out;
}

async function scanPlugins(root) {
  try {
    const { builtPlugins } = await import(join(root, 'framework/cli/plugins.mjs'));
    const built = builtPlugins(root);
    const index = readJson(join(root, 'framework/catalog/plugins.json'), { items: [] });
    const planned = (index.items ?? []).filter((p) => !built.some((b) => b.id === p.id)).map((p) => ({ ...p, status: 'planned', folder: '', manifest: null }));
    return [...built, ...planned];
  } catch { return []; }
}

/** An app's features: its own plugins (src/plugins/<folder>/plugin.json), the console plugins that target it, its targets. */
function appFeatures(root, a, consolePlugins) {
  const out = [];
  const pd = join(root, a.dir, 'src/plugins');
  for (const f of existsSync(pd) ? readdirSync(pd).filter((x) => !x.startsWith('_')) : []) {
    const m = readJson(join(pd, f, 'plugin.json'));
    if (m) out.push({ id: `app-plugin:${f}`, title: m.name ?? f, state: 'have', source: 'app plugins', description: m.description ?? '' });
  }
  for (const p of consolePlugins) out.push({ id: `console-plugin:${p.key.slice(7)}`, title: `${p.name} (console plugin)`, state: 'have', source: 'plugin targets' });
  for (const t of a.targets ?? []) out.push({ id: `target:${t}`, title: `Runs on ${t}`, state: 'have', source: 'axf.manifest.json' });
  return out;
}

function pluginFeatures(m) {
  const out = [];
  for (const p of Array.isArray(m?.provides) ? m.provides : []) {
    if (typeof p !== 'string') continue;
    const [k, v] = p.includes(':') ? p.split(/:(.*)/s) : ['service', p];
    const title = k === 'view' ? `Page: ${v}` : k === 'settings-tab' ? `Settings tab: ${v}` : k === 'banner' ? `Banner: ${v}` : k === 'dialog' ? `Dialog: ${v}` : `${k}: ${v}`;
    out.push({ id: `provides:${p}`, title, state: 'have', source: 'plugin.json' });
  }
  for (const f of Array.isArray(m?.features) ? m.features : []) {
    const o = typeof f === 'string' ? { title: f } : f;
    if (o?.title) out.push({ id: o.id ?? `feature:${o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title: o.title, state: ['have', 'partial', 'planned', 'idea'].includes(o.state) ? o.state : 'have', source: 'plugin.json' });
  }
  if (m?.banner && m.banner !== false) out.push({ id: 'banner', title: 'Banner widget', state: 'have', source: 'plugin.json' });
  if (m?.tabable) out.push({ id: 'tabable', title: 'Opens as a tab in a host app', state: 'have', source: 'plugin.json' });
  for (const t of Array.isArray(m?.targets) ? m.targets.slice(1) : []) out.push({ id: `target:${t}`, title: `Runs in ${t}`, state: 'have', source: 'plugin.json' });
  return out;
}

/**
 * Every entry, newest discovery: [{key, kind, name, version, status (built|planned|gone), description, profile, links,
 * folder, features:[{id,title,state,source}]}]. `seen` (keys found before) marks the missing ones gone.
 */
export async function discover({ root = ROOT, seen = [], matrices = [], plans = [] } = {}) {
  const apps = scanApps(root);
  const libIndex = readJson(join(root, 'framework/catalog/libraries.json'), { items: [] }).items ?? [];
  const webLibs = existsSync(join(root, 'framework/libs')) ? readdirSync(join(root, 'framework/libs'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  const libs = libIndex.map((l) => ({ id: l.id, module: l.module, name: l.name, description: l.description ?? '', version: l.version ?? '', status: l.status ?? 'built' }));
  for (const w of webLibs) if (!libs.some((l) => l.module === `lib-${w}` || l.id.endsWith(`.${w}`))) {
    const readme = existsSync(join(root, 'framework/libs', w, 'README.md')) ? readFileSync(join(root, 'framework/libs', w, 'README.md'), 'utf8') : '';
    libs.push({ id: `web.${w}`, module: `framework/libs/${w}`, name: `${w} (web library)`, description: (readme.split('\n').find((x) => x.trim() && !x.startsWith('#')) ?? '').slice(0, 300), version: '', status: 'built' });
  }
  const tracker = readJson(join(root, 'tracker.json'), { items: [] });
  const status = readJson(join(root, 'framework/catalog/status.json'), {});
  const entries = new Map();
  const add = (e) => { entries.set(e.key, { links: [], features: [], profile: '', ...e }); return entries.get(e.key); };

  for (const p of await scanPlugins(root)) {
    const folder = p.folder ? p.folder.split('/').pop() : '';
    const host = p.folder ? p.folder.split('/')[1] : '';
    add({ key: `plugin:${folder || p.id}`, kind: 'plugin', id: p.id, name: p.name ?? p.id, version: p.version ?? '', status: p.status === 'planned' ? 'planned' : 'built', description: p.description ?? '', folder: p.folder ?? '', project: host, targets: p.manifest?.targets ?? (p.target ? [p.target] : []), builtWith: p.builtWith ?? null,
      links: [p.folder && { kind: 'doc', ref: p.folder, label: 'Folder' }, p.plan && { kind: 'related', ref: `plan:${p.plan}`, label: 'Plan item' }, p.pending && { kind: 'related', ref: `pending:${p.pending}`, label: 'Pending item' }].filter(Boolean),
      features: p.manifest ? pluginFeatures(p.manifest) : [{ id: 'planned', title: p.description || 'Planned plugin', state: 'planned', source: 'plugins.json' }] });
  }
  const pluginsFor = (project) => [...entries.values()].filter((e) => e.kind === 'plugin' && e.status === 'built' && (e.targets ?? []).includes(project));
  for (const a of apps) add({ key: `app:${a.project}`, kind: 'app', id: a.project, name: a.name, version: a.version, status: 'built', description: a.description, folder: a.dir, project: a.project, targets: a.targets, links: [{ kind: 'doc', ref: a.dir, label: 'Folder' }, a.repo && { kind: 'url', ref: /^https?:/.test(a.repo) ? a.repo : `https://github.com/${a.repo}`, label: 'Repo' }].filter(Boolean), features: appFeatures(root, a, pluginsFor(a.project)) });
  for (const l of libs) add({ key: `library:${l.id}`, kind: 'library', id: l.id, name: l.name, version: l.version, status: l.status === 'planned' ? 'planned' : 'built', description: l.description, folder: l.module, features: [] });
  add({ key: 'service:axhub', kind: 'service', id: 'axhub', name: 'axHub', version: '', status: 'built', description: 'Connector hub (MossesX/axHub, axhub.amberxai.com): services, approvals, projects tree, veto calls.', folder: '', links: [{ kind: 'url', ref: 'https://github.com/MossesX/axHub', label: 'Repo' }, { kind: 'url', ref: 'https://axhub.amberxai.com', label: 'Hub' }], features: [] });

  // tracker features, by module
  for (const it of tracker.items ?? []) {
    const st = status[it.id]?.status ?? it.status;
    let key = moduleKey(it.module, { libs, apps });
    if (!key) {
      const mod = it.module && it.module !== '-' ? it.module : `framework-${it.tab}`;
      key = `module:${mod}`;
      if (!entries.has(key)) add({ key, kind: 'module', id: mod, name: mod.startsWith('framework-') ? `Framework: ${it.tab}` : mod, version: tracker.frameworkVersion ?? '', status: 'built', description: mod.startsWith('framework-') ? `Framework features in the ${it.tab} tab of the tracker` : `Framework module ${mod}`, folder: '', features: [] });
    }
    entries.get(key).features.push({ id: `tracker:${it.id}`, title: it.title, state: STATE[st] ?? 'idea', source: 'tracker', trackerId: it.id, plan: status[it.id]?.plan ?? '' });
  }
  // feature matrices of builds linked to plans: the kept items are the plan's planned features on the entries it touches
  for (const p of plans) {
    if (!p.build) continue;
    const mx = matrices.find((m) => m.ref?.kind === 'orchestrator' && m.ref.id === p.build.id && (!p.build.profile || m.profile === p.build.profile));
    if (!mx) continue;
    for (const t of p.touches) {
      const e = entries.get(t.key); if (!e) continue;
      for (const it of mx.items ?? []) if (it.state !== 'skip') e.features.push({ id: `matrix:${mx.id}:${it.id}`, title: it.name, state: p.status === 'done' ? 'have' : 'planned', source: 'feature matrix', plan: p.id, build: `${p.build.profile}:${p.build.id}` });
    }
  }
  for (const k of seen) if (!entries.has(k)) add({ key: k, kind: k.split(':')[0], id: k.split(':').slice(1).join(':'), name: k.split(':').slice(1).join(':'), version: '', status: 'gone', description: 'Was in the catalog before; not found any more (removed or renamed).', folder: '', features: [] });
  return [...entries.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Every profile's feature matrices (the feature-matrix plugin's files; read only). */
export function readMatrices(root = ROOT) {
  const out = [];
  const add = (f, profile) => { const j = readJson(f); for (const m of j?.matrices ?? []) out.push({ ...m, profile: m.profile ?? profile }); };
  add(join(root, '_claude/builds/matrices.json'), 'main-framework');
  const pd = join(root, '_claude/builds/profiles');
  for (const d of existsSync(pd) ? readdirSync(pd) : []) add(join(pd, d, 'matrices.json'), d);
  return out;
}

/**
 * Write a plan's planned tracker features back through the tracker's path: catalog/status.json gets `plan: <id>` on
 * the item (and `status: built` once the plan is done and the item was planned/placeholder). `statusFile` is the
 * shared-data path (persist.mjs dataPath); returns the ids changed. Other features stay on the plan itself.
 */
export function writeBack(plan, statusFile) {
  const ids = plan.features.filter((f) => f.feature?.startsWith('tracker:')).map((f) => ({ id: f.feature.slice(8), state: f.state }));
  if (!ids.length || !existsSync(statusFile)) return [];
  const st = readJson(statusFile, {});
  const changed = [];
  for (const { id, state } of ids) {
    const it = st[id]; if (!it) continue;
    const next = { ...it, plan: plan.status === 'dropped' ? undefined : plan.id };
    if (state === 'have' && plan.status === 'done' && ['planned', 'placeholder'].includes(it.status)) next.status = 'built';
    if (JSON.stringify(next) !== JSON.stringify(it)) { if (next.plan === undefined) delete next.plan; st[id] = next; changed.push(id); }
  }
  if (changed.length) writeFileSync(statusFile, `${JSON.stringify(st, null, 2)}\n`);
  return changed;
}

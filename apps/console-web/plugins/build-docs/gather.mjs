/**
 * Build docs — the gatherer: what a build is made of, read from the repo (build-docs-source@1, core.normSource).
 *
 *   build + steps   the builds store (_claude/builds/store.json, or AXF_BUILDS_STORE): title, detail, status, branch,
 *                   PR, steps, notes; Brett's verbatim words and addenda from the record's origin
 *                   (_claude/builds/origins.json as a fallback)
 *   report          _claude/builds/reports/<build>.md
 *   diff            the merged PR's commit on main (by "#N" in its subject), else <main>...<branch>
 *   folders         plugin / app / framework folders the diff touched
 *   screens, menus, settings, help   each touched plugin's plugin.json, web/index.tsx, web/menu.ts and help.json
 *   commands        plugin-commands@1 (framework/cli/plugin-commands.mjs): REST route, MCP tool, CLI line
 *
 * Read-only: it only runs `git log` / `git diff` and reads files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normSource, APP_URLS } from './core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
const PLUGINS = 'apps/console-web/plugins/';

const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const readText = (p, max = 60000) => { try { return readFileSync(p, 'utf8').slice(0, max); } catch { return ''; } };
const git = (args, root = ROOT) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 << 20 }); return r.status === 0 ? r.stdout : ''; };

export function storeFile(root = ROOT) { return process.env.AXF_BUILDS_STORE || join(root, '_claude/builds/store.json'); }

/** Every build in the store (any profile), newest first; deleted ones left out. */
export function builds(root = ROOT) {
  const s = readJson(storeFile(root), { builds: [] }) ?? { builds: [] };
  return (s.builds ?? []).filter((b) => b && b.id && !b.deleted && b.status !== 'archived');
}
export function findBuild(id, root = ROOT) { return builds(root).find((b) => b.id === id) ?? null; }

/** The compact list the right-click menus need: id, title, status, profile, PR, steps (done or not). */
export function index(root = ROOT) {
  return builds(root).map((b) => ({
    id: b.id, title: b.title ?? b.id, status: b.status ?? '', profile: b.profile ?? (Array.isArray(b.profiles) ? b.profiles[0] : '') ?? '',
    branch: b.branch ?? '', pr: b.pr ?? '', planId: b.planId ?? '', pendingId: b.pendingId ?? '',
    steps: (b.steps ?? []).filter((s) => !s.skip).map((s) => ({ id: s.id, text: String(s.text ?? '').slice(0, 160), done: !!s.done })),
  }));
}

function origin(b, root) {
  const o = b.origin ?? {};
  if (o.said) return o;
  const side = readJson(join(root, '_claude/builds/origins.json'), {}) ?? {};
  const rec = side.origins?.[b.id] ?? side[b.id];
  return rec && typeof rec === 'object' ? rec : o;
}

function mainRef(root) {
  for (const r of ['origin/main', 'main', 'HEAD']) if (git(['rev-parse', '--verify', '-q', r], root).trim()) return r;
  return 'HEAD';
}

/** The diff a build brought: its merged PR's commit on main, else main...branch. */
export function diffOf(b, root = ROOT) {
  const main = mainRef(root);
  const n = String(b.pr ?? '').replace(/^#/, '');
  let range = '';
  if (/^\d+$/.test(n)) {
    const line = git(['log', main, '-E', `--grep=#${n}([^0-9]|$)`, '-n', '40', '--format=%H%x09%s'], root).split('\n')
      .find((l) => new RegExp(`\\t(Merge pull request #${n}\\b|Merge #${n}\\b|.*\\(#${n}\\)$)`).test(l));
    if (line) range = `${line.split('\t')[0]}^1..${line.split('\t')[0]}`;
  }
  if (!range && b.branch) {
    for (const ref of [`origin/${b.branch}`, b.branch]) if (git(['rev-parse', '--verify', '-q', ref], root).trim()) { range = `${main}...${ref}`; break; }
  }
  let shas = [];
  if (!range) {
    // no PR or branch: the commits that name the build
    shas = git(['log', main, '--no-merges', '-F', `--grep=${b.id}`, '-n', '30', '--format=%H'], root).split('\n').filter(Boolean);
    if (!shas.length) return { ref: '', files: [] };
  }
  const raw = range ? git(['diff', '--numstat', range], root) : shas.map((h) => git(['show', '--numstat', '--format=', h], root)).join('\n');
  const seen = new Map();
  for (const l of raw.split('\n').filter(Boolean)) {
    const [add, del, ...p] = l.split('\t');
    const path = p.join('\t').replace(/^(.*)\{(?:.*) => (.*)\}(.*)$/, '$1$2$3');
    const f = seen.get(path) ?? { path, add: 0, del: 0 };
    f.add += Number(add) || 0; f.del += Number(del) || 0;
    seen.set(path, f);
  }
  return { ref: range || `${shas.length} commit${shas.length === 1 ? '' : 's'} naming ${b.id}`, files: [...seen.values()] };
}
const NOISE = /^(_claude\/|changes\/|sessions\/|tracker\.json$|framework\/plan\/|framework\/catalog\/|\.brief\.md$|apps\/[^/]+\/_claude\/|apps\/[^/]+\/src\/axf\/|\.axf-queue\.log$)/;

/** The folders a diff touched: plugins first (by size of change), then apps, then the framework. */
export function foldersOf(files) {
  const m = new Map();
  for (const f of files) {
    if (NOISE.test(f.path)) continue;
    let key; let kind; let app = '';
    const p = /^apps\/([^/]+)\/plugins\/([^/]+)\//.exec(f.path);
    const a = /^apps\/([^/]+)\//.exec(f.path);
    if (p && p[2] !== '_template') { key = `apps/${p[1]}/plugins/${p[2]}`; kind = 'plugin'; app = p[1]; }
    else if (a) { key = `apps/${a[1]}`; kind = 'app'; app = a[1]; }
    else if (f.path.startsWith('framework/')) { key = f.path.split('/').slice(0, 2).join('/'); kind = 'framework'; }
    else continue;
    const cur = m.get(key) ?? { path: key, kind, app, name: key.split('/').pop(), weight: 0 };
    cur.weight += f.add + f.del + 1;
    m.set(key, cur);
  }
  const order = { plugin: 0, app: 1, framework: 2 };
  return [...m.values()].sort((x, y) => order[x.kind] - order[y.kind] || y.weight - x.weight).slice(0, 12);
}

const lit = String.raw`['"\x60]([^'"\x60]{1,120})['"\x60]`;

/** Screens, dialogs, settings tabs, menu items, settings and help a plugin declares (static read of its files). */
export function pluginSurface(dir, app = 'console-web') {
  const abs = join(ROOT, dir);
  const manifest = readJson(join(abs, 'plugin.json'), {}) ?? {};
  const web = readText(join(abs, 'web/index.tsx'), 200000);
  const menu = readText(join(abs, 'web/menu.ts'), 40000);
  const consts = Object.fromEntries([...web.matchAll(/const ([A-Z_]+) = ['"]([^'"]+)['"]/g)].map((m) => [m[1], m[2]]));
  const keyOf = (k) => (k.startsWith('[') ? consts[k.slice(1, -1)] ?? '' : k.replace(/^['"]|['"]$/g, ''));
  const block = (name) => { const i = web.indexOf(`${name}: {`); return i < 0 ? '' : web.slice(i, i + 4000); };
  const screens = [];
  for (const m of block('views').matchAll(new RegExp(String.raw`(\[[A-Z_]+\]|'[a-z0-9.-]+'|[a-z][a-z0-9]*):\s*\{\s*title:\s*${lit}`, 'g'))) {
    const id = keyOf(m[1]); if (id) screens.push({ kind: 'view', id, label: m[2], app, url: APP_URLS[app] ? `${APP_URLS[app]}#/${id}` : '', from: dir });
  }
  // nav entries name the pages for sure (a views key may be a constant imported from another file)
  for (const m of web.matchAll(new RegExp(String.raw`\{\s*id:\s*${lit},\s*label:\s*${lit},\s*icon:\s*${lit},\s*view:\s*${lit}`, 'g'))) {
    if (!screens.some((x) => x.id === m[4])) screens.push({ kind: 'view', id: m[4], label: m[2], app, url: APP_URLS[app] ? `${APP_URLS[app]}#/${m[4]}` : '', from: dir });
  }
  for (const m of block('dialogs').matchAll(new RegExp(String.raw`(\[[A-Z_]+\]|'[a-z0-9.-]+'):\s*\{\s*title:\s*${lit}`, 'g'))) {
    const id = keyOf(m[1]); if (id) screens.push({ kind: 'dialog', id, label: m[2], app, from: dir });
  }
  const tabs = /settingsTabs:\s*\[([\s\S]*?)\]\s*,\s*\n/.exec(web)?.[1] ?? '';
  for (const m of tabs.matchAll(new RegExp(String.raw`id:\s*${lit},\s*label:\s*${lit}`, 'g'))) screens.push({ kind: 'settings', id: m[1], label: m[2], app, from: dir });
  const settings = [...web.matchAll(new RegExp(String.raw`\{\s*key:\s*([A-Za-z0-9_.'"]+),\s*label:\s*${lit}(?:[^}]*?tab:\s*${lit})?`, 'g'))]
    .map((m) => ({ key: m[1].replace(/['"]/g, ''), label: m[2], tab: m[3] ?? '' }));
  const menus = [...`${menu}\n${web}`.matchAll(new RegExp(String.raw`label:\s*${lit}[^}\n]*?action:\s*${lit}`, 'g'))]
    .map((m) => ({ label: m[1], where: m[2].startsWith('settings.open') ? 'settings' : 'menu' }));
  const helpFile = readJson(join(abs, typeof manifest.help === 'string' ? manifest.help : 'help.json'), {}) ?? {};
  const help = (helpFile.data?.entries ?? []).map((e) => ({ id: String(e.target ?? ''), label: String(e.title ?? ''), text: String(e.text ?? '') }));
  const readme = existsSync(join(abs, 'README.md')) ? { path: `${dir}/README.md`, text: readText(join(abs, 'README.md'), 12000) } : null;
  return { name: manifest.name ?? dir.split('/').pop(), description: manifest.description ?? '', screens, settings, menus, help, readme };
}

/** Commands a plugin exposes (REST / MCP / CLI) through plugin-commands@1; [] when that registry can't be read. */
export async function commandsOf(folders) {
  if (!folders.length) return [];
  try {
    const reg = await import('../../../../framework/cli/plugin-commands.mjs');
    const eng = await import('../../../../framework/core/engines/plugin-commands.mjs');
    const r = reg.registry({ folders });
    const tools = eng.pluginCommandTools(r);
    const cli = eng.pluginCommandCli(r).commands;
    const out = [];
    for (const p of r.plugins) for (const c of p.commands ?? []) {
      if (c.source !== 'route' && c.source !== 'declared') continue;
      const t = tools.find((x) => x.plugin === p.folder && x.command === c.id) ?? tools.find((x) => x.name?.endsWith(`_${c.id.replace(/-/g, '_')}`) && x.name.startsWith(p.folder.replace(/-/g, '_')));
      const l = cli.find((x) => x.plugin === p.folder && x.command === c.id);
      out.push({ id: `${p.folder}/${c.id}`, title: c.title, method: c.run?.route?.method ?? '', path: c.run?.route?.path ? `/api/plugins/${p.folder}${c.run.route.path}` : '', mcp: t?.name ?? '', cli: l?.usage ?? '' });
    }
    return out;
  } catch { return []; }
}

/** The whole source for a build (or one of its steps). Throws when the build isn't in the store. */
export async function gather(target, root = ROOT) {
  const b = findBuild(target.build, root);
  if (!b) throw new Error(`no build "${target.build}" in the builds store`);
  const warnings = [];
  const step = target.step ? (b.steps ?? []).find((s) => s.id === target.step) : null;
  if (target.step && !step) throw new Error(`build ${b.id} has no step ${target.step}`);
  const reportPath = `_claude/builds/reports/${b.id}.md`;
  const report = existsSync(join(root, reportPath)) ? { path: reportPath, text: readText(join(root, reportPath), 30000) } : null;
  if (!report) warnings.push('no build report');
  const diff = diffOf(b, root);
  if (!diff.files.length) warnings.push(b.pr || b.branch ? `no diff found for ${b.pr || b.branch} (not merged, or the branch is gone)` : 'no PR or branch on the build');
  const folders = foldersOf(diff.files);
  const screens = []; const settings = []; const menus = []; const help = []; let readme = null; let about = '';
  for (const f of folders.filter((x) => x.kind === 'plugin').slice(0, 4)) {
    const s = pluginSurface(f.path, f.app);
    f.name = s.name;
    about ||= s.description;
    screens.push(...s.screens); settings.push(...s.settings); menus.push(...s.menus); help.push(...s.help);
    readme ??= s.readme;
  }
  if (!readme) { const app = folders.find((x) => x.kind === 'app'); if (app && existsSync(join(root, app.path, 'README.md'))) readme = { path: `${app.path}/README.md`, text: readText(join(root, app.path, 'README.md'), 12000) }; }
  const pluginFolders = folders.filter((x) => x.kind === 'plugin' && x.app === 'console-web').map((x) => x.path.split('/').pop());
  const commands = await commandsOf(pluginFolders);
  return normSource({
    build: { ...b, profile: b.profile ?? (Array.isArray(b.profiles) ? b.profiles[0] : '') },
    step: step ? { id: step.id, text: step.text } : null,
    origin: origin(b, root),
    report, diff, folders, screens, commands, settings, menus, help, readme, about, warnings,
  });
}

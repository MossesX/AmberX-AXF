#!/usr/bin/env node
/**
 * projects — projects@1: separate workspaces, each with its own builds, notes, to-dos, tasks, lists and plans.
 * Rules and changes: framework/plan/projects-core.mjs. Registry: framework/plan/projects.json in the hub's shared data
 * (/projects/<repo>/_data/…, axhub memory "data" area), the repo copy where there is no hub.
 *
 * Each project owns one build profile (build-profiles@1); the active project is the active profile's project, so the
 * builds store, orchestrator, build queue, pending list and plan follow it with no extra switch. The base project,
 * AmberX AXF, owns the base profile (`all`): everything from before projects is its, in place (`migrate` records it).
 * Plugins keep a project's data in `<data folder>/projects/<id>/` (projectDataDir; the base project: the folder itself).
 *
 *   node framework/cli/projects.mjs                       list (★ = active)
 *   node framework/cli/projects.mjs current               the active project
 *   node framework/cli/projects.mjs new "<name>" [--id x] [--description "…"] [--no-select]   an empty workspace
 *   node framework/cli/projects.mjs select <id|name>      make it the active project (saved for everyone)
 *   node framework/cli/projects.mjs rename <id> "<name>" [--description "…"]
 *   node framework/cli/projects.mjs archive <id> --confirm <id> | unarchive <id>
 *   node framework/cli/projects.mjs delete <id> --confirm <id>   off the list (data stays on disk)
 *   node framework/cli/projects.mjs migrate               record the base project (AmberX AXF) and one project per
 *                                                         existing build profile; safe to run again
 *   node framework/cli/projects.mjs owns [<id>]           what a project keeps as its own, and where each scope lives
 *   node framework/cli/projects.mjs own <id> <scope> [--from shared|<id>]   give it its own copy (copied, never blank)
 *   node framework/cli/projects.mjs share <id> <scope>    share the scope again (its own copy stays on disk)
 *   node framework/cli/projects.mjs accounts <id> [--add a,b] [--remove c] [--active a]   its own Claude account set
 *   node framework/cli/projects.mjs act '{"action":"create","name":"…"}'   any change (console server, MCP, voice)
 *   --json on any command prints one JSON line.
 *
 * Who: AXF_ACTOR (else "cli") is recorded as createdBy on new projects.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/projects-core.mjs';
import { BASE_PROFILE, activeProfile, baseDataPath, readProfiles } from './persist.mjs';

export const { PROJECTS_REL, BASE_PROJECT, SCHEMA, SCOPES } = core;
const now = () => new Date().toISOString();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** The console's private folder (credential vault, plugin data): AXF_CONSOLE_DIR overrides it (tests). */
const consoleDir = () => process.env.AXF_CONSOLE_DIR || join(ROOT, '.axf-console');
const pluginsDir = () => process.env.AXF_PLUGINS_DIR || join(ROOT, 'apps', 'console-web', 'plugins');

/**
 * The stores each scope covers, as { what, dir, files, secret }: `dir` is the shared location, the own copy lives in
 * scopeDir(dir, project, scope). Plugin stores come from each plugin's manifest (lifecycle.projectScoped:
 * [{ scope, files }], files relative to its dataDir), so this file never names a plugin.
 */
export function scopeStores(scope) {
  const out = [];
  if (scope === 'credentials') out.push({ what: 'credential vault', dir: consoleDir(), files: ['secrets.env'], secret: true });
  if (scope === 'plugins') out.push({ what: 'plugin switches', dir: consoleDir(), files: ['plugins.json'] });
  if (scope === 'claude-accounts') out.push({ what: 'Claude account set', registry: true });
  if (scope === 'console' || scope === 'hub') out.push({ what: scope === 'hub' ? 'axHub connection' : 'console settings', registry: true });
  let folders = [];
  try { folders = readdirSync(pluginsDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { folders = []; }
  for (const f of folders) {
    let m;
    try { m = JSON.parse(readFileSync(join(pluginsDir(), f, 'plugin.json'), 'utf8')); } catch { continue; }
    const life = m?.lifecycle ?? {};
    for (const ps of Array.isArray(life.projectScoped) ? life.projectScoped : []) {
      if (ps?.scope !== scope || typeof life.dataDir !== 'string') continue;
      const dataDir = life.dataDir.startsWith('.axf-console/') && process.env.AXF_CONSOLE_DIR ? join(consoleDir(), life.dataDir.slice('.axf-console/'.length)) : join(ROOT, life.dataDir);
      out.push({ what: `${m.name || f} settings`, dir: dataDir, files: (ps.files ?? []).filter((x) => typeof x === 'string' && !x.includes('..')), secret: !!ps.secret });
    }
  }
  return out;
}

/** Where every scope of project `p` lives now: { scope: [paths] } (the registry for scopes kept on the record). */
export function whereOf(p) {
  const where = {};
  for (const scope of core.SCOPES) {
    where[scope] = scopeStores(scope).map((st) => (st.registry ? `${registryFile()} (project ${p.id})` : join(core.scopeDir(st.dir, p, scope), st.files.length === 1 ? st.files[0] : '')));
  }
  return where;
}

/** Copy one scope's files from `fromP` (null = the shared set) into `toP`'s own folder (0600 for secret files). */
function copyScope(scope, fromP, toP) {
  const log = [];
  for (const st of scopeStores(scope)) {
    if (st.registry) continue;
    const src = fromP ? core.scopeDir(st.dir, fromP, scope) : st.dir;
    const dst = core.projectDir(st.dir, toP);
    for (const f of st.files) {
      const from = join(src, f);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(dst, f)), { recursive: true, mode: 0o700 });
      copyFileSync(from, join(dst, f));
      if (st.secret || f.endsWith('.env') || f === 'keys.json') chmodSync(join(dst, f), 0o600);
      log.push(`  copied ${st.what}: ${f}`);
    }
  }
  return log;
}

/** The Claude logins saved on this machine (~/.claude-accounts/<name>/) and the active one: the shared set. */
export function savedAccounts() {
  const home = process.env.AXF_CLAUDE_ACCOUNTS_HOME || join(process.env.HOME || '/root', '.claude-accounts');
  let members = [];
  try { members = readdirSync(home, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-z0-9-]{1,32}$/.test(d.name) && d.name !== core.PROJECTS_SUBDIR).map((d) => d.name).sort(); } catch { members = []; }
  let active = '';
  for (const f of ['.active', 'active']) { try { active = readFileSync(join(home, f), 'utf8').trim(); break; } catch { /* next */ } }
  return { members, active: members.includes(active) ? active : '' };
}

/** What project `id` (default: the one in force) owns, and where each scope lives. */
export function ownsOf(id) {
  const reg = readProjects();
  const p = id ? reg.projects.find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase()) : core.projectOfProfile(reg, activeProfile().id);
  if (!p) throw new Error(`no project "${id}"`);
  return { project: p.id, name: p.name, base: p.base, owns: p.owns, ownedAt: p.ownedAt, accounts: core.accountSet(p), where: whereOf(p) };
}

export const registryFile = () => baseDataPath(PROJECTS_REL);

/** The registry (base project always there). Never throws. */
export function readProjects() {
  let raw = null;
  try { raw = JSON.parse(readFileSync(registryFile(), 'utf8')); } catch { /* missing or damaged → base only */ }
  return core.normalizeRegistry(raw, { baseProfile: BASE_PROFILE });
}

function save(reg) {
  const f = registryFile();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(core.registryOut(reg, now()), null, 1)}\n`);
  renameSync(tmp, f);
}

/** The project in force: the one owning the active build profile (AXF_BUILD_PROFILE pins it for one process). */
export function activeProject(reg = readProjects()) {
  return { ...core.projectOfProfile(reg, activeProfile().id), active: true };
}

/** Where a plugin keeps the active (or given) project's data, given its own data folder. */
export function projectDataDir(baseDir, project = activeProject()) {
  return project.base ? baseDir : join(baseDir, core.PROJECTS_SUBDIR, project.id);
}

/** Registry + active flag + builds per project (what the console, MCP and voice read). */
export async function state() {
  const reg = readProjects();
  const act = activeProject(reg);
  let counts = {};
  try {
    const { loadStore } = await import('./builds-store.mjs');
    const store = loadStore();
    for (const p of reg.projects) {
      const list = store.builds.filter((b) => !b.deleted && (b.profiles ?? []).includes(p.profile));
      counts[p.id] = { builds: list.length, open: list.filter((b) => !['complete', 'archived'].includes(b.status)).length };
    }
  } catch { counts = {}; }
  return {
    $axf: core.SCHEMA,
    active: act.id,
    activeProject: act,
    file: registryFile(),
    scopes: core.SCOPES.map((id) => ({ id, label: core.SCOPE_LABELS[id] })),
    projects: reg.projects.map((p) => ({ ...p, active: p.id === act.id, counts: counts[p.id] ?? null, where: whereOf(p) })),
  };
}

/** Apply a build-profile change through the profiles CLI module (lazy: it imports the builds store). */
async function profileChange(pc) {
  const profiles = await import('./profiles.mjs');
  if (pc.action === 'remove') {
    if (pc.selectFirst) profiles.act({ action: 'select', id: pc.selectFirst });
    if (!readProfiles().profiles.some((p) => p.id === pc.id)) return { log: [] };
    return profiles.act({ action: 'remove', id: pc.id, confirm: pc.confirm });
  }
  if (pc.action === 'create' && readProfiles().profiles.some((p) => p.id === pc.id)) {
    return pc.select ? profiles.act({ action: 'select', id: pc.id }) : { log: [] };
  }
  return profiles.act(pc);
}

/** One change. Returns { project, log, state }. */
export async function act(change) {
  const reg = readProjects();
  const ctx = { now: now(), by: process.env.AXF_ACTOR || 'cli', activeProfile: activeProfile().id, profileIds: readProfiles().profiles.map((p) => p.id), accounts: savedAccounts() };
  const r = core.applyChange(reg, change, ctx);
  const log = [...r.log];
  // Copies first, registry last: the registry never says "own" while the folder is missing.
  if (r.copy) log.push(...copyScope(r.copy.scope, r.copy.from === 'shared' ? null : r.reg.projects.find((p) => p.id === r.copy.from), r.project));
  if (r.profile) { const pr = await profileChange(r.profile); log.push(...(pr.log ?? []).map((l) => `  ${l}`)); }
  save(r.reg);
  return { project: r.project ? { ...r.project } : null, log, state: await state() };
}

/** Record the base project and one project per existing build profile (idempotent). */
export async function migrate() {
  const reg = readProjects();
  const log = [];
  for (const p of readProfiles().profiles) {
    if (p.id === BASE_PROFILE || reg.projects.some((x) => x.profile === p.id)) continue;
    reg.projects.push({ id: p.id, name: p.name || p.id, description: p.description || '', profile: p.id, status: 'active', createdAt: p.createdAt || now(), updatedAt: now(), base: false });
    log.push(`project "${p.name || p.id}" recorded for build profile ${p.id}`);
  }
  save(reg);
  const s = await state();
  const base = s.projects.find((p) => p.base);
  log.unshift(`${base.name} (${base.id}) owns build profile ${base.profile}: ${base.counts?.builds ?? '?'} build(s), and every note, to-do, task, list and plan already kept in the plugins' own folders`);
  log.push(`${base.name} is the shared set: the current Claude accounts, credentials, plugin settings, console settings and axHub connection stay where they are and are its (nothing moved)`);
  return { log, state: s };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const VALUED = ['--id', '--description', '--confirm', '--name', '--from', '--add', '--remove', '--active', '--carry'];
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1])));
  const out = (v) => console.log(json ? JSON.stringify({ ok: true, ...v }) : v.text ?? JSON.stringify(v, null, 2));
  try {
    const cmd = pos[0] ?? 'list';
    if (cmd === 'list' || cmd === 'state') {
      const s = await state();
      out({ ...s, text: s.projects.map((p) => `${p.active ? '★' : ' '} ${p.id.padEnd(24)} ${p.name}${p.base ? ' (main)' : ''}${p.status === 'archived' ? ' [archived]' : ''} · ${p.counts?.open ?? 0} open / ${p.counts?.builds ?? 0} builds`).join('\n') });
    } else if (cmd === 'current') {
      const p = activeProject(); out({ project: p, text: `${p.name} (${p.id})` });
    } else if (cmd === 'owns') {
      const o = ownsOf(pos[1]);
      out({ ...o, text: [`${o.name} (${o.project})${o.base ? ': the shared set' : ''}`, ...core.SCOPES.map((sc) => `  ${o.owns.includes(sc) ? 'own   ' : 'shared'} ${sc.padEnd(16)} ${o.where[sc].join(', ')}`)].join('\n') });
    } else if (cmd === 'migrate') {
      const r = await migrate(); out({ ...r, text: r.log.join('\n') });
    } else {
      let change;
      if (cmd === 'act') change = JSON.parse(pos[1] ?? flag('--json') ?? '{}');
      else if (cmd === 'new' || cmd === 'create') change = { action: 'create', name: pos[1], id: flag('--id'), description: flag('--description'), select: !args.includes('--no-select') };
      else if (cmd === 'select' || cmd === 'switch') change = { action: 'select', id: pos[1] };
      else if (cmd === 'own') change = { action: 'own', id: pos[1], scope: pos[2], from: flag('--from'), reseed: args.includes('--reseed') };
      else if (cmd === 'share') change = { action: 'share', id: pos[1], scope: pos[2] };
      else if (cmd === 'accounts') {
        if (!flag('--add') && !flag('--remove') && flag('--active') === undefined) { const o = ownsOf(pos[1]); out({ ...o, text: o.accounts ? `${o.name}: ${o.accounts.members.join(', ') || 'no accounts'}${o.accounts.active ? ` (active ${o.accounts.active})` : ''}` : `${o.name} uses every saved Claude account (shared)` }); process.exit(0); }
        const list = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
        change = { action: 'accounts', id: pos[1], add: list(flag('--add')), remove: list(flag('--remove')), ...(flag('--active') !== undefined ? { active: flag('--active') } : {}) };
      } else if (cmd === 'rename') change = { action: 'update', id: pos[1], name: pos[2], description: flag('--description') };
      else if (cmd === 'archive' || cmd === 'unarchive' || cmd === 'delete') change = { action: cmd, id: pos[1], confirm: flag('--confirm') };
      else throw new Error(`unknown command ${cmd}`);
      const r = await act(change);
      out({ ...r, text: r.log.join('\n') });
    }
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exit(1);
  }
}

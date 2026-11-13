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
 *                                      [--repo owner/name] [--skin <skin id>] [--seed none|demo]
 *                                      (--seed demo: clearly marked test data: nested lists, to-dos, notes, plans,
 *                                      builds; framework/plan/project-seed-core.mjs). Every new project also gets its
 *                                      hub home /projects/<id>/ with _claude/ and a validated project.manifest.json.
 *   node framework/cli/projects.mjs select <id|name>      make it the active project (saved for everyone)
 *   node framework/cli/projects.mjs rename <id> "<name>" [--description "…"]
 *   node framework/cli/projects.mjs archive <id> --confirm <id> | unarchive <id>
 *   node framework/cli/projects.mjs delete <id> --confirm <id>   off the list (data stays on disk)
 *   node framework/cli/projects.mjs migrate               record the base project (AmberX AXF) and one project per
 *                                                         existing build profile; safe to run again
 *   node framework/cli/projects.mjs act '{"action":"create","name":"…"}'   any change (console server, MCP, voice)
 *   --json on any command prints one JSON line.
 *
 * Who: AXF_ACTOR (else "cli") is recorded as createdBy on new projects.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/projects-core.mjs';
import * as home from './project-home.mjs';
import { BASE_PROFILE, activeProfile, baseDataPath, readProfiles } from './persist.mjs';

export const { PROJECTS_REL, BASE_PROJECT, SCHEMA } = core;
const now = () => new Date().toISOString();

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
    projects: reg.projects.map((p) => ({ ...p, active: p.id === act.id, counts: counts[p.id] ?? null })),
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

/** A create's checks that need the disk (the skin exists, the hub folder is free, the manifest passes), before any write. */
async function checkCreate(project) {
  if (project.skin) {
    const { skinRows } = await import('./skins.mjs');
    if (!skinRows().some((s) => s.id === project.skin)) throw new Error(`skin: no skin "${project.skin}" (node framework/cli/skins.mjs list)`);
  }
  const conflict = home.homeConflict(project.id);
  if (conflict) throw new Error(conflict);
  home.checkManifest(home.projectManifest(project, { seed: project.seed ?? 'none' }));
}

/**
 * One change. Returns { project, log, state } and, for a create, `home` (its hub folder and validated manifest) and
 * `seed` (what the demo data put where). A create is checked in full before anything is written.
 */
export async function act(change) {
  const reg = readProjects();
  const by = process.env.AXF_ACTOR || 'cli';
  const ctx = { now: now(), by, activeProfile: activeProfile().id, profileIds: readProfiles().profiles.map((p) => p.id) };
  const r = core.applyChange(reg, change, ctx);
  const creating = change?.action === 'create';
  if (creating) await checkCreate(r.project);
  const log = [...r.log];
  if (r.profile) { const pr = await profileChange(r.profile); log.push(...(pr.log ?? []).map((l) => `  ${l}`)); }
  save(r.reg);
  const out = { project: r.project ? { ...r.project } : null, log };
  if (creating) {
    const h = home.makeHome(r.project, { by, seed: r.project.seed ?? 'none' });
    out.home = { dir: h.dir, manifestFile: h.manifestFile, manifest: h.manifest, validation: h.validation };
    log.push(`home: ${h.dir} (project.manifest.json passes the Standards rules${h.validation.warnings.length ? `, ${h.validation.warnings.length} warning(s)` : ''})`);
    if (r.project.seed === 'demo') {
      const { seedProject } = await import('./project-seed.mjs');
      const s = await seedProject(r.project, { kind: 'demo', by });
      out.seed = { kind: 'demo', counts: s.counts, skipped: s.skipped };
      log.push(...s.log);
    }
  }
  return { ...out, state: await state() };
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
  return { log, state: s };
}

/** The CLI. Not run as a top-level await: seeding imports plugin modules that import this one back. */
async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const VALUED = ['--id', '--description', '--confirm', '--name', '--repo', '--skin', '--seed'];
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
    } else if (cmd === 'migrate') {
      const r = await migrate(); out({ ...r, text: r.log.join('\n') });
    } else {
      let change;
      if (cmd === 'act') change = JSON.parse(pos[1] ?? flag('--json') ?? '{}');
      else if (cmd === 'new' || cmd === 'create') change = { action: 'create', name: pos[1], id: flag('--id'), description: flag('--description'), repo: flag('--repo'), skin: flag('--skin'), seed: flag('--seed'), select: !args.includes('--no-select') };
      else if (cmd === 'select' || cmd === 'switch') change = { action: 'select', id: pos[1] };
      else if (cmd === 'rename') change = { action: 'update', id: pos[1], name: pos[2], description: flag('--description') };
      else if (cmd === 'archive' || cmd === 'unarchive' || cmd === 'delete') change = { action: cmd, id: pos[1], confirm: flag('--confirm') };
      else throw new Error(`unknown command ${cmd}`);
      const r = await act(change);
      out({ ...r, text: r.log.join('\n') });
    }
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();

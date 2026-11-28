#!/usr/bin/env node
/**
 * profiles — build profiles (build-profiles@1).
 *
 * A build profile is one complete set of work data: the pending build list, the plan (+ media), the build queue,
 * catalog status, tracker.json and the Build orchestrator's tracker. One profile is active; every CLI, the console
 * server and its plugins read and write the active profile's copy (resolution lives in persist.mjs → dataPath()).
 * "all" is the base profile and keeps the original paths (since Nov 7 2026; it took over from "main-framework" when
 * every profile was merged into it); any other profile lives under framework/plan/profiles/<id>/ (hub shared data)
 * and _claude/builds/profiles/<id>/orchestrator.json (repo, only when the repo's framework/plan/profiles.json lists
 * it; a profile registered only on the hub keeps that export in its shared-data folder: persist.mjs hasRepoExport).
 *
 *   node framework/cli/profiles.mjs                         list (★ = active)
 *   node framework/cli/profiles.mjs current                 the active profile
 *   node framework/cli/profiles.mjs select <id>             make <id> the active profile (saved for everyone)
 *   node framework/cli/profiles.mjs create "<name>" [--id x] [--description "…"] [--copy-from <id>] [--catalog] [--select]
 *                                                           new profile; empty unless --copy-from; --catalog lets plan
 *                                                           rebuilds import seed.json + the feature catalog
 *   node framework/cli/profiles.mjs get <id>                one profile: its numbers, builds and files
 *   node framework/cli/profiles.mjs update <id> [--name "…"] [--description "…"] [--catalog on|off] [--color <name>] [--icon <name>]
 *                                                           --color / --icon name a colour / icon asset ('' = default)
 *   node framework/cli/profiles.mjs duplicate <id> "<name>" [--id x] [--description "…"] [--no-builds] [--select]
 *                                                           a second profile with copies of the files; the builds are
 *                                                           the same records, shown in both (--no-builds: none)
 *   node framework/cli/profiles.mjs merge <from> <into> [--keep]   every build of <from> moves to <into>; <from> comes
 *                                                           off the list (restorable) unless --keep
 *   node framework/cli/profiles.mjs move-builds <to> <build…> [--from <id>]   builds to another profile
 *   node framework/cli/profiles.mjs archive <id> | unarchive <id>   hide from the pickers / show again
 *   node framework/cli/profiles.mjs remove <id> --confirm <id>   off the list; its data stays and `restore` brings it
 *                                                           back. The base and the active profile can't go.
 *   node framework/cli/profiles.mjs restore <id>            a removed profile back on the list
 *   node framework/cli/profiles.mjs purge <id> --confirm "delete <id>" --owner   delete its data too, for good: files
 *                                                           and builds that live only in it. Owner only.
 *   node framework/cli/profiles.mjs cleanup [--profile <id>] [--fix [<build…>]]   archived builds that are really
 *                                                           finished, builds in a profile that no longer exists
 *   node framework/cli/profiles.mjs where [<id>]            the files of a profile
 *   node framework/cli/profiles.mjs merge-all               fold the retired profiles (main-framework, current, urgent,
 *                                                           angel, big-dog, breakroom, refactor) into `all` for good,
 *                                                           select it and delete the old profile folders (repo + hub)
 *   node framework/cli/profiles.mjs act --json '{"action":"select","id":"all"}'   any change (console server)
 *   --json on any command prints JSON.
 *
 * AXF_BUILD_PROFILE=<id> makes one process (a session, a CI job) use another profile without changing the saved pick.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_PROFILE, PROFILED, PROFILES_REL, TRACKER_REL, PROFILE_COLOR, PROFILE_ICON, PROFILE_ID, REPO_ROOT, activeProfile,
  baseDataPath, emptyProfileFile, knownProfileIds, orchestratorPath, persistRoot, profileRel, readProfiles,
} from './persist.mjs';
import * as core from '../plan/builds-store-core.mjs';
import { MERGED_PROFILE, RETIRED_PROFILES, resolveProfile } from '../plan/builds-store-core.mjs';
import { spendOf } from '../core/build-budget.mjs';
import { loadStore, mergeRetiredNow, storeFile, withStore } from './builds-store.mjs';
import { readCaps, readMeters } from './build-budget.mjs';

export const SCHEMA = 'build-profiles@1';
const now = () => new Date().toISOString();
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const slugId = (s) => str(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function writeJson(f, data) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  renameSync(tmp, f);
}

function saveRegistry(reg) {
  const out = { $axf: SCHEMA, updatedAt: now(), active: reg.active, profiles: reg.profiles.map(({ base, ...p }) => p), ...(reg.removed?.length ? { removed: reg.removed.map(({ base, ...p }) => p) } : {}) };
  writeJson(baseDataPath(PROFILES_REL), out);
  return readProfiles();
}

/** Where profile `id`'s data lives (absolute paths). */
export function profileFiles(id) {
  const root = persistRoot() ?? REPO_ROOT;
  const files = Object.fromEntries(PROFILED.map((rel) => [rel, id === BASE_PROFILE ? baseDataPath(rel) : join(root, profileRel(id, rel))]));
  return { ...files, [TRACKER_REL]: baseDataPath(TRACKER_REL), orchestrator: orchestratorPath(id) };
}

/** Start a profile's files: copies of `from`, or empty ones. Never overwrites a file that is already there. */
function seedProfile(id, from, { builds: withBuilds = true } = {}) {
  const src = from ? profileFiles(from) : null;
  const dst = profileFiles(id);
  for (const rel of PROFILED) {
    const to = dst[rel];
    if (existsSync(to)) continue;
    mkdirSync(rel.endsWith('/') ? to : dirname(to), { recursive: true });
    if (src && existsSync(src[rel])) { cpSync(src[rel], to, { recursive: true }); continue; }
    const snapshot = join(REPO_ROOT, profileRel(id, rel)); // the profile's repo snapshot (as dataPath seeds it)
    if (!src && resolve(snapshot) !== resolve(to) && existsSync(snapshot)) { cpSync(snapshot, to, { recursive: true }); continue; }
    const empty = emptyProfileFile(rel);
    if (empty) writeJson(to, empty);
  }
  if (!existsSync(dst.orchestrator)) {
    let rules = null;
    try { rules = JSON.parse(readFileSync(profileFiles(from ?? BASE_PROFILE).orchestrator, 'utf8')).rules; } catch { /* defaults */ }
    let builds = [];
    if (src && withBuilds) { try { builds = JSON.parse(readFileSync(src.orchestrator, 'utf8')).builds ?? []; } catch { /* none */ } }
    writeJson(dst.orchestrator, { $axf: 'orchestrator@1', updatedAt: now(), ...(rules ? { rules } : {}), builds });
  }
}

/**
 * Take away the folders of profiles that no longer exist (Brett, Nov 7 2026: "delete the old profile folders
 * everywhere"): every retired profile's `_claude/builds/profiles/<id>/` and `framework/plan/profiles/<id>/`, in the
 * repo and on the hub, and the base profile's own old folder (`all` lived there before it became the base; its
 * matrices move to `_claude/builds/matrices.json` when that is missing, its exports are stale). Their builds are in
 * the store already (the merge reads the store, not these files). Returns the paths removed.
 */
export function pruneRetiredFolders({ roots = [REPO_ROOT, persistRoot()].filter(Boolean) } = {}) {
  const removed = [];
  const rm = (f) => { if (existsSync(f)) { rmSync(f, { recursive: true, force: true }); removed.push(f); } };
  for (const root of [...new Set(roots)]) {
    for (const id of RETIRED_PROFILES) { rm(join(root, '_claude/builds/profiles', id)); rm(join(root, profileRel_(id))); }
    const own = join(root, '_claude/builds/profiles', BASE_PROFILE);
    const mx = join(own, 'matrices.json'); const top = join(root, '_claude/builds/matrices.json');
    if (existsSync(mx) && !existsSync(top)) { renameSync(mx, top); removed.push(`${mx} → ${top}`); }
    rm(join(own, 'orchestrator.json'));
    rm(join(root, profileRel_(BASE_PROFILE)));
    for (const d of [own, join(root, '_claude/builds/profiles'), join(root, 'framework/plan/profiles')]) { try { if (existsSync(d) && !readdirSync(d).length) rmSync(d, { recursive: true }); } catch { /* not empty */ } }
  }
  return removed;
}
/** A profile's own data folder (profileRel resolves retired ids to `all`, so the raw folder is built here). */
const profileRel_ = (id) => `framework/plan/profiles/${id}`;

/** The look fields of a change ({ color, icon }): only the ones given; '' clears; a bad name throws. */
function look(c) {
  const out = {};
  for (const [k, re] of [['color', PROFILE_COLOR], ['icon', PROFILE_ICON]]) {
    if (typeof c[k] !== 'string') continue;
    const v = c[k].trim();
    if (v && !re.test(v)) throw new Error(`${k}: the name of a ${k === 'color' ? 'colour' : 'icon'} asset (lowercase letters, digits and dashes)`);
    out[k] = v;
  }
  return out;
}

/** Delete a profile's own folders, in the repo and on the hub (never the base profile's files). Returns what went. */
function purgeFiles(id) {
  if (!PROFILE_ID.test(id) || resolveProfile(id) === BASE_PROFILE) return [];
  const removed = [];
  for (const root of new Set([REPO_ROOT, persistRoot()].filter(Boolean))) {
    for (const d of [join(root, profileRel_(id)), join(root, '_claude/builds/profiles', id)]) {
      if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); removed.push(d); }
    }
  }
  return removed;
}

/** One change to the registry (and, for the builds of a profile, the builds store). Returns { registry, profile?, report?, log }. */
export function act(change) {
  const c = change && typeof change === 'object' ? change : {};
  const reg = readProfiles();
  const find = (id) => { const p = reg.profiles.find((x) => x.id === resolveProfile(id)); if (!p) throw new Error(reg.removed.some((x) => x.id === id) ? `build profile "${id}" was removed: restore it first` : `no build profile "${id}"`); return p; };
  const by = str(process.env.AXF_ACTOR, 80) || str(c.by, 80) || 'profiles';
  const newId = (name, given) => {
    const id = given ? str(given, 40) : slugId(name);
    if (!PROFILE_ID.test(id)) throw new Error('id: lowercase letters, digits and dashes, up to 40');
    if (reg.profiles.some((p) => p.id === id)) throw new Error(`"${id}" already exists`);
    if (RETIRED_PROFILES.includes(id)) throw new Error(`"${id}" was merged into "${MERGED_PROFILE}" (Nov 7 2026); pick another id`);
    return id;
  };
  const log = [];
  switch (c.action) {
    case 'select': {
      const p = find(str(c.id, 40));
      if (p.archived) throw new Error(`build profile ${p.id} is archived: unarchive it first`);
      reg.active = p.id;
      seedProfile(p.id, null); // a profile chosen for the first time on this machine gets its files
      log.push(`active build profile → ${p.name} (${p.id})`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'create': {
      const name = str(c.name, 80);
      if (!name) throw new Error('a profile needs a name');
      const id = newId(name, c.id);
      const from = c.copyFrom ? find(str(c.copyFrom, 40)).id : null;
      // an id that was taken off the list comes back with its data (its files were never touched)
      const was = reg.removed.find((x) => x.id === id);
      const { removedAt, removedBy, mergedInto, archived, archivedAt, ...kept } = was ?? {};
      const p = { ...kept, id, name, description: typeof c.description === 'string' ? str(c.description, 600) : kept.description ?? '', createdAt: kept.createdAt || now(), updatedAt: now(), catalog: c.catalog === true, ...(from ? { copiedFrom: from } : {}), ...look(c) };
      seedProfile(id, from);
      reg.removed = reg.removed.filter((x) => x.id !== id);
      reg.profiles.push(p);
      if (c.select === true) reg.active = id;
      log.push(`build profile "${name}" (${id}) ${was ? 'restored with its data' : `created${from ? ` from ${from}` : ' empty'}`}${c.select === true ? ' and selected' : ''}`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'update': {
      const p = find(str(c.id, 40));
      if (typeof c.name === 'string') { if (!str(c.name, 80)) throw new Error('a profile needs a name'); p.name = str(c.name, 80); }
      if (typeof c.description === 'string') p.description = str(c.description, 600);
      if (typeof c.catalog === 'boolean') p.catalog = c.catalog;
      for (const [k, v] of Object.entries(look(c))) { if (v) p[k] = v; else delete p[k]; }
      p.updatedAt = now();
      log.push(`build profile ${p.id} updated`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'remove': {
      const p = find(str(c.id, 40));
      if (p.id === BASE_PROFILE) throw new Error('the main profile stays');
      if (p.id === reg.active) throw new Error('pick another profile before removing the active one');
      if (c.confirm !== p.id) throw new Error(`type the profile id (${p.id}) to confirm`);
      reg.profiles = reg.profiles.filter((x) => x !== p);
      reg.removed.push({ ...p, removedAt: now(), removedBy: by });
      log.push(`build profile ${p.id} taken off the list (its data stays; restore "${p.id}" to get it back)`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'restore': {
      const id = str(c.id, 40);
      const was = reg.removed.find((x) => x.id === id);
      if (!was) throw new Error(reg.profiles.some((x) => x.id === id) ? `build profile ${id} is on the list already` : `no removed build profile "${id}"`);
      const { removedAt, removedBy, mergedInto, ...p } = was;
      p.updatedAt = now();
      seedProfile(p.id, null); // files that went missing meanwhile start empty; what is there is kept
      reg.removed = reg.removed.filter((x) => x !== was);
      reg.profiles.push(p);
      log.push(`build profile "${p.name}" (${p.id}) restored`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'archive': case 'unarchive': {
      const p = find(str(c.id, 40));
      const on = c.action === 'archive';
      if (on && p.id === BASE_PROFILE) throw new Error('the main profile stays');
      if (on && p.id === reg.active) throw new Error('pick another profile before archiving the active one');
      if (on) { p.archived = true; p.archivedAt = now(); } else { delete p.archived; delete p.archivedAt; }
      p.updatedAt = now();
      log.push(`build profile ${p.id} ${on ? 'archived (hidden from the pickers; its data stays)' : 'unarchived'}`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'duplicate': {
      const src = find(str(c.id, 40));
      const name = str(c.name, 80) || `${src.name} copy`;
      let id = c.newId ? newId(name, c.newId) : slugId(name);
      if (!c.newId) { const taken = new Set([...knownProfileIds(reg), ...RETIRED_PROFILES]); const stem = id.slice(0, 36) || 'profile'; id = stem; for (let n = 2; taken.has(id); n += 1) id = `${stem}-${n}`; id = newId(name, id); }
      if (reg.removed.some((x) => x.id === id)) throw new Error(`"${id}" was removed and still has its data: restore it, or pick another id`);
      const withBuilds = c.builds !== false;
      const p = { id, name, description: typeof c.description === 'string' ? str(c.description, 600) : src.description ?? '', createdAt: now(), updatedAt: now(), catalog: src.base ? false : src.catalog === true, copiedFrom: src.id, ...(src.color ? { color: src.color } : {}), ...(src.icon ? { icon: src.icon } : {}) };
      seedProfile(id, src.id, { builds: withBuilds });
      let shared = 0;
      if (withBuilds) shared = withStore((s) => core.shareBuilds(s, src.id, id), { by, action: 'profile-duplicate', note: `${src.id} → ${id}` }).report.shared;
      reg.profiles.push(p);
      if (c.select === true) reg.active = id;
      log.push(`build profile "${name}" (${id}) duplicated from ${src.id}: files copied, ${withBuilds ? `${shared} build(s) shown in both` : 'no builds'}${c.select === true ? '; selected' : ''}`);
      return { registry: saveRegistry(reg), profile: p, shared, log };
    }
    case 'merge': {
      const from = find(str(c.from, 40)); const into = find(str(c.into, 40));
      if (from.id === into.id) throw new Error('pick two different profiles to merge');
      if (from.id === BASE_PROFILE) throw new Error('the main profile stays: merge the other profile into it');
      const report = withStore((s) => core.mergeProfiles(s, [from.id], into.id, { note: (a, b) => `Merged from build profile "${a}" into "${b}".` }), { by, action: 'profile-merge', note: `${from.id} → ${into.id}` }).report;
      if (reg.active === from.id) { reg.active = into.id; log.push(`active build profile → ${into.name} (${into.id})`); }
      if (c.keep !== true) { reg.profiles = reg.profiles.filter((x) => x !== from); reg.removed.push({ ...from, removedAt: now(), removedBy: by, mergedInto: into.id }); }
      into.updatedAt = now();
      log.push(`build profile ${from.id} merged into ${into.id}: ${report.moved} build(s) moved${report.shared.length ? `, ${report.shared.length} already in both` : ''}; ${c.keep === true ? `${from.id} stays on the list, empty` : `${from.id} taken off the list (restorable)`}. Its plan and catalog files stay in its folder.`);
      return { registry: saveRegistry(reg), profile: into, report, log };
    }
    case 'move-builds': {
      const to = find(str(c.to, 40));
      const from = c.from ? find(str(c.from, 40)) : null;
      const ids = (Array.isArray(c.ids) ? c.ids : [c.ids]).map((x) => str(x, 80)).filter(Boolean);
      if (!ids.length) throw new Error('name the builds to move');
      if (from && from.id === to.id) throw new Error('the builds are in that profile already');
      const report = withStore((s) => core.moveBuilds(s, ids, { from: from?.id ?? '', to: to.id, by }), { by, action: 'profile-move-builds', note: `${ids.length} build(s) → ${to.id}` }).report;
      log.push(`${report.moved.length} build(s) moved to ${to.id}${report.skipped.length ? `; skipped ${report.skipped.map((x) => `${x.id} (${x.why})`).join(', ')}` : ''}`);
      return { registry: reg, profile: to, report, log };
    }
    case 'purge': {
      const id = str(c.id, 40);
      const p = reg.profiles.find((x) => x.id === id) ?? reg.removed.find((x) => x.id === id);
      if (!p) throw new Error(`no build profile "${id}"`);
      if (p.id === BASE_PROFILE) throw new Error('the main profile stays');
      if (p.id === reg.active) throw new Error('pick another profile before deleting the active one');
      if (c.owner !== true) throw new Error('only the owner can delete a profile\'s data');
      if (c.confirm !== `delete ${p.id}`) throw new Error(`this can't be undone: type "delete ${p.id}" to confirm`);
      const report = withStore((s) => core.purgeProfile(s, p.id, { by }), { by, action: 'profile-purge', note: p.id }).report;
      const files = purgeFiles(p.id);
      reg.profiles = reg.profiles.filter((x) => x.id !== p.id); reg.removed = reg.removed.filter((x) => x.id !== p.id);
      log.push(`build profile ${p.id} deleted for good: ${report.deleted.length} build(s) deleted, ${report.untagged.length} kept in their other profile, ${files.length} folder(s) removed`);
      return { registry: saveRegistry(reg), report, files, log };
    }
    case 'cleanup-fix': {
      const ids = Array.isArray(c.ids) && c.ids.length ? c.ids.map((x) => str(x, 80)) : null;
      const kinds = Array.isArray(c.kinds) && c.kinds.length ? c.kinds : null;
      const profile = c.profile ? find(str(c.profile, 40)).id : '';
      const r = withStore((s) => core.cleanupFix(s, { ids, kinds, profile, known: knownProfileIds(reg), by }), { by, action: 'profile-cleanup', note: profile || 'every profile' });
      // a fix the store's own guards turned down is not a fix: report what the record says now
      const after = new Map(r.store.builds.map((b) => [b.id, b]));
      const fixed = r.report.fixed.filter((f) => f.kind !== 'archived-complete' || after.get(f.id)?.status === f.to);
      const refused = r.report.fixed.filter((f) => !fixed.includes(f)).map((f) => ({ ...f, why: (r.refused ?? []).find((x) => x.id === f.id)?.why ?? 'the store kept its status' }));
      log.push(`cleanup: ${fixed.length} fixed${refused.length ? `, ${refused.length} refused (${refused.map((x) => `${x.id}: ${x.why}`).join('; ')})` : ''}, ${core.cleanupScan(r.store, { profile, known: knownProfileIds(reg) }).findings.length} left`);
      return { registry: reg, report: { fixed, refused }, log };
    }
    case 'merge-all': {
      // Brett, Nov 7 2026: every build profile merged into one. The registry drops the retired profiles and gains
      // `all` (readProfiles already folds them; this saves it), `all` becomes the active pick, and the builds store
      // moves their builds for good (builds-store.mjs mergeRetiredNow). Safe to run again: nothing left = no change.
      reg.active = resolveProfile(reg.active);
      const saved = saveRegistry(reg);
      seedProfile(MERGED_PROFILE, null);
      const r = mergeRetiredNow({ by: process.env.AXF_ACTOR || 'profiles-merge' });
      log.push(r.report ? `merged ${r.report.from.map((p) => `${p.id} (${p.builds})`).join(', ')} into ${MERGED_PROFILE}: ${r.report.moved} build(s), ${r.changed} record(s) written` : `nothing left to merge; ${MERGED_PROFILE} is ${saved.active === MERGED_PROFILE ? 'active' : 'not active'}`);
      const pruned = c.keepFolders === true ? [] : pruneRetiredFolders();
      log.push(pruned.length ? `old profile folders removed: ${pruned.length}` : 'no old profile folders left');
      return { registry: saved, report: r.report, pruned, log };
    }
    default: throw new Error(`unknown action ${c.action}`);
  }
}

/** What a build cost so far, per build id: the session meters on this host, else its shipped manifest. */
export function spendByBuild(store, { env = process.env } = {}) {
  const ids = new Set((store?.builds ?? []).map((b) => b.id));
  let byBuild = {};
  try { byBuild = spendOf(readMeters(env), { ids }).byBuild; } catch { /* no meters here */ }
  const dir = join(dirname(storeFile()), 'shipped');
  for (const b of store?.builds ?? []) {
    if (byBuild[b.id] || !b.shipped) continue;
    try { const usd = Number(JSON.parse(readFileSync(join(dir, `${b.id}.json`), 'utf8'))?.cost?.usd); if (usd > 0) byBuild[b.id] = usd; } catch { /* no manifest */ }
  }
  return { byBuild };
}

/** Everything profileStats needs besides the store, read once. */
function statsContext() {
  try {
    const store = loadStore();
    const spend = spendByBuild(store);
    let perBuildUsd = 0; try { perBuildUsd = readCaps().perBuildUsd; } catch { /* no settings here */ }
    return { store, spend, perBuildUsd, rate: core.spendRate(store, spend) };
  } catch { return null; }
}
const statsOf = (ctx, id) => (ctx ? core.profileStats(ctx.store, id, ctx) : null);

/** Cleanup scan (reads only): archived builds that are really finished, builds in a profile that no longer exists. */
export function cleanup({ profile = '' } = {}) {
  return core.cleanupScan(loadStore(), { profile: profile ? resolveProfile(profile) : '', known: knownProfileIds() });
}

/** One profile for its page: the registry entry, numbers, builds (in order, with progress and spend) and files. */
export function get(id) {
  const s = state();
  const listed = s.profiles.find((x) => x.id === resolveProfile(id));
  const p = listed ?? s.removed.find((x) => x.id === id);
  if (!p) throw new Error(`no build profile "${id}"`);
  const ctx = statsContext();
  const builds = ctx ? core.buildsOf(ctx.store, p.id).map((b) => {
    const pr = core.buildProgress(b);
    return { id: b.id, title: b.title, status: b.status, category: b.category, priority: b.priority ?? '', kind: b.kind, profiles: b.profiles, steps: pr.total, stepsDone: pr.done, pct: pr.pct, branch: b.branch, pr: b.pr, createdAt: b.createdAt, lastActivity: core.buildActivity(b), costUsd: ctx.spend.byBuild[b.id] ?? 0 };
  }) : [];
  return { profile: listed ?? { ...p, removed: true, stats: statsOf(ctx, p.id) }, active: s.active, effective: s.effective, builds, cleanup: cleanup({ profile: p.id }) };
}

/** Registry + counts per profile (what the console shows). */
export function state() {
  const reg = readProfiles();
  const ctx = statsContext();
  const rel = (f) => relative(REPO_ROOT, f).startsWith('..') ? f : relative(REPO_ROOT, f);
  const count = (f, pick) => { try { return pick(JSON.parse(readFileSync(f, 'utf8'))); } catch { return null; } };
  const effective = activeProfile().id;
  return {
    ...reg,
    effective, // differs from `active` only when AXF_BUILD_PROFILE is set for this process
    dataRoot: persistRoot() ?? 'repo',
    profiles: reg.profiles.map((p) => {
      const f = profileFiles(p.id);
      return {
        ...p,
        catalog: p.base ? p.catalog !== false : p.catalog === true,
        counts: {
          pending: count(f['framework/plan/pending.json'], (j) => (j.items ?? []).filter((i) => i.status !== 'complete').length),
          plan: count(f['framework/plan/plan.json'], (j) => (j.features ?? []).length),
          queue: count(f['framework/plan/build-queue.json'], (j) => (j.order ?? []).length),
          orchestrator: count(f.orchestrator, (j) => (j.builds ?? []).filter((b) => !['built', 'complete', 'archived'].includes(b.status)).length),
          tracked: count(f[TRACKER_REL], (j) => (j.items ?? []).length), // the one framework tracker
        },
        stats: statsOf(ctx, p.id), // from the builds store: builds by status, pending, queue, cost, last activity (null = the store can't be read here)
        files: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, rel(v)])),
      };
    }),
  };
}

const money = (v) => (v === null || v === undefined ? '?' : `$${Number(v).toFixed(2)}`);
/** A profile's numbers on one line (list, get). */
export const statsLine = (st) => `${st.builds} builds (${st.running} running, ${st.pending} pending, ${st.complete} complete, ${st.archived} archived${st.attention ? `, ${st.attention} need attention` : ''}) · ${st.pendingItems} pending items · ${st.queueSteps} queue steps · spent ${money(st.cost.spentUsd)}, left ${money(st.cost.leftUsd)}${st.lastActivity ? ` · last activity ${st.lastActivity.slice(0, 16).replace('T', ' ')}` : ''}`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--json', '--catalog', '--select', '--no-builds', '--keep', '--owner', '--fix'].includes(args[i - 1])));
  const out = (v) => console.log(json ? JSON.stringify({ ok: true, ...v }) : v.text ?? JSON.stringify(v, null, 2));
  try {
    const cmd = pos[0] ?? 'list';
    if (cmd === 'list' || cmd === 'state') {
      const s = state();
      out({ ...s, text: [...s.profiles.map((p) => `${p.id === s.effective ? '★' : ' '} ${p.id.padEnd(22)} ${p.name}${p.base ? ' (base)' : ''}${p.archived ? ' (archived)' : ''} · ${p.stats ? statsLine(p.stats) : `${p.counts.pending ?? 0} pending · ${p.counts.orchestrator ?? 0} orchestrator builds · ${p.counts.queue ?? 0} queue steps`} · ${p.counts.plan ?? 0} plan entries`), ...s.removed.map((p) => `  ${p.id.padEnd(22)} ${p.name} (removed ${str(p.removedAt, 10)}${p.mergedInto ? `, merged into ${p.mergedInto}` : ''}; restorable)`)].join('\n') });
    } else if (cmd === 'current') {
      const p = activeProfile(); out({ profile: p, text: `${p.name} (${p.id})` });
    } else if (cmd === 'get') {
      const g = get(pos[1] ?? activeProfile().id); const st = g.profile.stats;
      out({ ...g, text: [`${g.profile.name} (${g.profile.id})${g.profile.removed ? ' · removed' : ''}${g.profile.archived ? ' · archived' : ''}`, st ? statsLine(st) : 'the builds store can\'t be read here', ...g.builds.map((b) => `  ${b.status.padEnd(16)} ${String(b.stepsDone).padStart(2)}/${String(b.steps).padEnd(2)} ${b.id}`)].join('\n') });
    } else if (cmd === 'cleanup' && !args.includes('--fix')) {
      const r = cleanup({ profile: flag('--profile') ?? '' });
      out({ ...r, text: r.findings.length ? r.findings.map((f) => `${f.fixable ? 'fix ' : 'look'} ${f.kind.padEnd(18)} ${f.id}${f.to ? ` → ${f.to}` : ''}${f.why ? ` (${f.why})` : ''}`).join('\n') : 'nothing to clean up' });
    } else if (cmd === 'where') {
      const id = pos[1] ?? activeProfile().id; const f = profileFiles(id); out({ id, files: f, text: Object.entries(f).map(([k, v]) => `${k.padEnd(32)} ${v}`).join('\n') });
    } else {
      let change;
      if (cmd === 'act') change = JSON.parse(flag('--json') ?? pos[1] ?? '{}');
      else if (cmd === 'select') change = { action: 'select', id: pos[1] };
      else if (cmd === 'create') change = { action: 'create', name: pos[1], id: flag('--id'), description: flag('--description'), copyFrom: flag('--copy-from'), catalog: args.includes('--catalog'), select: args.includes('--select') };
      else if (cmd === 'update') change = { action: 'update', id: pos[1], name: flag('--name'), description: flag('--description'), catalog: flag('--catalog') === undefined ? undefined : flag('--catalog') === 'on', color: flag('--color'), icon: flag('--icon') };
      else if (cmd === 'duplicate') change = { action: 'duplicate', id: pos[1], name: pos[2], newId: flag('--id'), description: flag('--description'), builds: !args.includes('--no-builds'), select: args.includes('--select') };
      else if (cmd === 'merge') change = { action: 'merge', from: pos[1], into: pos[2], keep: args.includes('--keep') };
      else if (cmd === 'move-builds') change = { action: 'move-builds', to: pos[1], ids: pos.slice(2), from: flag('--from') };
      else if (cmd === 'archive' || cmd === 'unarchive' || cmd === 'restore') change = { action: cmd, id: pos[1] };
      else if (cmd === 'purge') change = { action: 'purge', id: pos[1], confirm: flag('--confirm'), owner: args.includes('--owner') };
      else if (cmd === 'cleanup') change = { action: 'cleanup-fix', ids: pos.slice(1), profile: flag('--profile') };
      else if (cmd === 'merge-all') change = { action: 'merge-all' };
      else if (cmd === 'remove') change = { action: 'remove', id: pos[1], confirm: flag('--confirm') };
      else throw new Error(`unknown command ${cmd}`);
      const r = act(change);
      out({ ...r, text: r.log.join('\n') });
    }
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exit(1);
  }
}

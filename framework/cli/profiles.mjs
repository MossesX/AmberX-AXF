#!/usr/bin/env node
/**
 * profiles — build profiles (build-profiles@1).
 *
 * A build profile is one complete set of work data: the pending build list, the plan (+ media), the build queue,
 * catalog status, tracker.json and the Build orchestrator's tracker. One profile is active; every CLI, the console
 * server and its plugins read and write the active profile's copy (resolution lives in persist.mjs → dataPath()).
 * "main-framework" is the base profile and keeps the original paths; every other profile lives under
 * framework/plan/profiles/<id>/ (hub shared data) and _claude/builds/profiles/<id>/orchestrator.json (repo).
 *
 *   node framework/cli/profiles.mjs                         list (★ = active)
 *   node framework/cli/profiles.mjs current                 the active profile
 *   node framework/cli/profiles.mjs select <id>             make <id> the active profile (saved for everyone)
 *   node framework/cli/profiles.mjs create "<name>" [--id x] [--description "…"] [--copy-from <id>] [--catalog] [--select]
 *                                                           new profile; empty unless --copy-from; --catalog lets plan
 *                                                           rebuilds import seed.json + the feature catalog
 *   node framework/cli/profiles.mjs update <id> [--name "…"] [--description "…"] [--catalog on|off]
 *   node framework/cli/profiles.mjs remove <id> --confirm <id>   off the list; its data stays (create it again to
 *                                                           get it back). The base and the active profile can't go.
 *   node framework/cli/profiles.mjs where [<id>]            the files of a profile
 *   node framework/cli/profiles.mjs act --json '{"action":"select","id":"refactor"}'   any change (console server)
 *   --json on any command prints JSON.
 *
 * AXF_BUILD_PROFILE=<id> makes one process (a session, a CI job) use another profile without changing the saved pick.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_PROFILE, PROFILED, PROFILES_REL, PROFILE_ID, REPO_ROOT, activeProfile, baseDataPath, emptyProfileFile,
  orchestratorPath, persistRoot, profileRel, readProfiles,
} from './persist.mjs';

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
  const out = { $axf: SCHEMA, updatedAt: now(), active: reg.active, profiles: reg.profiles.map(({ base, ...p }) => p) };
  writeJson(baseDataPath(PROFILES_REL), out);
  return readProfiles();
}

/** Where profile `id`'s data lives (absolute paths). */
export function profileFiles(id) {
  const root = persistRoot() ?? REPO_ROOT;
  const files = Object.fromEntries(PROFILED.map((rel) => [rel, id === BASE_PROFILE ? baseDataPath(rel) : join(root, profileRel(id, rel))]));
  return { ...files, orchestrator: orchestratorPath(id) };
}

/** Start a profile's files: copies of `from`, or empty ones. Never overwrites a file that is already there. */
function seedProfile(id, from) {
  const src = from ? profileFiles(from) : null;
  const dst = profileFiles(id);
  for (const rel of PROFILED) {
    const to = dst[rel];
    if (existsSync(to)) continue;
    mkdirSync(rel.endsWith('/') ? to : dirname(to), { recursive: true });
    if (src && existsSync(src[rel])) { cpSync(src[rel], to, { recursive: true }); continue; }
    const empty = emptyProfileFile(rel);
    if (empty) writeJson(to, empty);
  }
  if (!existsSync(dst.orchestrator)) {
    let rules = null;
    try { rules = JSON.parse(readFileSync(profileFiles(from ?? BASE_PROFILE).orchestrator, 'utf8')).rules; } catch { /* defaults */ }
    let builds = [];
    if (src) { try { builds = JSON.parse(readFileSync(src.orchestrator, 'utf8')).builds ?? []; } catch { /* none */ } }
    writeJson(dst.orchestrator, { $axf: 'orchestrator@1', updatedAt: now(), ...(rules ? { rules } : {}), builds });
  }
}

/** One change to the registry. Returns { registry, profile?, log }. */
export function act(change) {
  const c = change && typeof change === 'object' ? change : {};
  const reg = readProfiles();
  const find = (id) => { const p = reg.profiles.find((x) => x.id === id); if (!p) throw new Error(`no build profile "${id}"`); return p; };
  const log = [];
  switch (c.action) {
    case 'select': {
      const p = find(str(c.id, 40));
      reg.active = p.id;
      seedProfile(p.id, null); // a profile chosen for the first time on this machine gets its files
      log.push(`active build profile → ${p.name} (${p.id})`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'create': {
      const name = str(c.name, 80);
      if (!name) throw new Error('a profile needs a name');
      const id = c.id ? str(c.id, 40) : slugId(name);
      if (!PROFILE_ID.test(id)) throw new Error('id: lowercase letters, digits and dashes, up to 40');
      if (reg.profiles.some((p) => p.id === id)) throw new Error(`"${id}" already exists`);
      const from = c.copyFrom ? find(str(c.copyFrom, 40)).id : null;
      const p = { id, name, description: str(c.description, 600), createdAt: now(), updatedAt: now(), catalog: c.catalog === true, ...(from ? { copiedFrom: from } : {}) };
      seedProfile(id, from);
      reg.profiles.push(p);
      if (c.select === true) reg.active = id;
      log.push(`build profile "${name}" (${id}) created${from ? ` from ${from}` : ' empty'}${c.select === true ? ' and selected' : ''}`);
      return { registry: saveRegistry(reg), profile: p, log };
    }
    case 'update': {
      const p = find(str(c.id, 40));
      if (typeof c.name === 'string') { if (!str(c.name, 80)) throw new Error('a profile needs a name'); p.name = str(c.name, 80); }
      if (typeof c.description === 'string') p.description = str(c.description, 600);
      if (typeof c.catalog === 'boolean') p.catalog = c.catalog;
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
      log.push(`build profile ${p.id} taken off the list (its data stays; create "${p.id}" again to get it back)`);
      return { registry: saveRegistry(reg), log };
    }
    default: throw new Error(`unknown action ${c.action}`);
  }
}

/** Registry + counts per profile (what the console shows). */
export function state() {
  const reg = readProfiles();
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
          orchestrator: count(f.orchestrator, (j) => (j.builds ?? []).filter((b) => b.status !== 'complete' && b.status !== 'archived').length),
          tracked: count(f['tracker.json'], (j) => (j.items ?? []).length),
        },
        files: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, rel(v)])),
      };
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--json', '--catalog', '--select'].includes(args[i - 1])));
  const out = (v) => console.log(json ? JSON.stringify({ ok: true, ...v }) : v.text ?? JSON.stringify(v, null, 2));
  try {
    const cmd = pos[0] ?? 'list';
    if (cmd === 'list' || cmd === 'state') {
      const s = state();
      out({ ...s, text: s.profiles.map((p) => `${p.id === s.effective ? '★' : ' '} ${p.id.padEnd(22)} ${p.name}${p.base ? ' (base)' : ''} · ${p.counts.pending ?? 0} pending · ${p.counts.orchestrator ?? 0} orchestrator builds · ${p.counts.queue ?? 0} queue steps · ${p.counts.plan ?? 0} plan entries`).join('\n') });
    } else if (cmd === 'current') {
      const p = activeProfile(); out({ profile: p, text: `${p.name} (${p.id})` });
    } else if (cmd === 'where') {
      const id = pos[1] ?? activeProfile().id; const f = profileFiles(id); out({ id, files: f, text: Object.entries(f).map(([k, v]) => `${k.padEnd(32)} ${v}`).join('\n') });
    } else {
      let change;
      if (cmd === 'act') change = JSON.parse(flag('--json') ?? pos[1] ?? '{}');
      else if (cmd === 'select') change = { action: 'select', id: pos[1] };
      else if (cmd === 'create') change = { action: 'create', name: pos[1], id: flag('--id'), description: flag('--description'), copyFrom: flag('--copy-from'), catalog: args.includes('--catalog'), select: args.includes('--select') };
      else if (cmd === 'update') change = { action: 'update', id: pos[1], name: flag('--name'), description: flag('--description'), catalog: flag('--catalog') === undefined ? undefined : flag('--catalog') === 'on' };
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

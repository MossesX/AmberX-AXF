#!/usr/bin/env node
/**
 * step-groups.mjs — the IO side of step-groups@1 (one long build over several slots; engine framework/core/build-groups.mjs,
 * spec framework/spec/BUILD-GROUPS.md). Not to be confused with groups.mjs, the custom groups on the builds board
 * (build-groups@1).
 *
 * Each group of a split build runs on its own sub-branch `<build branch>--<group id>` (claude/<id>--g2) in its own
 * worktree `<worktrees>/<build id>--<group id>`, made off the build branch's head when the group starts, with
 * node_modules linked from the main checkout like every build worktree. The sub-branch and worktree are recorded on the
 * group (branch, worktree) and removed once the group is merged back onto the build branch.
 *
 * Every write goes through the builds store under its lock (withStore, journalled), so sessions of several groups ticking
 * steps on the one build record never lose each other's writes.
 *
 * Environment: AXF_PIPELINE_WORKTREES (root of build worktrees, default /root/axf-builds), AXF_PIPELINE_WORKTREE_MODE=mkdir
 * (tests: folders, no git).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
const nowIso = () => new Date().toISOString();
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const err = (m, code = 2) => Object.assign(new Error(m), { code });
function git(cwd, ...a) { return spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 180e3 }); }

/** Installed packages every worktree links from the main checkout (no install per build or group). */
export const NODE_MODULES_LINKS = ['node_modules', 'apps/console-web/node_modules', 'apps/demo/node_modules', 'apps/expenses/node_modules', 'apps/axhub-web/node_modules', 'apps/molly/node_modules'];
/** Link node_modules into a fresh worktree from `from` (the main checkout by default); missing ones are skipped. */
export function linkModules(dir, from = REPO_ROOT) {
  for (const rel of NODE_MODULES_LINKS) {
    const src = join(from, rel); const dst = join(dir, rel);
    if (existsSync(src) && !existsSync(dst)) { try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst); } catch { /* optional */ } }
  }
}

export const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
export const buildBranchOf = (b) => str(b?.branch, 200) || `claude/${b.id}`;
/** A group's sub-branch: `<build branch>--<group id>` (a ref beside the build branch; `<branch>/<gid>` would clash with it). */
export const groupBranch = (buildBranch, gid) => `${buildBranch}--${gid}`;
/** Is this a group sub-branch (no PR, no auto-PR, never landed by itself)? */
/** Is this a group sub-branch (`…--g<n>`: no PR, no auto-PR, never landed by itself)? */
export const GROUP_BRANCH_RE = /^.+--g\d+$/;
export const isGroupBranch = (branch) => GROUP_BRANCH_RE.test(str(branch, 200).replace(/^refs\/heads\//, ''));
export const groupWorktree = (buildId, gid, env = process.env) => join(worktreesRoot(env), `${buildId}--${gid}`);

/** One build and one of its groups (groupsOf: the implicit group when the build has none); throws code 2. */
export function findGroup(id, gid, store = loadStore()) {
  const b = storeCore.findBuild(store, id); if (!b) throw err(`no build "${id}"`);
  const groups = BP.groupsOf(b); const g = groups.find((x) => x.id === gid);
  if (!g) throw err(`${b.id} has no group "${gid}" (it has ${groups.map((x) => x.id).join(', ')})`);
  return { b, g, groups };
}

/**
 * Change one group on the build record, under the store lock (journalled). `patch` is merged and normalised
 * (normGroups); `fn(group, build)` may change it in place instead. Only a split build (groups[] set) is written.
 */
export function updateGroup(id, gid, patch = {}, { by = process.env.AXF_ACTOR || 'orchestrator', action = 'pipeline:group', note = '', fn = null } = {}) {
  let out = null;
  withStore((s) => {
    const rec = storeCore.findBuild(s, id); if (!rec) throw err(`no build "${id}"`);
    if (!(rec.groups ?? []).length) throw err(`${rec.id} is not split into groups`);
    const g = rec.groups.find((x) => x.id === gid); if (!g) throw err(`${rec.id} has no group "${gid}"`);
    Object.assign(g, patch); if (fn) fn(g, rec);
    rec.groups = BP.normGroups(rec.groups); rec.updatedAt = nowIso();
    out = { build: rec, group: rec.groups.find((x) => x.id === gid) };
    return s;
  }, { by, action, note: note || `${id}/${gid}` });
  return out;
}

/**
 * The group's worktree on its sub-branch, made when missing: the sub-branch starts at the build branch's head (a
 * re-run of a group keeps the sub-branch it had, so its finished steps stay). Records branch and worktree on the
 * group. Returns { dir, branch, made }.
 */
export function ensureGroupWorktree(id, gid, { env = process.env, by = 'dispatcher' } = {}) {
  const { b } = findGroup(id, gid);
  const base = buildBranchOf(b); const branch = groupBranch(base, gid); const dir = groupWorktree(b.id, gid, env);
  let made = false;
  if (!existsSync(dir)) {
    if ((env.AXF_PIPELINE_WORKTREE_MODE || 'git') === 'mkdir') mkdirSync(dir, { recursive: true });
    else {
      mkdirSync(worktreesRoot(env), { recursive: true });
      const has = (ref) => git(REPO_ROOT, 'rev-parse', '--verify', '-q', ref).status === 0;
      if (!has(base)) git(REPO_ROOT, 'fetch', '-q', 'origin', `${base}:${base}`);
      if (!has(base)) throw err(`${b.id}/${gid}: the build branch ${base} does not exist yet`, 1);
      const r = has(branch) ? git(REPO_ROOT, 'worktree', 'add', dir, branch) : git(REPO_ROOT, 'worktree', 'add', '-b', branch, dir, base);
      if (r.status !== 0) throw err(`worktree for ${b.id}/${gid}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, 1);
      linkModules(dir);
    }
    made = true;
  }
  if ((b.groups ?? []).length) updateGroup(b.id, gid, { branch, worktree: dir }, { by, action: 'pipeline:group-worktree', note: `${b.id}/${gid} on ${branch}` });
  return { dir, branch, made };
}

/** Remove a merged group's worktree and sub-branch (local and on origin when pushed). Safe to call twice. */
export function removeGroupWorktree(id, gid, { env = process.env, by = 'dispatcher', keepBranch = false } = {}) {
  const { b, g } = findGroup(id, gid);
  const branch = g.branch || groupBranch(buildBranchOf(b), gid); const dir = g.worktree || groupWorktree(b.id, gid, env);
  const done = { dir: false, branch: false, remote: false };
  if ((env.AXF_PIPELINE_WORKTREE_MODE || 'git') === 'mkdir') { if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); done.dir = true; } }
  else {
    if (existsSync(dir)) { const r = git(REPO_ROOT, 'worktree', 'remove', '--force', dir); done.dir = r.status === 0; if (!done.dir) rmSync(dir, { recursive: true, force: true }); git(REPO_ROOT, 'worktree', 'prune'); }
    if (!keepBranch) {
      done.branch = git(REPO_ROOT, 'branch', '-D', branch).status === 0;
      if (git(REPO_ROOT, 'ls-remote', '--exit-code', '--heads', 'origin', branch).status === 0) done.remote = git(REPO_ROOT, 'push', '-q', 'origin', '--delete', branch).status === 0;
    }
  }
  if ((b.groups ?? []).length) updateGroup(b.id, gid, { worktree: '' }, { by, action: 'pipeline:group-cleanup', note: `${b.id}/${gid} worktree removed` });
  return { dir, branch, ...done };
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json');
  const [cmd = 'help', id, gid] = argv.filter((a) => !a.startsWith('--'));
  const out = (o, text) => console.log(json ? JSON.stringify({ ok: true, ...o }) : text);
  if (cmd === 'worktree') { const r = ensureGroupWorktree(id, gid); return out(r, `${id}/${gid}: ${r.dir} on ${r.branch}${r.made ? ' (made)' : ''}`); }
  if (cmd === 'cleanup') { const r = removeGroupWorktree(id, gid); return out(r, `${id}/${gid}: worktree ${r.dir} ${r.dir ? 'removed' : 'gone'}, branch ${r.branch}`); }
  throw err('usage: step-groups.mjs worktree|cleanup <build> <group> [--json]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`step-groups: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  });
}

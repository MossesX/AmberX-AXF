/**
 * Fixer `shipped-features` (build rule `shipped-features`): every landed build has its shipped-manifest@1
 * (_claude/builds/shipped/<build>.json), which puts the build on the Shipped features ledger through build-hook@1.
 * The fixer runs `framework/cli/shipped.mjs ship <build> --source orchestrator --by gate` when the manifest is missing;
 * an existing manifest is left alone (idempotent). Dry run = `shipped.mjs gather` (nothing written).
 *
 * CLI: node apps/console-web/plugins/gate/fixers/shipped-features.mjs [check|fix] --build <id> [--dry-run] [--json]
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, result, rootOf } from './lib.mjs';

export const id = 'shipped-features'; // the fixer id of build rule shipped-features (axf-not-plugin:shipped-features)
const buildOf = (ctx) => String(ctx?.build?.id || '').trim();
/** Only a landed build is shipped (ctx.build.landed, or a merged status / mergedAt on the record). */
export const landed = (b = {}) => Boolean(b.landed || b.mergedAt || ['merged', 'live', 'done', 'landed'].includes(String(b.status || '').toLowerCase()));
const run = (ctx, args) => spawnSync(process.execPath, [join(rootOf(ctx), 'framework/cli/shipped.mjs'), ...args], { cwd: rootOf(ctx), encoding: 'utf8', env: { ...process.env, ...(ctx.env || {}) }, timeout: 120000 });

async function hasManifest(ctx, build) {
  const { readManifest } = await import(pathToFileURL(join(rootOf(ctx), 'framework/cli/shipped-files.mjs')).href);
  return Boolean(readManifest(build, { ...process.env, ...(ctx.env || {}) }));
}

export async function check(ctx = {}) {
  const build = buildOf(ctx);
  if (!build) return result(id, { ok: true, detail: 'no build named: nothing to check' });
  if (!landed(ctx.build)) return result(id, { ok: true, detail: `${build} has not landed yet: shipped when it lands` });
  const ok = await hasManifest(ctx, build);
  return result(id, { ok, missing: ok ? [] : [`${build}: no shipped manifest`], detail: ok ? `${build} is on the Shipped features ledger` : `${build} has no shipped manifest` });
}

export async function fix(ctx = {}, { dryRun = false } = {}) {
  const build = buildOf(ctx);
  if (!build) return result(id, { ok: true, detail: 'no build named: nothing to fix' });
  if (!landed(ctx.build)) return result(id, { ok: true, dryRun, detail: `${build} has not landed yet` });
  if (await hasManifest(ctx, build)) return result(id, { ok: true, dryRun, detail: `${build} already shipped` });
  const r = run(ctx, dryRun ? ['gather', build, '--json'] : ['ship', build, '--source', 'orchestrator', '--by', 'gate', '--json']);
  if (r.status !== 0) return result(id, { ok: false, dryRun, unfixable: `shipped.mjs ${dryRun ? 'gather' : 'ship'} ${build} failed: ${(r.stderr || r.stdout || '').trim().slice(-400)}` });
  const rel = `_claude/builds/shipped/${build}.json`;
  return result(id, { ok: true, dryRun, ...(dryRun ? { planned: [rel] } : { changed: [rel] }), detail: dryRun ? `would ship ${build}` : `shipped ${build}` });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await cli({ check, fix });

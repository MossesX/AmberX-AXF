/**
 * Fixer `parallel-groups` (build rule `parallel-groups`, phase gate): a build split into step groups (step-groups@1,
 * framework/spec/BUILD-GROUPS.md) lands only after every group is merged back onto its build branch, in merge order, by
 * the orchestrator. `check` fails while any group of the PR's build is not merged, so the gate holds the PR; it passes
 * for every build that is not split (one implicit group). `fix` changes nothing: the orchestrator's dispatcher merges
 * the groups (pipeline.mjs groups merge), never a session and never this fixer.
 *
 * ctx.build = { id, branch?, pr? }. CLI: node apps/console-web/plugins/gate/fixers/parallel-groups.mjs check --build <id> [--json]
 */
import { pathToFileURL } from 'node:url';
import { result } from './lib.mjs';
import { GROUP_STATE_LABEL, groupsOf, isSplit } from '../../../../../framework/core/build-pipeline.mjs';
import { findBuild } from '../../../../../framework/plan/builds-store-core.mjs';
import { loadStore } from '../../../../../framework/cli/builds-store.mjs';

export const id = 'parallel-groups';

/** Pure: the verdict for one build record (null = not an orchestrator build). */
export function verdict(b) {
  if (!b) return { ok: true, detail: 'not an orchestrator build: nothing to hold' };
  if (!isSplit(b)) return { ok: true, detail: `${b.id} is not split into step groups` };
  const open = groupsOf(b).filter((g) => g.state !== 'merged');
  if (!open.length) return { ok: true, detail: `every step group of ${b.id} is merged onto its build branch` };
  return { ok: false, missing: open.map((g) => `${b.id}/${g.id}: ${GROUP_STATE_LABEL[g.state] ?? g.state}`),
    detail: `held: ${open.length} step group${open.length === 1 ? '' : 's'} of ${b.id} not merged yet (${open.map((g) => g.id).join(', ')}); the orchestrator merges them in order before the PR lands` };
}

function buildOf(ctx) {
  if (ctx.record) return ctx.record;
  const ref = ctx.build?.id; if (!ref) return null;
  try { return findBuild(ctx.store ?? loadStore(), ref); } catch { return null; }
}

export async function check(ctx = {}) { return result(id, verdict(buildOf(ctx))); }

export async function fix(ctx = {}) {
  const v = verdict(buildOf(ctx));
  return v.ok ? result(id, v) : result(id, { ...v, unfixable: 'the orchestrator merges step groups itself (pipeline.mjs groups merge <build>): nothing for a fixer to do' });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = process.argv.slice(2); const i = a.indexOf('--build');
  const r = await check({ build: { id: i >= 0 ? a[i + 1] : '' } });
  console.log(a.includes('--json') ? JSON.stringify(r) : `${r.ok ? 'ok' : 'held'}: ${r.detail}`);
  if (!r.ok) process.exitCode = 3;
}

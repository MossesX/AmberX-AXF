/**
 * Lifecycle hooks (plugin-lifecycle@1). Plans live in the plan store (plans.mjs storeDir: the hub's shared data where
 * /projects is mounted, else this plugin's data folder). Install copies the seed plans in (never over a plan that
 * exists); uninstall removes the data folder only — plans on the hub are shared data and stay.
 *
 * Project data (project-template@1): a copy of a project carries the plan store's structure (categories, user
 * templates, saved views); with carry.items "all" every plan too (not their version history), with "none" nothing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FOLDER = 'plan-studio';
const STRUCTURE = ['categories.json', 'templates.json', 'views.json'];
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_PLANS = 500;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }
/** The project's plan store (as plans.mjs storeDir, for a given project). */
const storeOf = (ctx) => ctx.projectDir(process.env.AXF_PLANS_DIR || (ctx.persistRoot ? join(ctx.persistRoot, FOLDER) : join(ctx.root, '.axf-console/plugins', FOLDER)));

export const projectDataLabel = 'Plans';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { seed, storeDir } = await import('./plans.mjs');
  const added = seed();
  ctx.log(added.length ? `seed plans copied to ${storeDir()}: ${added.join(', ')}` : `plans: ${storeDir()}`);
}
export async function onUninstall(ctx) { ctx.log('removing the Plan Studio data folder (plans in the hub shared data stay: other sessions use them)'); }
export async function checks(ctx) {
  const { loadPlans, storeDir, onHub } = await import('./plans.mjs');
  const { validate } = await import('./web/plan-core.mjs');
  const plans = loadPlans();
  const bad = plans.filter((p) => validate(p).length);
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: existsSync(storeDir()), detail: `${storeDir()}${onHub() ? ' (hub shared data)' : ''}` },
    { id: 'plans', ok: plans.length > 0 && !bad.length, detail: `${plans.length} plans${bad.length ? `, ${bad.length} invalid: ${bad.map((p) => p.id).join(', ')}` : ''}` },
  ];
}

export async function exportProjectData(ctx) {
  const items = ctx.carry?.items ?? 'structure';
  if (items === 'none') return null;
  const dir = storeOf(ctx);
  if (!existsSync(dir)) return null;
  const files = {};
  for (const f of STRUCTURE) { const v = readJson(join(dir, f)); if (v !== null) files[f] = v; }
  const plans = {};
  if (items === 'all' && existsSync(join(dir, 'plans'))) {
    for (const n of readdirSync(join(dir, 'plans')).filter((x) => x.endsWith('.json')).sort().slice(0, MAX_PLANS)) {
      const id = n.slice(0, -5);
      const v = readJson(join(dir, 'plans', n));
      if (ID_RE.test(id) && v) plans[id] = v;
    }
  }
  return Object.keys(files).length || Object.keys(plans).length ? { files, plans } : null;
}

export async function importProjectData(ctx, data) {
  const dir = storeOf(ctx);
  let files = 0;
  let plans = 0;
  for (const [f, v] of Object.entries(data?.files ?? {})) {
    if (!STRUCTURE.includes(f) || existsSync(join(dir, f))) continue;
    writeJson(join(dir, f), v); files++;
  }
  for (const [id, v] of Object.entries(data?.plans ?? {})) {
    if (!ID_RE.test(id) || existsSync(join(dir, 'plans', `${id}.json`))) continue;
    writeJson(join(dir, 'plans', `${id}.json`), v); plans++;
  }
  return { note: `${files ? 'categories, templates and views' : 'no structure'}${plans ? `, ${plans} plan(s)` : ', no plans'}` };
}

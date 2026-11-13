/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays inside ctx.dataDir. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`prompt engine data: ${ctx.dataDir} (rules.json, macros.json, pipelines.json, instances.json, state.json, audit.jsonl)`); }
export async function onUninstall(ctx) { ctx.log('removing the prompt engine rules, macros, pipelines, waiting prompts and history'); }
export async function checks(ctx) {
  const out = [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }];
  const f = join(ctx.dataDir, 'rules.json');
  let rules = [];
  try { rules = JSON.parse(readFileSync(f, 'utf8')); } catch { /* none yet */ }
  out.push({ id: 'rules', ok: Array.isArray(rules), detail: `${Array.isArray(rules) ? rules.length : 0} rule(s)` });
  return out;
}

/**
 * Fixer `ui-review-posted` (build rule `ui-review-posted`, Nov 18 2026, build auto-lander-never-wait-missing-ui-review).
 * Brett: "If it recorded the test of the pipeline and didn't merge it on its own, then the test failed."
 *
 * A build that records UI Review items (its worktree's ui-review items.json names the build or its branch) must have
 * each of them in the LIVE console: an item only the worktree knows is never seen, never approved, and the lander lands
 * the PR with the review flagged (gate-rules@1 ui-review-missing). The check reads the worktree's items and asks the
 * console (GET /api/plugins/ui-review/items): every local item must be there (by id, else by build + name). The fix
 * posts the missing ones (POST /api/plugins/ui-review/submit) with their pictures from the worktree, then the check
 * passes. A console that does not answer is a failed check (nothing can be confirmed), never a pass.
 *
 * ctx.build = { id, branch, pr? }; ctx.root = the build's worktree; ctx.console = an injected (method, path, body) →
 * answer (tests); else AXF_CONSOLE_URL + AXF_TOKEN; else docker exec into the console container (AXF_LAND_CONSOLE,
 * default axf-console), as the lander does from the VPS host.
 * CLI: node apps/console-web/plugins/gate/fixers/ui-review-posted.mjs [check|fix] --build <id> [--branch b] [--root <worktree>] [--dry-run] [--json]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, rootOf } from './lib.mjs';

export const id = 'ui-review-posted';
export const DEFAULT_DATA_DIR = 'apps/console-web/.axf-console/plugins/ui-review';

/** The worktree's ui-review data folder (the plugin's lifecycle.dataDir), found by capability, never by a hard-coded path alone. */
export function uiReviewDir(ctx = {}) {
  const root = rootOf(ctx);
  const plugins = join(root, 'apps/console-web/plugins');
  let rel = '';
  try {
    for (const d of (existsSync(plugins) ? readdirSync(plugins) : [])) {
      const m = readJson(join(plugins, d, 'plugin.json'));
      if (m && Array.isArray(m.provides) && m.provides.includes('service:ui-review@1') && m.lifecycle?.dataDir) { rel = m.lifecycle.dataDir; break; }
    }
  } catch { /* fall back below */ }
  return join(root, rel || DEFAULT_DATA_DIR);
}

/** The items the worktree recorded for the build (by id, else branch): stored ui-review-item@1 records, never pack: or landed ones. */
export function localItems(ctx = {}) {
  const dir = uiReviewDir(ctx);
  const doc = readJson(join(dir, 'items.json'));
  const b = ctx.build || {};
  const items = (doc && Array.isArray(doc.items) ? doc.items : []).filter((it) => it && !String(it.id).startsWith('pack:') && !it.landed && ((b.id && it.build === b.id) || (b.branch && it.branch === b.branch)));
  const groups = doc && Array.isArray(doc.groups) ? doc.groups : [];
  return { dir, items, groups };
}

/** Which local items the console has: by id, else by build + name → { ok, total, posted, missing: [{ id, name }] }. */
export function postedState(local, consoleItems) {
  const list = Array.isArray(consoleItems) ? consoleItems : [];
  const ids = new Set(list.map((it) => String(it?.id)));
  const key = (it) => `${it?.build || ''}\u0000${it?.name || it?.title || ''}`;
  const byName = new Set(list.map(key));
  const missing = local.filter((it) => !ids.has(String(it.id)) && !byName.has(key(it))).map((it) => ({ id: it.id, name: it.name || it.title || '' }));
  return { ok: missing.length === 0, total: local.length, posted: local.filter((it) => !missing.some((m) => m.id === it.id)).map((it) => it.id), missing };
}

/** The console: injected, by URL + token, or through the console container (the VPS host has no token). */
export function consoleClient(ctx = {}, env = process.env) {
  if (typeof ctx.console === 'function') return ctx.console;
  const url = env.AXF_CONSOLE_URL, tok = env.AXF_TOKEN;
  if (url && tok) {
    return async (method, path, body) => {
      try {
        const r = await fetch(`${url.replace(/\/$/, '')}${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
        return r.ok ? await r.json().catch(() => ({})) : null;
      } catch { return null; }
    };
  }
  const container = env.AXF_LAND_CONSOLE || 'axf-console';
  if (container === 'off') return null;
  return async (method, path, body) => {
    const cmd = `curl -s -m 30 -X ${method} -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" ${body ? '--data-binary @-' : ''} "http://127.0.0.1:7090${path}"`;
    const r = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', cmd], { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', timeout: 60000, maxBuffer: 64 << 20 });
    if (r.status !== 0) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  };
}

const say = (st, build) => (st.ok
  ? `${st.total} UI Review item(s) ${build} recorded are in the console (${st.posted.join(', ')})`
  : `${st.missing.length} of ${st.total} UI Review item(s) ${build} recorded were never posted to the console: ${st.missing.map((m) => `${m.id} (${m.name})`).join(', ')}. The step that submitted them should have failed (review.mjs submit --console confirms the item since Nov 18 2026); the lander lands the PR with the review flagged.`);

export async function check(ctx = {}) {
  const b = ctx.build || {};
  const loc = localItems(ctx);
  if (!loc.items.length) return { ok: true, detail: `no UI Review items recorded in the worktree for ${b.id || b.branch || 'this build'}: nothing to post` };
  const call = consoleClient(ctx);
  const r = call ? await call('GET', '/api/plugins/ui-review/items') : null;
  if (!r || !Array.isArray(r.items)) return { ok: false, unreachable: true, missing: loc.items.map((it) => it.id), detail: `${loc.items.length} UI Review item(s) recorded for ${b.id || b.branch} but the console did not answer: they cannot be confirmed as posted (${call ? 'no answer from GET /api/plugins/ui-review/items' : 'no way to reach the console: set AXF_CONSOLE_URL + AXF_TOKEN or AXF_LAND_CONSOLE'})` };
  const st = postedState(loc.items, r.items);
  return { ok: st.ok, detail: say(st, b.id || b.branch), missing: st.missing.map((m) => m.id), ...(st.ok ? {} : { fixable: true }) };
}

/** The pictures of a stored item in the worktree (shots/<id>/<file>). */
export function picturesOf(dir, it) {
  const files = [...(Array.isArray(it.shots) ? it.shots : []), ...(Array.isArray(it.files?.after) ? it.files.after : []), ...(Array.isArray(it.files?.before) ? it.files.before : [])];
  const out = [];
  for (const f of files) {
    const name = basename(String(f?.src || f?.name || ''));
    const p = join(dir, 'shots', String(it.id), name);
    if (name && existsSync(p)) out.push({ name, device: f?.device || '', data: readFileSync(p).toString('base64') });
  }
  return out;
}

/** Post every missing item to the console with its pictures; a second run finds them posted and changes nothing. */
export async function fix(ctx = {}, { dryRun = false } = {}) {
  const b = ctx.build || {};
  const loc = localItems(ctx);
  const call = consoleClient(ctx);
  if (!loc.items.length) return { ok: true, detail: 'nothing recorded: nothing to post', changed: [], planned: [] };
  if (!call) return { ok: false, unfixable: 'no way to reach the console (AXF_CONSOLE_URL + AXF_TOKEN, or the console container)', changed: [], planned: [] };
  const have = await call('GET', '/api/plugins/ui-review/items');
  if (!have || !Array.isArray(have.items)) return { ok: false, unfixable: 'the console did not answer GET /api/plugins/ui-review/items', changed: [], planned: [] };
  const st = postedState(loc.items, have.items);
  if (st.ok) return { ok: true, detail: 'every item is already in the console', changed: [], planned: [] };
  const todo = loc.items.filter((it) => st.missing.some((m) => m.id === it.id));
  if (dryRun) return { ok: true, detail: `would post ${todo.length} item(s): ${todo.map((it) => it.id).join(', ')}`, changed: [], planned: todo.map((it) => it.id) };
  const changed = []; const failed = [];
  for (const it of todo) {
    const group = loc.groups.find((g) => g.id === it.group || g.id === it.group?.id)?.name || it.group?.name || `${b.id || it.build || 'build'} - posted by the VPS`;
    const body = {
      kind: it.section || it.kind || 'other', title: it.name || it.title || it.id, app: it.app || '', screen: it.screen || '', build: it.build || b.id || '', step: it.step || undefined, branch: it.branch || b.branch || '', pr: it.pr || b.pr || null,
      notes: `${it.notes || ''}\nPosted by the VPS (build rule ui-review-posted): the build recorded this item in its worktree (${it.id}) but never posted it.`.trim(),
      source: 'headless', submittedBy: { type: 'build', id: it.branch || b.branch || b.id || '' }, group,
      files: picturesOf(loc.dir, it),
    };
    const r = await call('POST', '/api/plugins/ui-review/submit', body);
    if (r && r.item?.id) changed.push(`${it.id} → ${r.item.id}`); else failed.push(`${it.id}: ${r?.detail || 'the console refused or did not answer'}`);
  }
  if (failed.length) return { ok: false, unfixable: `could not post ${failed.length} item(s): ${failed.join('; ')}`, changed, planned: [] };
  return { ok: true, detail: `posted ${changed.length} item(s) to the console: ${changed.join(', ')}`, changed, planned: [] };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : ''; };
  const ctx = { build: { id: opt('build'), branch: opt('branch') }, ...(opt('root') ? { root: opt('root') } : {}) };
  const r = await (a[0] === 'fix' ? fix(ctx, { dryRun: a.includes('--dry-run') }) : check(ctx));
  process.stdout.write(a.includes('--json') ? `${JSON.stringify(r)}\n` : `${r.ok ? 'ok' : 'FAIL'}: ${r.detail || r.unfixable}\n`);
  process.exitCode = r.ok ? 0 : 1;
}

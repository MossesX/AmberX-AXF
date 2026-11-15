/**
 * Fixer `help-stub` (build rule help coverage): every plugin ships help.json (help@1) with at least its screen entry
 * `view:<folder>`, written from plugin.json's name and description. Existing entries are never changed; a missing
 * help.json is made from the template and a help.json without the screen entry gets that one entry added. Idempotent.
 * The text is a stub (`draft: true`) so `help-coverage.mjs` still lists it for a person to word properly.
 *
 * CLI: node apps/console-web/plugins/gate/fixers/help-stub.mjs [check|fix] [--dry-run] [--plugin a,b] [--json]
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, jsonText, plugin, pluginFolders, readJson, result, writeIfChanged } from './lib.mjs';

export const id = 'help-stub';

/** First sentence of the description, at most 300 characters. */
export const firstSentence = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); const m = t.match(/^.{20,300}?[.!?](\s|$)/); return (m ? m[0] : t.slice(0, 300)).trim(); };

/** The screen entry a plugin's help needs. */
export const screenEntry = (folder, m) => ({ target: `view:${folder}`, title: String(m.name || folder).slice(0, 80), text: firstSentence(m.description) || `The ${m.name || folder} plugin's page.`, kind: 'screen', draft: true });

/** The help.json a plugin without one gets. */
export const stubHelp = (folder, m) => ({
  $axf: 'asset@1', type: 'help', id: `${folder}-help`, name: `${m.name || folder} help`, version: '0.1.0',
  description: `The ${folder} plugin's Help mode entries (help@1). Stub written by the gate fixer help-stub.`, author: 'AmberX AXF (gate fixer help-stub)', tags: ['help'],
  data: { scope: `plugin:${folder}`, entries: [screenEntry(folder, m)] },
});

/** What a plugin's help needs → { file, next } or null when it is fine. Only plugins with a view get a screen entry. */
function need(ctx, folder) {
  const p = plugin(ctx, folder);
  const file = join(p.dir, 'help.json');
  const cur = readJson(file);
  const hasView = (p.manifest.provides || []).includes(`view:${folder}`);
  if (!cur) return { file, rel: `apps/console-web/plugins/${folder}/help.json`, next: stubHelp(folder, p.manifest), why: 'no help.json' };
  if (!hasView) return null;
  const entries = Array.isArray(cur?.data?.entries) ? cur.data.entries : [];
  if (entries.some((e) => e?.target === `view:${folder}` || e?.kind === 'screen')) return null;
  const next = { ...cur, data: { ...(cur.data || {}), entries: [...entries, screenEntry(folder, p.manifest)] } };
  return { file, rel: `apps/console-web/plugins/${folder}/help.json`, next, why: `no view:${folder} entry` };
}

export function check(ctx = {}) {
  const missing = pluginFolders(ctx).map((f) => [f, need(ctx, f)]).filter(([, n]) => n).map(([f, n]) => `${f}: ${n.why}`);
  return result(id, { ok: !missing.length, missing, detail: missing.length ? `${missing.length} plugin(s) without help` : 'every plugin has its help' });
}

export function fix(ctx = {}, { dryRun = false } = {}) {
  const planned = []; const changed = [];
  for (const f of pluginFolders(ctx)) {
    const n = need(ctx, f);
    if (!n) continue;
    if (dryRun) planned.push(n.rel);
    else if (writeIfChanged(n.file, jsonText(n.next))) changed.push(n.rel);
  }
  return result(id, { ok: true, dryRun, planned, changed, detail: dryRun ? `would write ${planned.length} help file(s)` : `wrote ${changed.length} help file(s)` });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await cli({ check, fix });

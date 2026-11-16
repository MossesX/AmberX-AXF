/**
 * Fixer `home-card` (build rule `home-card`, Brett Nov 15 2026: "Will the VPS make sure it builds the home card instead
 * of Claude?"). Every plugin ships a Home card: a card@1 asset at plugins/<folder>/assets/card/home.json, tagged `home`.
 * The VPS makes the missing ones from plugin.json and the template below; a build session never designs one.
 *
 * The card reads the plugin's first read-only plugin-commands@1 item (a list command first). A plugin with no read
 * command has no data to put on a card: it is listed under `skipped` (never guessed) and does not fail the check. An existing card (any assets/card file
 * tagged `home`) is never touched, so the fixer is idempotent and Brett's own edits stay.
 *
 * CLI: node apps/console-web/plugins/gate/fixers/home-card.mjs [check|fix] [--dry-run] [--plugin a,b] [--json]
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cardErrors, CARD_TYPE } from '../../../../../framework/core/engines/card-rules.mjs';
import { cli, commandsOf, jsonText, plugin, pluginFolders, readJson, result, rootOf, writeIfChanged } from './lib.mjs';

export const id = 'home-card';
export const CARD_REL = 'assets/card/home.json';

/** The home-card template: an asset@1 of type card, filled from the manifest. */
export const TEMPLATE = Object.freeze({
  $axf: 'asset@1', type: 'card', id: '', name: '', version: '1.0.0', description: '', author: 'AmberX AXF (gate fixer home-card)',
  tags: ['home', 'plugin-home'],
  data: { title: '', icon: 'box', source: { kind: 'command', plugin: '', command: '' }, view: 'auto', refresh: { kind: 'every', every: 60 }, size: 'm' },
});

/** The read command a plugin's card shows: a read-only list first, then any read-only GET. */
export function readCommand(manifest) {
  const reads = commandsOf(manifest).filter((c) => c && c.id && (c.readOnly === true || /^GET\s/.test(String(c.route || ''))));
  return reads.find((c) => /(^|-)list$|status|summary/.test(c.id)) || reads[0] || null;
}

/** The card this plugin would get, or null with why. */
export function cardFor(folder, manifest) {
  const cmd = readCommand(manifest);
  if (!cmd) return { card: null, why: 'no read-only command in plugin.json to show' };
  const name = String(manifest.name || folder).slice(0, 80);
  const card = JSON.parse(JSON.stringify(TEMPLATE));
  Object.assign(card, { id: `${folder}-home`, name, description: `${name} on Home: ${cmd.title || cmd.id}.` });
  Object.assign(card.data, { title: name, icon: String(manifest.icon || 'box'), source: { kind: 'command', plugin: folder, command: cmd.id } });
  const errs = cardErrors(CARD_TYPE, card.data);
  return errs.length ? { card: null, why: `template gives an invalid card: ${errs.join('; ')}` } : { card, why: '' };
}

/** Does the plugin already have a home card (any assets/card/*.json tagged home)? */
export function hasHomeCard(dir) {
  let files = [];
  try { files = readdirSync(join(dir, 'assets', 'card')).filter((f) => f.endsWith('.json')); } catch { return false; }
  return files.some((f) => { const a = readJson(join(dir, 'assets', 'card', f)); return a && a.type === 'card' && Array.isArray(a.tags) && a.tags.includes('home'); });
}

/** Plugins in scope that have no home card. Unfixable ones are listed apart. */
function survey(ctx) {
  const missing = []; const unfixable = []; const plans = [];
  for (const folder of pluginFolders(ctx)) {
    const p = plugin(ctx, folder);
    if (hasHomeCard(p.dir)) continue;
    const { card, why } = cardFor(folder, p.manifest);
    if (!card) { unfixable.push(`${folder}: ${why}`); continue; }
    missing.push(folder); plans.push({ folder, file: join(p.dir, CARD_REL), rel: `apps/console-web/plugins/${folder}/${CARD_REL}`, card });
  }
  return { missing, unfixable, plans };
}

export function check(ctx = {}) {
  const s = survey(ctx);
  const ok = !s.missing.length;
  return result(id, { ok, missing: s.missing, skipped: s.unfixable, detail: ok ? `every plugin with data has a home card (${s.unfixable.length} without a read command skipped)` : `${s.missing.length} plugin(s) without a home card` });
}

export function fix(ctx = {}, { dryRun = false } = {}) {
  const s = survey(ctx);
  const changed = []; const planned = [];
  for (const p of s.plans) {
    if (dryRun) { planned.push(p.rel); continue; }
    if (writeIfChanged(p.file, jsonText(p.card))) changed.push(p.rel);
  }
  return result(id, {
    ok: true, dryRun, planned, changed, skipped: s.unfixable, root: rootOf(ctx),
    detail: dryRun ? `would write ${planned.length} home card(s)` : `wrote ${changed.length} home card(s)`,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await cli({ check, fix });

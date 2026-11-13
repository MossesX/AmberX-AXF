// @ts-nocheck: a Node test, not part of the console's build
/**
 * Self-test for the Asset designer's pure model (web/model.ts) against the real registry and the framework validator.
 *
 *   node --experimental-strip-types apps/console-web/plugins/asset-designer/test.mts   (or npx -y tsx …)
 *
 * Checks: every registered type yields fields and a starter; chrome types carry the chrome settings fields (tab group and
 * toolbar: all of them); the settings type exposes every chrome-settings token; kinds come from enums, chrome fields,
 * samples, descriptions and keys; the gate passes every built-in starter and names the field of each problem; JSON and
 * id helpers; the server's Node side (server/designer.mjs) validates, prepares a manifest and bumps it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fieldsFor, starterFor, gate, newAsset, stripDesigned, parseJson, typeOptions, suggestId, fieldOfError, labelOf, rootKey, previewable, chromeTypeOfSettings, type Spec, type ChromeFields } from './web/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/asset-types.json'), 'utf8')) as { types: Spec };
const spec = registry.types;
const chromeMod = await import(join(ROOT, 'framework/core/engines/chrome-settings-rules.mjs')) as { CHROME_FIELDS: ChromeFields; CHROME_TYPES: string[] };
const engine = await import(join(ROOT, 'framework/cli/build-engine.mjs')) as { validateAsset: (raw: unknown) => { ok: boolean; errors: string[] } };
const chrome = chromeMod.CHROME_FIELDS;
const validate = engine.validateAsset;

let fails = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); if (!ok) fails++; };

// every type: fields + a starter
const types = Object.keys(spec);
check('registry has types', types.length > 40, types.length);
for (const t of types) {
  const f = fieldsFor(spec, chrome, t);
  const keys = f.map((x) => x.key);
  check(`${t}: fields cover every required field`, (spec[t]!.required ?? []).every((k) => keys.includes(k)), spec[t]!.required);
  check(`${t}: no duplicate field`, new Set(keys).size === keys.length);
  check(`${t}: no sub-path field`, keys.every((k) => !/\[\]|\./.test(k)), keys.filter((k) => /\[\]|\./.test(k)));
  const starter = starterFor(spec, chrome, t);
  check(`${t}: starter has every required key`, (spec[t]!.required ?? []).every((k) => k in starter));
}

// chrome types carry every chrome settings field (tab group + toolbar: all of them, none instance-only)
for (const ct of chromeMod.CHROME_TYPES) {
  const f = fieldsFor(spec, chrome, ct);
  const want = chrome[ct]!.filter((c) => !c.instanceOnly).map((c) => c.key);
  check(`${ct}: all ${want.length} chrome fields present, first`, want.every((k) => f.find((x) => x.key === k)?.group === 'chrome'), want.filter((k) => f.find((x) => x.key === k)?.group !== 'chrome'));
  check(`${ct}: instance-only tapConfirm is not an asset field`, !f.some((x) => x.key === 'tapConfirm'));
}
const tg = fieldsFor(spec, chrome, 'tab-group');
check('tab-group style is a choice with the enum options', tg.find((f) => f.key === 'style')?.kind === 'choice' && tg.find((f) => f.key === 'style')?.options?.includes('pills') === true);
check('tab-group divider is a toggle with default true', tg.find((f) => f.key === 'divider')?.kind === 'toggle' && tg.find((f) => f.key === 'divider')?.default === true);
const tb = fieldsFor(spec, chrome, 'toolbar');
check('toolbar groups is a json list field', tb.find((f) => f.key === 'groups')?.kind === 'json' && tb.find((f) => f.key === 'groups')?.object !== true);
check('toolbar groups hint carries its sub-path notes', /groups\[\]\.items\[\]\.badge/.test(tb.find((f) => f.key === 'groups')?.hint ?? ''));
check('toolbar showSearch is a toggle', tb.find((f) => f.key === 'showSearch')?.kind === 'toggle');
check('toolbar density / surface are choices from the enum', ['density', 'surface'].every((k) => tb.find((f) => f.key === k)?.kind === 'choice' && (tb.find((f) => f.key === k)?.options?.length ?? 0) >= 3));

// the settings type (chrome settings interface): every token is a field
const st = fieldsFor(spec, chrome, 'settings');
const stKeys = st.map((f) => f.key);
for (const k of ['layout', 'header', 'search', 'descriptions', 'for', 'extends', 'toolbar', 'levels', 'defaultLevel', 'levelOf', 'visible']) check(`settings: token ${k} is a field`, stKeys.includes(k));
check('settings: levelOf is an object json field', st.find((f) => f.key === 'levelOf')?.kind === 'json' && st.find((f) => f.key === 'levelOf')?.object === true);
check('settings: levels is a toggle', st.find((f) => f.key === 'levels')?.kind === 'toggle');

// samples refine kinds
const sampled = fieldsFor(spec, chrome, 'toolbar', { groups: [], showSearch: true, window: 'main' });
check('sample boolean → toggle, string → text, array → json', sampled.find((f) => f.key === 'showSearch')?.kind === 'toggle' && sampled.find((f) => f.key === 'window')?.kind === 'text' && sampled.find((f) => f.key === 'groups')?.kind === 'json');

// the gate on every built-in starter: all pass, and a broken one names its field
const assetsDir = join(ROOT, 'framework/assets');
let builtins = 0;
for (const t of readdirSync(assetsDir)) {
  const d = join(assetsDir, t);
  if (!existsSync(d) || !spec[t]) continue;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
    const a = JSON.parse(readFileSync(join(d, f), 'utf8'));
    const g = gate(validate, a, fieldsFor(spec, chrome, t, a.data));
    if (!g.ok) check(`${t}/${f} passes the gate`, false, g.errors);
    builtins++;
  }
}
check('built-in starters all pass the gate', builtins > 300 && fails === 0, builtins);
const toolbarFields = fieldsFor(spec, chrome, 'toolbar');
const broken = newAsset('toolbar', 'my-bar', 'My bar', { variant: 'sideways', align: 'start', groups: [], showSearch: false });
const gb = gate(validate, broken, toolbarFields);
check('bad enum fails the gate', !gb.ok);
check('bad enum names its field (variant)', (gb.byField.variant?.length ?? 0) > 0, gb);
const badId = gate(validate, newAsset('toolbar', 'Bad Id', 'x', starterFor(spec, chrome, 'toolbar')), toolbarFields);
check('bad id lands on the id field', (badId.byField.id?.length ?? 0) > 0, badId);
check('preview id refused', !gate(validate, newAsset('toolbar', 'ad-preview-toolbar', 'x', starterFor(spec, chrome, 'toolbar')), toolbarFields).ok);
const good = newAsset('toolbar', 'my-bar', 'My bar', starterFor(spec, chrome, 'toolbar'));
check('starter toolbar passes the gate', gate(validate, good, toolbarFields).ok, gate(validate, good, toolbarFields).errors);
check('starter tab-group passes the gate', gate(validate, newAsset('tab-group', 'my-tabs', 'My tabs', starterFor(spec, chrome, 'tab-group')), tg).ok);
check('fieldOfError: data.<key>', fieldOfError('data.groups[0].items must be an array', ['groups', 'items']) === 'groups');
check('fieldOfError: quoted key', fieldOfError('"showSearch" must be a boolean', ['showSearch']) === 'showSearch');
check('fieldOfError: envelope', fieldOfError('"version" must be a string', ['x']) === 'version');
check('fieldOfError: none', fieldOfError('something else entirely', ['x']) === '');

// helpers
check('stripDesigned removes the manifest only', !('designed' in stripDesigned({ ...good, designed: { a: 1 } })) && stripDesigned({ ...good, designed: 1 }).id === 'my-bar');
check('parseJson ok / error', parseJson('{"a":1}').value !== undefined && typeof parseJson('{').error === 'string');
check('typeOptions grouped and labelled', typeOptions(spec).some((o) => o.value === 'toolbar' && o.label === 'Navigation · Toolbar'));
check('suggestId slug + dedupe', suggestId('My Bar!') === 'my-bar' && suggestId('My Bar', ['my-bar']) === 'my-bar-2');
check('labelOf', labelOf('showSearch') === 'Show search' && labelOf('levelOf') === 'Level of');
check('rootKey', rootKey('groups[].items[].badge') === 'groups' && rootKey('items[].provider|badge') === 'items');
check('previewable: toolbar yes, clock (attachable) no, uac-policy no', previewable(spec, 'toolbar') && !previewable(spec, 'clock') && !previewable(spec, 'uac-policy'));
check('chromeTypeOfSettings', chromeTypeOfSettings(newAsset('settings', 'x', 'x', { for: 'toolbar' }), chromeMod.CHROME_TYPES) === 'toolbar' && chromeTypeOfSettings(good, chromeMod.CHROME_TYPES) === null);

// the server's Node side
const run = (op: string, payload: unknown) => { const r = spawnSync(process.execPath, [join(HERE, 'server/designer.mjs'), op], { input: JSON.stringify(payload), encoding: 'utf8' }); return JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}'); };
check('designer.mjs validate ok', run('validate', { asset: good }).ok === true);
check('designer.mjs validate error', run('validate', { asset: broken }).ok === false && run('validate', { asset: broken }).errors.length > 0);
const p1 = run('prepare', { asset: good, app: 'axf-console', now: '2026-11-13T18:00:00.000Z' });
check('prepare: manifest revision 1 with a uid and hash', p1.ok && p1.asset.designed?.revision === 1 && /^dz-/.test(p1.asset.designed.uid) && /^[0-9a-f]{8}$/.test(p1.asset.designed.hash), p1);
check('prepare: addon picked from the type (toolbar)', p1.asset.designed?.addon === 'toolbar');
const p2 = run('prepare', { asset: { ...p1.asset, data: { ...p1.asset.data, showSearch: true } }, previous: p1.asset, now: '2026-11-13T18:05:00.000Z' });
check('prepare again: revision 2, same uid, version bumped, new hash', p2.ok && p2.asset.designed.revision === 2 && p2.asset.designed.uid === p1.asset.designed.uid && p2.asset.version !== p1.asset.version && p2.asset.designed.hash !== p1.asset.designed.hash, p2);
check('prepare refuses an invalid asset', run('prepare', { asset: broken }).ok === false);
const ch = run('chrome', {});
check('chrome: tab-group and toolbar fields + defaults', ch.ok && ch.fields['tab-group'].length >= 12 && ch.fields.toolbar.length >= 7 && ch.defaults.toolbar === 'chrome-toolbar');
const ty = run('types', {});
check('types: every registry type listed (the build engine may register more)', ty.ok && types.every((t) => ty.items.some((i: { type: string }) => i.type === t)), ty.items?.length);

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);

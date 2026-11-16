#!/usr/bin/env node
/**
 * plugin-settings@1 conformance (framework/core/plugin-settings.mjs): the `settings` block of plugin.json.
 *   node framework/spec/check-plugin-settings.mjs           check
 *   node framework/spec/check-plugin-settings.mjs --write   regenerate fixtures/plugin-settings.json's expected outputs
 *  1. replays the fixture's manifests through defaultSettings / normalizeSettings / checkSettings / settingsTarget
 *  2. the JSON schema (schemas/plugin-settings.json) agrees with the engine: parent, defaults, built-in sections,
 *     patterns, key list; plugin.schema.json refers to it
 *  3. every console plugin's manifest: a declared block is right; one without gets a default that validates and whose
 *     tab is a settings-tab it provides (reports how many still run on the default)
 *  4. the address matches react/controlTargets.ts's constants and shape
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/plugin-settings.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/plugin-settings.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const base = { $axf: 'plugin@1', id: 'ai.amberx.axf.console.voice-notes', name: 'Voice notes', provides: ['view:voice-notes', 'settings-tab:voice-notes'] };
const IN = {
  none: { folder: 'apps/console-web/plugins/voice-notes', manifest: base },
  noneNoScreen: { folder: 'apps/console-web/plugins/push-banner', manifest: { ...base, id: 'ai.amberx.axf.console.push-banner', name: 'Push banner', provides: ['settings-tab:push-banner'] } },
  noneNoTab: { folder: 'apps/console-web/plugins/notes-tasks', manifest: { ...base, id: 'ai.amberx.axf.console.notes-tasks', name: 'Notes tasks', provides: ['action:notes-tasks.sync'] } },
  partial: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes' } } },
  full: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { $axf: 'plugin-settings@1', tab: 'voice-notes', parent: 'plugins', sections: ['enable', 'info', 'logs', 'options', 'voice-notes.triggers'], options: ['axf.voiceNotes.triggers', 'axf.voiceNotes.beep'], gear: true } } },
  reordered: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', sections: ['logs', 'voice-notes.lists', 'enable', 'info'] } } },
  noScreenFull: { folder: 'apps/console-web/plugins/push-banner', manifest: { ...base, id: 'x', name: 'Push banner', provides: ['settings-tab:push-banner', 'dialog:push-banner.setup'], settings: { tab: 'push-banner', gear: false, options: ['push-banner.show'] } } },
  junk: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: 'yes' } },
  wrongTab: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'Voice Notes' } } },
  otherTab: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice' } } },
  noTabProvided: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, provides: ['view:voice-notes'], settings: { tab: 'voice-notes' } } },
  topLevel: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', parent: 'general' } } },
  dropsDefaults: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', sections: ['options'] } } },
  repeats: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', sections: ['enable', 'info', 'logs', 'logs'], options: ['a', 'a'] } } },
  badKeys: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', options: ['has space'], extra: 1, $axf: 'plugin-settings@2' } } },
  gearOffWithScreen: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', gear: false } } },
  gearOnNoScreen: { folder: 'apps/console-web/plugins/push-banner', manifest: { ...base, provides: ['settings-tab:push-banner'], settings: { tab: 'push-banner', gear: true } } },
  gearString: { folder: 'apps/console-web/plugins/voice-notes', manifest: { ...base, settings: { tab: 'voice-notes', gear: 'yes' } } },
};

const out = { defaults: {}, normalized: {}, problems: {}, problemsOptional: {}, target: {}, address: {}, badAddress: [] };
for (const [k, c] of Object.entries(IN)) {
  out.defaults[k] = P.defaultSettings(c.manifest, { folder: c.folder });
  out.normalized[k] = P.normalizeSettings(c.manifest, { folder: c.folder });
  out.problems[k] = P.checkSettings(c.manifest, { folder: c.folder });
  out.problemsOptional[k] = P.checkSettings(c.manifest, { folder: c.folder, required: false });
  out.target[k] = P.settingsTarget(c.manifest, { folder: c.folder });
}
for (const id of ['voice-notes', 'plugin-manager', 'a.b_c-d']) out.address[id] = { address: P.settingsAddress(id), action: P.settingsOpenAction(id) };
for (const bad of ['', 'Voice Notes', 'x/y', 42, null]) { try { P.settingsAddress(bad); out.badAddress.push({ in: bad, threw: false }); } catch { out.badAddress.push({ in: bad, threw: true }); } }

if (WRITE) {
  writeFileSync(FIX, JSON.stringify({ $axf: P.SCHEMA, note: 'Generated by framework/spec/check-plugin-settings.mjs --write; every port replays `in` and must answer `out`.', registry: P.REGISTRY, in: IN, out }, null, 1) + '\n');
  console.log(`wrote ${FIX}`);
}

/* ---------- 1. fixture replay ---------- */
const fix = rd('framework/spec/fixtures/plugin-settings.json');
t('fixture header', () => { assert.equal(fix.$axf, P.SCHEMA); assert.ok(same(fix.registry, P.REGISTRY), 'registry'); });
t('fixture inputs are current', () => assert.ok(same(fix.in, IN), 'run --write after changing the cases'));
for (const k of Object.keys(IN)) {
  t(`defaults ${k}`, () => assert.deepEqual(out.defaults[k], fix.out.defaults[k]));
  t(`normalized ${k}`, () => assert.deepEqual(out.normalized[k], fix.out.normalized[k]));
  t(`problems ${k}`, () => assert.deepEqual(out.problems[k], fix.out.problems[k]));
  t(`problems (optional) ${k}`, () => assert.deepEqual(out.problemsOptional[k], fix.out.problemsOptional[k]));
  t(`target ${k}`, () => assert.deepEqual(out.target[k], fix.out.target[k]));
}
t('addresses', () => assert.deepEqual(out.address, fix.out.address));
t('bad addresses', () => assert.deepEqual(out.badAddress, fix.out.badAddress));

/* ---------- behaviour the fixture must show ---------- */
t('no block: default, no problem when optional, one when required', () => {
  assert.deepEqual(out.defaults.none, { $axf: P.SCHEMA, tab: 'voice-notes', parent: 'plugins', sections: ['enable', 'info', 'logs'], options: [], gear: true });
  assert.deepEqual(out.problemsOptional.none, []);
  assert.equal(out.problems.none.length, 1); assert.match(out.problems.none[0], /"settings" is missing/);
});
t('no screen: default gear off; no tab provided: folder name', () => { assert.equal(out.defaults.noneNoScreen.gear, false); assert.equal(out.defaults.noneNoTab.tab, 'notes-tasks'); });
t('partial fills the defaults', () => assert.deepEqual(out.normalized.partial, out.defaults.none));
t('full is kept, in order, no problems', () => { assert.deepEqual(out.normalized.full, IN.full.manifest.settings); assert.deepEqual(out.problems.full, []); });
t('defaults lead, in their order; the plugin\'s own sections follow', () => assert.deepEqual(out.normalized.reordered.sections, ['enable', 'info', 'logs', 'voice-notes.lists']));
t('no screen, gear false, options: fine', () => assert.deepEqual(out.problems.noScreenFull, []));
for (const [k, re] of [['junk', /is a plugin-settings@1 block/], ['wrongTab', /tab is its settings tab id/], ['otherTab', /isn't a tab it provides \("settings-tab:voice-notes"\)/], ['noTabProvided', /provides no "settings-tab:voice-notes"/], ['topLevel', /never a top-level tab/], ['dropsDefaults', /drops "enable", "info", "logs"/], ['gearOffWithScreen', /has a screen \(view:voice-notes\)/], ['gearOnNoScreen', /no screen to carry it/], ['gearString', /gear is true or false/]]) {
  t(`problem ${k}`, () => { assert.equal(out.problems[k].length, 1, JSON.stringify(out.problems[k])); assert.match(out.problems[k][0], re); });
}
t('repeats: two problems', () => { assert.equal(out.problems.repeats.length, 2); assert.match(out.problems.repeats[0], /repeats a section/); assert.match(out.problems.repeats[1], /repeats a key/); });
t('bad keys: unknown key, $axf, options', () => { assert.equal(out.problems.badKeys.length, 3); assert.match(out.problems.badKeys[0], /unknown key "extra"/); assert.match(out.problems.badKeys[1], /\$axf is "plugin-settings@1"/); assert.match(out.problems.badKeys[2], /options is a list of setting keys/); });

/* ---------- 2. schema ---------- */
const schema = rd('framework/schemas/plugin-settings.json');
t('schema: title and no extra keys', () => { assert.match(schema.title, /^plugin-settings@1/); assert.equal(schema.additionalProperties, false); assert.deepEqual(Object.keys(schema.properties).sort(), [...P.KEYS].sort()); });
t('schema: tab required, parent const, $axf const', () => { assert.deepEqual(schema.required, ['tab']); assert.equal(schema.properties.parent.const, P.PARENT); assert.equal(schema.properties.$axf.const, P.SCHEMA); });
t('schema: default sections and built-ins = engine', () => { assert.deepEqual(schema.properties.sections.default, [...P.DEFAULT_SECTIONS]); assert.deepEqual(schema['x-builtinSections'], [...P.BUILTIN_SECTIONS]); assert.deepEqual(schema.properties.sections.allOf.map((x) => x.contains.const), [...P.DEFAULT_SECTIONS]); });
t('schema: patterns = engine', () => { assert.equal(schema.properties.tab.pattern, P.TAB_ID.source); assert.equal(schema.properties.sections.items.pattern, P.SECTION_ID.source); assert.equal(schema.properties.options.items.pattern, P.OPTION_KEY.source); });
t('plugin.schema.json refers to it', () => assert.equal(rd('framework/schemas/plugin.schema.json').properties.settings.$ref, 'plugin-settings.json'));
t('built-ins start with the defaults', () => assert.deepEqual(P.BUILTIN_SECTIONS.slice(0, 3), [...P.DEFAULT_SECTIONS]));

/* ---------- 3. every console plugin ---------- */
const dir = join(ROOT, 'apps/console-web/plugins');
let declared = 0, defaulted = 0; const bad = [];
for (const folder of existsSync(dir) ? readdirSync(dir).sort() : []) {
  const f = join(dir, folder, 'plugin.json');
  if (folder.startsWith('_') || !existsSync(f)) continue;
  const m = JSON.parse(readFileSync(f, 'utf8'));
  const rel = `apps/console-web/plugins/${folder}`;
  if (m.settings !== undefined) { declared += 1; for (const x of P.checkSettings(m, { folder: rel })) bad.push(`${folder}/plugin.json: ${x}`); }
  else {
    defaulted += 1;
    const d = P.defaultSettings(m, { folder: rel });
    const probs = P.checkSettings({ ...m, settings: d }, { folder: rel });
    // a plugin that provides no settings-tab (every plugin must; the audit lists them) is the only reason a default can fail
    for (const x of probs) if (!/provides no "settings-tab:/.test(x)) bad.push(`${folder}/plugin.json (default): ${x}`);
  }
}
t('every declared block is right, every default validates', () => assert.deepEqual(bad, []));
t('plugins seen', () => assert.ok(declared + defaulted > 0));

/* ---------- 4. address shape ---------- */
const ct = readFileSync(join(ROOT, 'framework/react/controlTargets.ts'), 'utf8');
t('address pieces = controlTargets.ts', () => {
  assert.ok(ct.includes(`SETTINGS_VIEW_ADDRESS = '${P.SETTINGS_VIEW}'`)); assert.ok(ct.includes(`SETTINGS_TAB_ROW = '${P.SETTINGS_TAB_ROW}'`)); assert.ok(ct.includes(`SETTINGS_SUBTAB_ROW = '${P.SETTINGS_SUBTAB_ROW}'`));
  assert.equal(P.settingsAddress('voice-notes'), 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=voice-notes');
});

console.log(`✓ plugin-settings@1: ${n} checks; ${declared} console plugins declare a settings block, ${defaulted} run on the default`);

/**
 * Self-test for settings-placement@1 (CI: npx -y tsx framework/spec/check-settings-placement.mts).
 *  1. replays spec/fixtures/settings-placement.json against core/engines/settingsplacement.ts (resolve, normalize,
 *     scopes, free-text parsing, choices, the interface's opensIn, host modes, looks, descriptions, storage round trips)
 *  2. every console plugin with settings: its plugin.json `settingsHost` / `settingsPlacement` are valid, a plugin that
 *     declares a host wraps its UI in <SettingsHost>, and its settings can open as a panel, a dialog, a sheet, a window
 *     and the page (with its host open and with it closed), so "inside" always lands somewhere (Brett, Nov 3 2026)
 *  3. every settings asset's `opensIn` (when set) is a valid pick, and the look stays on tokens: lookStyle never yields
 *     a raw px or colour
 *  4. the rule (Nov 4 2026): every screen can host its settings — AppShell wraps the main area in <SettingsHost>, the
 *     settings library routes `app.settings` and `settings.open` through the placement, the picker lists every screen
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as E from '../core/engines/settingsplacement';
import { normalizeSettingsUi } from '../core/engines/settingsui';

const f = JSON.parse(readFileSync(new URL('./fixtures/settings-placement.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture ---------- */
eq(E.SETTINGS_PLACEMENTS, f.placements, 'placements');
eq(E.SIDES, f.sides, 'sides');
eq(E.INSIDE_MODES, f.modes, 'modes');
eq(E.PLACEMENT_CHOICES, f.choices, 'choices');
eq(E.PLACEMENT_ALIASES, f.aliases, 'aliases');
eq(E.DEFAULT_PICK, f.defaultPick, 'default pick');
eq({ default: E.SETTINGS_PLACEMENT_DEFAULT_KEY, owner: E.settingsPlacementKey('x.plugin'), screen: E.screenPlacementKey('home'), screenOfKey: E.screenOfKey(E.screenPlacementKey('home')), notScreen: E.screenOfKey(E.settingsPlacementKey('home')) }, f.keys, 'keys');
for (const c of f.resolve) eq(E.resolveSettingsOpen(E.normalizePick(f.picks[c.pick]), { host: f.hosts[c.host], hostable: c.hostable, reducedMotion: c.reducedMotion }), c.route, `resolve ${c.pick} / ${c.host}${c.reducedMotion ? ' / reduced motion' : ''}`);
for (const c of f.normalize) eq(E.normalizePick(c.input), c.pick, `normalize ${JSON.stringify(c.input)}`);
for (const c of f.pickFor) eq(E.pickFor(c.inputs), { pick: c.pick, from: c.from }, `pickFor ${JSON.stringify(c.inputs)}`);
for (const c of f.effective) eq(E.effectivePick(c.own, c.appDefault, c.legacy, c.declared), c.pick, `effective ${JSON.stringify(c)}`);
for (const c of f.parse) eq(E.parsePlacement(c.text), c.pick, `parse "${c.text}"`);
for (const c of f.choices_) { const pick = E.applyChoice(c.choice, E.normalizePick(f.picks.split)); eq(pick, c.pick, `choice ${c.choice}`); eq(E.choiceOf(pick), c.back, `choice ${c.choice} round trip`); eq(E.CHOICE_LABELS[c.choice as E.PlacementChoice], c.label, `label ${c.choice}`); }
for (const c of f.opensIn) eq(E.normalizeOpensIn(c.input), c.pick, `opensIn ${JSON.stringify(c.input)}`);
for (const c of f.hostModes) eq(E.hostModes(c.input), c.modes, `hostModes ${JSON.stringify(c.input)}`);
for (const c of f.looks) { eq(E.DEFAULT_LOOKS[c.key as E.LookKey], c.look, `default look ${c.key}`); eq(E.lookStyle(c.look), c.style, `look style ${c.key}`); }
for (const c of f.describe) eq(E.describePick(E.normalizePick(f.picks[c.pick])), c.text, `describe ${c.pick}`);
// a pick survives a round trip through storage; a legacy pick lands on the new vocabulary
for (const p of Object.values(f.picks)) eq(E.normalizePick(E.encodePick(E.normalizePick(p))), E.normalizePick(p), 'encode round trip');
eq(E.normalizePick(f.picks.legacyMain).placement, 'page', 'legacy main → page');
eq(E.normalizePick(f.picks.legacyFallback).looks.panel?.size, 'wide', 'legacy fallback look → panel look');
eq(E.normalizePick(f.picks.legacyFallback).side, 'left', 'legacy fallback edge → side');
// the scope order: screen beats everything, the interface beats the app default, a screen set to "default" is the app default
eq(E.pickFor({ screen: 'window', owner: 'sheet', declared: 'dialog', interface: 'panel-left', appDefault: 'page' }).from, 'screen', 'screen wins');
eq(E.pickFor({ interface: 'panel-left', appDefault: 'page' }).pick.placement, 'panel', 'interface beats the app default');
eq(E.pickFor({ screen: 'default', appDefault: 'dialog' }), { pick: E.normalizePick('dialog'), from: 'app' }, 'screen "default" = the app default');
// the settings-ui engine carries opensIn through, and drops it when unset or nonsense
eq(normalizeSettingsUi({ layout: 'list', opensIn: 'dialog' }).opensIn?.placement, 'dialog', 'settings-ui opensIn');
eq('opensIn' in normalizeSettingsUi({ layout: 'list' }), false, 'settings-ui without opensIn');
eq('opensIn' in normalizeSettingsUi({ layout: 'list', opensIn: 'nowhere' }), false, 'settings-ui bad opensIn dropped');

/* ---------- 2. every console plugin with settings ---------- */
const root = new URL('../../apps/console-web/plugins/', import.meta.url).pathname;
const webFiles = (dir: string): string[] => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? (d.name === 'vendor' || d.name === 'node_modules' ? [] : webFiles(join(dir, d.name))) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []) : [];
let plugins = 0;
for (const folder of readdirSync(root)) {
  const mf = join(root, folder, 'plugin.json');
  if (folder.startsWith('_') || !existsSync(mf)) continue;
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  const hasSettings = (m.provides ?? []).some((p: string) => p.startsWith('settings-tab:'));
  if (m.settingsHost !== undefined) {
    const ok = typeof m.settingsHost === 'boolean' || (Array.isArray(m.settingsHost) && m.settingsHost.every((x: string) => (E.INSIDE_MODES as readonly string[]).includes(x)));
    assert.ok(ok, `${folder}: settingsHost must be true / false or a list of ${E.INSIDE_MODES.join(', ')}`); checks++;
    if (E.hostModes(m.settingsHost).length) {
      const src = webFiles(join(root, folder, 'web')).map((p) => readFileSync(p, 'utf8')).join('\n');
      assert.ok(/<SettingsHost\b/.test(src), `${folder}: plugin.json says settingsHost but its web part never renders <SettingsHost owner=…> (framework/react/settingsHost.tsx)`); checks++;
      assert.ok(hasSettings, `${folder}: settingsHost without a settings tab`); checks++;
    }
  }
  if (m.settingsPlacement !== undefined) {
    const p = m.settingsPlacement;
    assert.ok(p && typeof p === 'object' && E.placementOf(p.placement), `${folder}: settingsPlacement.placement must be one of ${E.SETTINGS_PLACEMENTS.join(', ')}`); checks++;
    if (p.mode !== undefined) { assert.ok((E.INSIDE_MODES as readonly string[]).includes(p.mode), `${folder}: settingsPlacement.mode must be one of ${E.INSIDE_MODES.join(', ')}`); checks++; }
    if (p.side !== undefined) { assert.ok((E.SIDES as readonly string[]).includes(p.side), `${folder}: settingsPlacement.side must be left or right`); checks++; }
    eq(E.normalizePick(E.encodePick(E.normalizePick(p))).placement, E.placementOf(p.placement), `${folder}: settingsPlacement round trip`);
  }
  if (!hasSettings) continue;
  plugins++;
  const modes = E.hostModes(m.settingsHost);
  const hosts: (E.HostInfo | null)[] = [null, ...(modes.length ? [{ modes, compact: false }, { modes, compact: true }] : [])];
  for (const host of hosts) {
    const at = (pick: Partial<E.SettingsPlacementPick>) => E.resolveSettingsOpen(E.normalizePick(pick), { host, hostable: modes.length > 0 });
    const pane = at({ placement: 'inside', mode: 'pane' });
    assert.ok(pane.via === 'panel' || (pane.via === 'host' && pane.mode === 'pane'), `${folder}: settings can't open as a pane (${JSON.stringify(pane)})`); checks++;
    for (const via of ['dialog', 'panel', 'sheet', 'window', 'page'] as const) { assert.equal(at({ placement: via }).via, via, `${folder}: settings can't open as ${via}`); checks++; }
    for (const mode of E.INSIDE_MODES) { const r = at({ placement: 'inside', mode }); assert.ok(r.via === 'host' || r.via === 'panel', `${folder}: inside/${mode} lands nowhere`); checks++; }
  }
}
assert.ok(plugins > 10, `only ${plugins} plugins with settings found under ${root}`); checks++;

/* ---------- 3. settings assets + tokens only ---------- */
const assetsDir = new URL('../assets/settings/', import.meta.url).pathname;
for (const file of readdirSync(assetsDir).filter((x) => x.endsWith('.json'))) {
  const a = JSON.parse(readFileSync(join(assetsDir, file), 'utf8'));
  if (a.data?.opensIn === undefined) { checks++; continue; }
  assert.ok(E.normalizeOpensIn(a.data.opensIn), `assets/settings/${file}: opensIn must be a placement word or a pick (${JSON.stringify(a.data.opensIn)})`); checks++;
}
for (const key of Object.keys(E.DEFAULT_LOOKS) as E.LookKey[]) for (const size of E.SIZES) for (const radius of E.LEVELS) {
  const { vars } = E.lookStyle({ ...E.DEFAULT_LOOKS[key], size, radius, shadow: radius });
  for (const [k, v] of Object.entries(vars)) { assert.ok(!/\d+px|#[0-9a-f]{3,8}\b|rgba?\(/i.test(v), `${k}: ${v} is not a token`); checks++; }
}

/* ---------- 4. every screen can host its settings; the library routes every opening ---------- */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const shell = read('../react/AppShell.tsx');
assert.ok(/<SettingsHost\b[^>]*owner=\{screenOwner\(/.test(shell), 'AppShell wraps the main area in <SettingsHost owner={screenOwner(view)}> so any screen can open its settings inside itself'); checks++;
const lib = read('../libs/settings/index.tsx');
for (const need of ["rt.actions.register('app.settings'", 'openPlaced(rt', 'PopsUpInRow', 'ScreenPlacementList', 'settings.open-for', 'settingsTargetOf(rt', "'Settings opens in'"]) { assert.ok(lib.includes(need), `libs/settings: missing ${need}`); checks++; }
const host = read('../react/settingsHost.tsx');
for (const need of ['closing', 'animationend', 'screenOwner', "via === 'sheet'", "via === 'panel'"]) { assert.ok(host.includes(need), `react/settingsHost.tsx: missing ${need}`); checks++; }

console.log(`settings-placement@1: ${checks} checks passed (${f.resolve.length} resolve cases, ${f.parse.length} parse cases, ${plugins} plugins with settings)`);

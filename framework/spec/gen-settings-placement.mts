/*
 * Generates spec/fixtures/settings-placement.json from the reference engine (core/engines/settingsplacement.ts):
 *   npx -y tsx framework/spec/gen-settings-placement.mts
 * The fixture is the conformance contract for every port (spec/check-settings-placement.mts replays it; a Kotlin twin
 * will replay the same file). Run it after changing the engine, then commit the fixture with the change.
 */
import { writeFileSync } from 'node:fs';
import * as E from '../core/engines/settingsplacement';

const picks: Record<string, unknown> = {
  page: { placement: 'page' },
  dialog: { placement: 'dialog' },
  window: { placement: 'window' },
  panelLeft: { placement: 'panel', side: 'left' },
  panelRight: { placement: 'panel', side: 'right', looks: { panel: { size: 'wide', animation: 'fade' } } },
  sheet: { placement: 'sheet', looks: { sheet: { size: 'wide' } } },
  inline: { placement: 'inside', mode: 'inline' },
  paneLeft: { placement: 'inside', mode: 'pane', looks: { 'inside:pane': { edge: 'left', animation: 'slide', dim: true } } },
  split: { placement: 'inside', mode: 'split', looks: { 'inside:split': { edge: 'right', size: 'half' } } },
  dropdown: { placement: 'inside', mode: 'dropdown' },
  tab: { placement: 'inside', mode: 'tab' },
  legacyMain: { $axf: 'settings-placement@1', placement: 'main', mode: 'pane', looks: {} },
  legacyFallback: { placement: 'inside', mode: 'split', looks: { fallback: { edge: 'left', size: 'wide' } } },
  bad: { placement: 'sideways', side: 'up', mode: 'spiral', looks: { 'inside:pane': { animation: 'wobble', speed: 'fast' }, nonsense: { edge: 'left' } } },
};
const hosts: Record<string, E.HostInfo | null> = {
  none: null,
  all: { modes: [...E.INSIDE_MODES], compact: false },
  allCompact: { modes: [...E.INSIDE_MODES], compact: true },
  paneOnly: { modes: ['pane'], compact: false },
};

const resolve: unknown[] = [];
for (const [pick, p] of Object.entries(picks)) for (const [host, h] of Object.entries(hosts)) {
  const hostable = host !== 'none' || pick === 'paneLeft';
  resolve.push({ pick, host, hostable, reducedMotion: false, route: E.resolveSettingsOpen(E.normalizePick(p), { host: h, hostable }) });
}
for (const pick of ['dialog', 'panelLeft', 'sheet', 'paneLeft']) resolve.push({ pick, host: 'all', hostable: true, reducedMotion: true, route: E.resolveSettingsOpen(E.normalizePick(picks[pick]), { host: hosts.all, hostable: true, reducedMotion: true }) });

const normalize = [
  null, '', 'dialog', 'main', 'side panel left', 'bottom sheet', '{"placement":"window"}', '{bad json', 42,
  picks.bad, picks.legacyMain, picks.legacyFallback, { placement: 'panel' }, { placement: 'inside' },
].map((input) => ({ input, pick: E.normalizePick(input) }));

const scopes: E.PickInputs[] = [
  {},
  { legacyOpens: 'dialog' },
  { appDefault: 'dialog' },
  { appDefault: picks.dialog, interface: 'panel-left' },
  { appDefault: picks.dialog, interface: 'panel-left', declared: picks.paneLeft },
  { appDefault: picks.dialog, declared: picks.paneLeft, owner: picks.sheet },
  { appDefault: picks.dialog, owner: picks.sheet, screen: 'window' },
  { appDefault: picks.dialog, screen: 'default' },
  { appDefault: picks.dialog, screen: '' },
  { appDefault: 'main', screen: { placement: 'inside' } },
  { interface: { placement: 'nowhere' }, appDefault: picks.sheet },
  { screen: picks.legacyMain, appDefault: picks.dialog },
];
const pickFor = scopes.map((inputs) => ({ inputs, ...E.pickFor(inputs) }));
const effective = [
  { own: null, appDefault: null, legacy: null, declared: null },
  { own: null, appDefault: null, legacy: 'dialog', declared: null },
  { own: null, appDefault: picks.sheet, legacy: 'dialog', declared: null },
  { own: null, appDefault: picks.sheet, legacy: null, declared: picks.paneLeft },
  { own: '{"placement":"window"}', appDefault: picks.sheet, legacy: null, declared: picks.paneLeft },
].map((c) => ({ ...c, pick: E.effectivePick(c.own, c.appDefault, c.legacy, c.declared) }));

const parse = [
  'dialog', 'in a dialog', 'pop it up in a pop-up dialog', 'side panel', 'side panel left', 'left side panel', 'panel on the right', 'left', 'right',
  'bottom sheet', 'from the bottom', 'inside', 'inside the screen', 'inside as a split view', 'inline', 'in a drop-down inside', 'full page', 'page', 'main',
  'floating window', 'in its own window', 'default', 'use the app default', 'app default', 'somewhere else', '', 'panel-left', 'panel-right', 'sheet', 'window',
].map((text) => ({ text, pick: E.parsePlacement(text) }));

const choices = E.PLACEMENT_CHOICES.map((choice) => { const pick = E.applyChoice(choice, E.normalizePick(picks.split)); return { choice, pick, back: E.choiceOf(pick), label: E.CHOICE_LABELS[choice] }; });

const opensIn = [null, '', 'default', 'dialog', 'panel-left', 'side panel right', { placement: 'sheet' }, { placement: 'nowhere' }, 'nothing like it', '{"placement":"inside","mode":"tab"}']
  .map((input) => ({ input, pick: E.normalizeOpensIn(input) }));

const hostModes = [true, false, undefined, ['split'], ['pane', 'tab'], { modes: ['inline', 'bogus'] }, 'x'].map((input) => ({ input, modes: E.hostModes(input) }));
const looks = (Object.keys(E.DEFAULT_LOOKS) as E.LookKey[]).map((key) => ({ key, look: E.DEFAULT_LOOKS[key], style: E.lookStyle(E.DEFAULT_LOOKS[key]) }));
const describe = Object.keys(picks).map((pick) => ({ pick, text: E.describePick(E.normalizePick(picks[pick])) }));
const keys = { default: E.SETTINGS_PLACEMENT_DEFAULT_KEY, owner: E.settingsPlacementKey('x.plugin'), screen: E.screenPlacementKey('home'), screenOfKey: E.screenOfKey(E.screenPlacementKey('home')), notScreen: E.screenOfKey(E.settingsPlacementKey('home')) };

const fixture = {
  $axf: 'fixture@1',
  engine: 'settings-placement@1',
  note: 'Generated by framework/spec/gen-settings-placement.mts from core/engines/settingsplacement.ts. Where settings open: dialog, side panel (left / right), bottom sheet, inside the screen (pane, drop-down, tab, split, inline), full page, floating window; scopes screen > owner > plugin > interface > app > legacy > system; fallback to the side panel; looks on theme tokens.',
  placements: E.SETTINGS_PLACEMENTS, sides: E.SIDES, modes: E.INSIDE_MODES, choices: E.PLACEMENT_CHOICES, aliases: E.PLACEMENT_ALIASES,
  defaultPick: E.DEFAULT_PICK, keys,
  picks, hosts, resolve, normalize, pickFor, effective, parse, choices_: choices, opensIn, hostModes, looks, describe,
};
const out = new URL('./fixtures/settings-placement.json', import.meta.url);
writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n');
console.log(`wrote ${out.pathname}: ${resolve.length} resolve, ${normalize.length} normalize, ${pickFor.length} scope, ${parse.length} parse cases`);

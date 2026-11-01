/**
 * help@1 + Help mode (core/engines/help-rules.mjs): the type is registered (types, optional, late-optional, the
 * asset-types order, a collection — never rolled, never a shared appearance slot, no Appearance pick), the fixture
 * replays (auto help ids, packs, the index, intros, coverage, ratchet, errors), both validators give the same messages,
 * every help pack the repo ships validates (framework, apps, every plugin's help.json), the apps carry the framework pack
 * unchanged, the runtime switch / actions / Help menu / plugin packs work, and the coverage CLI is at the ratchet.
 * Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-help.mts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateAsset, collectionType } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { appearanceSlotTypes } from '../core/engines/appearance';
import { rollNever } from '../core/engines/roll';
import {
  HELP_MODE_KEY, HELP_SEEN_KEY, buildHelpIndex, helpCoverage, helpErrors, helpTarget, introToShow, introToWalkthrough, markSeen,
  normalizeHelpPack, ratchetErrors, resolveHelp, slugLabel, helpVoiceCommand,
} from '../core/engines/help';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/* ---- registered everywhere ---- */
ok(ASSET_TYPES.includes('help'), 'help is an asset type');
ok(OPTIONAL_TYPES.includes('help'), 'help is optional (older apps still validate)');
const spec = read('framework/schemas/asset-types.json');
eq(Object.keys(spec.types), [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
eq(Object.keys(spec.types).at(-1), 'uac-policy', 'uac-policy stays last');
ok(collectionType('help') && !collectionType('color-theme'), 'help is a collection type: every pack is in force, no Appearance pick');
ok(rollNever('help'), 'help is never rolled');
ok(!appearanceSlotTypes().includes('help'), 'help is not a shared appearance slot (nothing to pick, nothing to share)');
ok(existsSync(join(ROOT, 'framework/schemas/json/help.schema.json')), 'help.schema.json is generated');
eq(read('framework/defaults.json').help, 'framework', 'defaults.json names the framework pack');

/* ---- fixture replay ---- */
const fx = read('framework/spec/fixtures/help.json');
for (const [label, slug] of Object.entries(fx.slugs)) eq(slugLabel(label), slug, `slug of "${label}"`);
const DESC: Record<string, Parameters<typeof helpTarget>[0]> = {
  'menu-item': { action: 'app.settings', label: 'Settings', screen: 'builds' },
  'param-action': { action: 'swap:color-theme:next', label: 'Next color theme' },
  'nav-action': { action: 'nav:builds', label: 'Builds' },
  'nav-item': { view: 'plan-studio', label: 'Plan Studio', screen: 'home' },
  explicit: { help: 'approval-deny', label: 'Deny: vps.run', screen: 'home' },
  'label-only': { label: 'Refresh (2)', screen: 'builds' },
  column: { label: 'Status ▲', column: true, screen: 'builds' },
  banner: { banner: 'approvals', label: '3 waiting' },
  menu: { menu: 'file', label: 'File' },
  nothing: { label: '…' },
};
for (const [k, d] of Object.entries(DESC)) eq(helpTarget(d), fx.targets[k], `help ids: ${k}`);
// stable: counts and punctuation never move an id
eq(helpTarget({ label: 'Approve now (3)' }).id, helpTarget({ label: 'Approve now (12)' }).id, 'a count changing keeps the id');
eq(helpTarget({ label: 'Approvals 3 new' }).id, helpTarget({ label: 'Approvals' }).id, '"3 new" is a count');
eq(helpTarget({ action: 'app.settings', label: 'Settings' }).id, helpTarget({ action: 'app.settings', label: 'Preferences' }).id, 'an action names the control whatever its label says');
const packs = fx.packs as Record<string, unknown>;
const RAW = [
  { id: 'framework', data: { entries: [
    { target: 'refresh', title: 'Refresh', text: 'Reloads it.' },
    { target: 'action:app.settings', title: 'Settings', text: 'Opens Settings.' },
    { target: 'view:home', title: 'Home', text: 'The front page.' },
    { target: 'deny', title: 'Deny', text: 'Drops it.', draft: true },
  ], intros: [{ screen: 'home', title: 'Home', steps: [{ say: 'Cards up top.', target: 'view:home' }, { say: 'Banners live.', do: 'nav:home' }] }] } },
  { id: 'app', data: { entries: [
    { target: 'refresh', title: 'Refresh (app)', text: 'Reloads it from the hub.' },
    { target: 'deny', title: 'Deny', text: 'Never runs.' },
    { target: 'builds/refresh', title: 'Refresh builds', text: 'Reloads the builds.' },
    { target: 'action:app.settings', title: 'Settings (draft)', text: 'x', draft: true },
  ] } },
];
for (const p of RAW) eq(normalizeHelpPack(p.data), packs[p.id], `pack ${p.id} normalizes`);
const index = buildHelpIndex(RAW);
eq({ byTarget: Object.fromEntries([...index.byTarget].sort(([a], [b]) => a.localeCompare(b))), intros: Object.fromEntries(index.intros) }, fx.index, 'the index');
eq(resolveHelp(index, helpTarget({ label: 'Refresh', screen: 'builds' }).lookup)?.title, fx.resolve['screen-override'], 'a screen override wins on its screen');
eq(resolveHelp(index, helpTarget({ label: 'Refresh', screen: 'home' }).lookup)?.title, fx.resolve['later-pack-wins'], 'a later pack wins');
eq(resolveHelp(index, helpTarget({ action: 'app.settings', label: 'Settings' }).lookup)?.title, fx.resolve['written-beats-draft'], 'a draft never replaces written help');
eq(resolveHelp(index, ['deny'])?.text, fx.resolve['draft-replaced'], 'written help replaces a draft');
eq(resolveHelp(index, helpTarget({ action: 'refresh.all', label: 'Refresh' }).lookup)?.title, fx.resolve['falls-back-to-label'], 'an action without help falls back to its label');
eq(resolveHelp(index, helpTarget({ label: 'Frobnicate' }).lookup), fx.resolve.missing, 'missing = null');
eq(introToShow({ mode: true, seen: [], screen: 'home', index }), fx.intros['first-time'], 'intro: first time on the screen');
eq(introToShow({ mode: false, seen: [], screen: 'home', index }), fx.intros['mode-off'], 'intro: never with Help mode off');
eq(introToShow({ mode: true, seen: ['home'], screen: 'home', index }), fx.intros.seen, 'intro: once per screen');
eq(introToShow({ mode: true, intros: false, seen: [], screen: 'home', index }), fx.intros['intros-off'], 'intro: "don\'t show intros again"');
eq(introToShow({ mode: true, seen: [], screen: 'plan', index }), fx.intros['no-intro'], 'intro: none written');
eq(introToWalkthrough(index.intros.get('home')!, 'console'), fx.intros.walkthrough, 'an intro plays as walkthrough@1');
eq(markSeen(['plan', 'home'], 'plan'), fx.intros['mark-seen'], 'seen list: newest last, no doubles');
eq(helpCoverage([
  { id: 'refresh', lookup: helpTarget({ label: 'Refresh' }).lookup },
  { id: 'refresh', lookup: helpTarget({ label: 'Refresh' }).lookup },
  { id: 'action:app.settings', lookup: helpTarget({ action: 'app.settings', label: 'Settings' }).lookup },
  { id: 'frobnicate', lookup: ['frobnicate'], kind: 'button', label: 'Frobnicate' },
], index), fx.coverage, 'coverage (each id once)');
eq(ratchetErrors({ app: { percent: 80, covered: 10, written: 5 } }, { app: { percent: 80, covered: 10, written: 5 } }), fx.ratchet.ok, 'ratchet: level is fine');
eq(ratchetErrors({ app: { percent: 70.5, covered: 9, written: 4 } }, { app: { percent: 80, covered: 10, written: 5 } }), fx.ratchet.fell, 'ratchet: a drop fails');
eq(ratchetErrors({}, { app: { percent: 80, covered: 10 } }), fx.ratchet['scope-gone'], 'ratchet: a scope that vanished fails');

/* ---- both validators, same messages ---- */
const ERR: Record<string, [string, unknown]> = {
  ok: ['help', RAW[0]!.data],
  'not-an-object': ['help', 'nope'],
  'bad-entries': ['help', { entries: [{ target: 'Bad Id', title: '', text: 'x' }, { target: 'a', title: 'A', text: 'x'.repeat(601), link: 'javascript:alert(1)', related: ['ok', 'Not Ok'], kind: 'widget', draft: 'yes' }, { target: 'a', title: 'A', text: 'again' }, 7] }],
  'bad-intros': ['help', { intros: [{ screen: 'home', steps: [] }, { screen: 'home', steps: [{ say: '' }, { say: 'ok', do: 'javascript:x' }] }, { screen: 'BAD', steps: Array(7).fill({ say: 'x' }) }] }],
  'other-type': ['button', { entries: 'nope' }],
};
for (const [k, [type, data]] of Object.entries(ERR)) eq(helpErrors(type, data), fx.errors[k], `errors: ${k}`);
const env = (data: unknown) => ({ $axf: 'asset@1', type: 'help', id: 'x', name: 'X', version: '1.0.0', data });
for (const k of ['ok', 'bad-entries', 'bad-intros']) {
  const data = ERR[k]![1];
  const ts = validateAsset(env(data)).errors.filter((e) => e.startsWith('help:'));
  const js = (engine.validateAsset(env(data)) as { errors: string[] }).errors.filter((e) => e.startsWith('help:'));
  eq(ts, js, `TS and build-engine validators agree (${k})`);
  eq(ts, fx.errors[k], `validator = rules (${k})`);
}

/* ---- every help pack the repo ships ---- */
const packFiles: string[] = [];
const dirs = ['framework/assets/help', 'apps/console-web/src/assets/help', 'apps/axhub-web/src/assets/help', 'apps/amberx-droid/src/assets/help', 'apps/walkthrough-studio/src/assets/help'];
for (const d of dirs) if (existsSync(join(ROOT, d))) for (const f of readdirSync(join(ROOT, d)).filter((x) => x.endsWith('.json'))) packFiles.push(join(d, f));
for (const folder of readdirSync(join(ROOT, 'apps/console-web/plugins'))) if (existsSync(join(ROOT, 'apps/console-web/plugins', folder, 'help.json'))) packFiles.push(`apps/console-web/plugins/${folder}/help.json`);
ok(packFiles.length >= 10, `help packs found (${packFiles.length})`);
for (const f of packFiles) {
  const a = read(f);
  eq(validateAsset(a).errors, [], `${f} validates`);
  eq((engine.validateAsset(a) as { errors: string[] }).errors, [], `${f} validates (build engine)`);
}
const fw = readFileSync(join(ROOT, 'framework/assets/help/framework.json'), 'utf8');
for (const app of ['console-web', 'axhub-web', 'amberx-droid', 'walkthrough-studio']) eq(readFileSync(join(ROOT, `apps/${app}/src/assets/help/framework.json`), 'utf8'), fw, `${app} ships the framework help unchanged`);
const fwPack = read('framework/assets/help/framework.json').data;
for (const t of ['action:help.mode', 'refresh', 'save', 'delete', 'approval-deny', 'approval-approve', 'watch-live', 'view:settings']) ok(fwPack.entries.some((e: { target: string; draft?: boolean }) => e.target === t && !e.draft), `framework help has written "${t}"`);
const consolePack = read('apps/console-web/src/assets/help/console.json').data;
for (const s of ['home', 'builds', 'build-orchestrator', 'ui-review', 'ui-screenshots', 'agent-swarm', 'plan-studio']) ok(consolePack.intros.some((i: { screen: string; steps: unknown[] }) => i.screen === s && i.steps.length >= 2 && i.steps.length <= 4), `console intro for ${s} (2–4 steps)`);

/* ---- voice ---- */
eq(helpVoiceCommand('Help mode on'), 'on', 'voice: "help mode on"');
eq(helpVoiceCommand('hey amber, turn off help mode!'), 'off', 'voice: "… turn off help mode"');
eq(helpVoiceCommand('what is the weather'), null, 'voice: anything else is not for Help mode');

/* ---- the runtime ---- */
{
  const g = globalThis as Record<string, unknown>;
  const store = new Map<string, string>();
  g.localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const { AxfRuntime } = await import('../core/runtime');
  const assets = readdirSync(join(ROOT, 'framework/assets')).flatMap((t) => readdirSync(join(ROOT, 'framework/assets', t)).filter((x) => x.endsWith('.json')).map((x) => read(`framework/assets/${t}/${x}`)));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults: read('framework/defaults.json') } as never, assets, storageKey: 'test:help' });
  eq(rt.loadErrors, [], 'every framework asset (help packs included) loads');
  ok(!rt.helpMode(), 'Help mode is off by default');
  rt.dispatch('help.mode:on');
  ok(rt.helpMode() && rt.settings.get(HELP_MODE_KEY) === true, 'help.mode:on switches it on (setting axf.help.mode)');
  rt.dispatch('help.mode:toggle');
  ok(!rt.helpMode(), 'help.mode:toggle switches it off');
  rt.setHelpMode(true);
  eq(rt.helpFor({ label: 'Refresh' }).entry?.title, 'Refresh', 'the framework pack answers out of the box');
  const miss = rt.helpFor({ label: 'Frobnicate the widget' });
  ok(!miss.entry && miss.id === 'frobnicate-the-widget' && rt.missingHelp().includes('frobnicate-the-widget'), 'a control without help is recorded as missing');
  const remove = rt.addHelp('lib:test', { entries: [{ target: 'frobnicate-the-widget', title: 'Frobnicate', text: 'Frobs it.' }], intros: [{ screen: 'home', title: 'Home', steps: [{ say: 'Hi.' }, { say: 'Bye.' }] }] });
  eq(rt.helpFor({ label: 'Frobnicate the widget' }).entry?.text, 'Frobs it.', 'a run-time pack (a plugin) is in the index');
  rt.navigate('home');
  eq(rt.helpIntro()?.steps.length, 2, 'the intro shows on a first visit');
  rt.helpIntroDone('home');
  eq(rt.helpIntro(), null, 'and never again on that screen');
  ok((rt.settings.get(HELP_SEEN_KEY) as string[]).includes('home'), 'seen screens are remembered');
  rt.dispatch('help.intro');
  eq(rt.helpIntro()?.title, 'Home', '"Show this screen\'s intro" replays it');
  rt.helpIntroDone('home', true);
  rt.dispatch('help.intros.reset');
  eq(rt.helpIntro()?.title, 'Home', 'reset brings every intro back (and intros on)');
  remove();
  eq(rt.helpFor({ label: 'Frobnicate the widget' }).entry, null, 'removing the pack takes its help away');
  const help = rt.appMenu().menus.find((m) => m.id === 'help');
  const item = help?.items.find((i) => i.id === 'axf-help-mode');
  ok(item && item.action === 'help.mode:toggle' && item.shortcut === 'F1', 'every app\'s Help menu has the Help mode switch (F1)');
  rt.dispatch('help.explain:refresh');
  eq(rt.helpPanel(), 'refresh', 'help.explain opens What is this?');
  rt.setHelpMode(false);
  eq(rt.helpPanel(), null, 'switching off closes it');
}

/* ---- coverage CLI at the ratchet ---- */
const out = execFileSync(process.execPath, [join(ROOT, 'framework/cli/help-coverage.mjs'), '--check'], { encoding: 'utf8' });
ok(/at or above the ratchet/.test(out), 'help-coverage --check passes');
const ratchet = read('framework/spec/help-coverage.json').scopes;
for (const s of ['framework', 'console-web', 'axhub-web']) ok(ratchet[s] && ratchet[s].total > 0, `ratchet records ${s}`);

console.log(`✓ help@1 + Help mode — ${n} checks`);

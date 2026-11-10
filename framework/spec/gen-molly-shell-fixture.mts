/**
 * Regenerates spec/fixtures/molly-shell.json from the reference engine (core/engines/molly-shell.ts). Run after a
 * deliberate engine change, then read the diff: the fixture is what the Kotlin twin will replay.
 *   npx -y tsx framework/spec/gen-molly-shell-fixture.mts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_ITEM_KINDS, HOST_ITEM_PREFIX, INSTANCE_SEP, MOLLY_SHELL_CONTRACT, SHELL_LIMITS, VIEW_SEP, hostCatalog, hostRunOf, hostRunSpec, instanceOfView, instanceTitle, instancesOf, nextInstance, normalizeInstances, pageOfView, parseHostCatalog, parseHostRun, parseInstance, shellState, viewOn } from '../core/engines/molly-shell';
import { parseEmbedMessage } from '../core/engines/embed';

const root = new URL('../', import.meta.url).pathname;
const APPS = ['amberx', 'axhub', 'console', 'expenses'];

const parse = ['console', 'console#2', 'console#8', 'console#9', 'console#1', 'console#02', 'console#x', '#2', 'Console', 'console/nav:build', '', 7, null].map((input) => ({ input, out: parseInstance(input) }));
const ofView = [
  { view: 'console#2/nav:build' }, { view: 'console' }, { view: 'home' }, { view: 'settings' }, { view: 'home', apps: APPS }, { view: 'console#3/nav:build', apps: APPS }, { view: 'gizmo/x', apps: APPS }, { view: 42 },
].map((c) => ({ ...c, out: instanceOfView(c.view, c.apps) }));
const pages = ['console#2/nav:build', 'console', 'axhub/nav:approvals/x'].map((view) => ({ view, page: pageOfView(view), back: viewOn(instanceOfView(view)?.id ?? view, pageOfView(view)) }));
const next = [
  { open: [], app: 'console' }, { open: ['console'], app: 'console' }, { open: ['console', 'console#2'], app: 'console' }, { open: ['console', 'console#3'], app: 'console' },
  { open: ['console#2'], app: 'console' }, { open: ['console', 'console#2', 'console#3', 'console#4', 'console#5', 'console#6', 'console#7', 'console#8'], app: 'console' }, { open: ['console'], app: 'Bad App' },
].map((c) => ({ ...c, out: nextInstance(c.open, c.app), of: instancesOf(c.open, c.app) }));
const titles = [{ label: 'Console', n: 1 }, { label: 'Console', n: 2 }, { label: 'axHub', n: 5 }].map((c) => ({ ...c, out: instanceTitle(c.label, c.n) }));
const normalize = [
  { raw: ['console', 'console#2', 'amberx'] }, { raw: ['console#2'] }, { raw: ['console#2', 'console'] }, { raw: ['console', 'console', 'gizmo', 'console#x', 7, 'axhub#3'] }, { raw: 'console' }, { raw: null },
  { raw: Array.from({ length: 40 }, (_, i) => instanceId2(i)) },
].map((c) => ({ ...c, out: normalizeInstances(c.raw, APPS) }));
function instanceId2(i: number) { const app = APPS[i % APPS.length]!; const n = Math.floor(i / APPS.length) + 1; return n === 1 ? app : `${app}${INSTANCE_SEP}${n}`; }

const catalogSrc = [
  { kind: 'screen', id: 'console', label: 'Console', icon: 'terminal', keywords: ['dev console'] },
  { kind: 'screen', id: 'console#2', label: 'Console 2', icon: 'terminal' },
  { kind: 'screen', id: 'console/nav:build', label: 'Builds', detail: 'Console page' },
  { kind: 'settings', id: 'xlayout', label: 'xLayout', parent: 'plugins' },
  { kind: 'dialog', id: 'xlayout.layout', label: 'Pane layout' },
  { kind: 'action', id: 'molly.new-tab', label: 'New tab', params: true, keywords: ['tab', 'molly', 'open'] },
  { kind: 'action', id: 'molly.reload', label: 'Reload this app', personOnly: true },
  { kind: 'action', id: 'host:molly.close-tab', label: ' Close   this tab ' },
  { kind: 'screen', id: 'console', label: 'Twice' },
  { kind: 'widget', id: 'x', label: 'Not a kind' },
  { kind: 'screen', id: 'bad id!', label: 'Bad id' },
  { kind: 'screen', id: 'x'.repeat(200), label: 'Too long' },
  { kind: 'action', id: 'ok', label: 'L'.repeat(100), detail: 'D'.repeat(200), keywords: Array.from({ length: 20 }, (_, i) => `k${i}`) },
  'junk', null,
];
const catalog = { host: 'molly', src: catalogSrc, out: hostCatalog('molly', catalogSrc as never), parsed: parseHostCatalog(catalogSrc, 'molly'), notList: parseHostCatalog({ a: 1 }, 'molly') };
const big = { count: 500, out: hostCatalog('molly', Array.from({ length: 500 }, (_, i) => ({ kind: 'action', id: `a${i}` })) as never).length };

const runs = [
  { item: { kind: 'screen', id: 'host:console#2', label: 'Console 2' }, opts: {} },
  { item: { kind: 'action', id: 'host:molly.new-tab', label: 'New tab' }, opts: { spec: 'host:molly.new-tab:console', by: 'Amber' } },
  { item: { kind: 'action', id: 'host:molly.new-tab', label: 'New tab' }, opts: { spec: 'host:molly.new-tab' } },
  { item: { kind: 'action', id: 'host:molly.new-tab', label: 'New tab' }, opts: { spec: 'host:other.thing:x' } },
  { item: { kind: 'dialog', id: 'host:xlayout.layout', label: 'Pane layout' }, opts: { arg: 'ide' } },
  { item: { kind: 'settings', id: 'host:xlayout', label: 'xLayout' }, opts: { by: ' a very long name that goes on and on and on past the limit ' } },
].map((c) => { const run = hostRunOf(c.item as never, c.opts); return { ...c, run, spec: hostRunSpec(run) }; });
const parseRuns = [
  { kind: 'screen', target: 'console#2' }, { kind: 'action', target: 'host:molly.new-tab', args: ['console', 7, '', 'x'], by: 'Amber', label: 'New tab' },
  { kind: 'action', target: 'molly.new-tab', args: Array.from({ length: 12 }, (_, i) => `a${i}`) }, { kind: 'nope', target: 'x' }, { kind: 'screen' }, { kind: 'screen', target: 'bad id!' }, 'junk', [], null,
].map((raw) => ({ raw, out: parseHostRun(raw) }));

const states = [
  { view: 'console#2/nav:build', apps: APPS, instances: ['console', 'amberx'], on: ['console#2'], pages: { console: 'nav:home', 'console#2': 'nav:build' }, ide: { on: true, preset: 'two-columns', paneLimit: 4 }, connected: ['console', 'amberx', 'gizmo'] },
  { view: 'home', apps: APPS },
  { view: 'console', apps: APPS, instances: ['console'] },
  { view: 'axhub', apps: APPS, instances: ['console', 'console#2'], on: ['console', 'console#2'], ide: { on: 'yes', preset: 7, paneLimit: 999 } },
  { view: '', apps: APPS, instances: ['console#2'] },
].map((input) => ({ input, out: shellState(input as never) }));

const messages = [
  { $axf: 'embed@1', type: 'host-catalog', host: 'molly', items: catalogSrc.slice(0, 3), here: { screen: 'console#2/nav:build', screenLabel: 'Console 2' } },
  { $axf: 'embed@1', type: 'host-catalog', host: 'molly', items: [] },
  { $axf: 'embed@1', type: 'host-catalog', host: 'Bad Host', items: [] },
  { $axf: 'embed@1', type: 'host-catalog', host: 'molly', items: 'nope' },
  { $axf: 'embed@1', type: 'host-catalog', host: 'molly', items: [], here: { screen: 7 } },
  { $axf: 'embed@1', type: 'host-run', run: { kind: 'action', target: 'molly.new-tab', args: ['console'], by: 'Amber' } },
  { $axf: 'embed@1', type: 'host-run', run: { kind: 'screen', target: 'host:console#2' } },
  { $axf: 'embed@1', type: 'host-run', run: { kind: 'x', target: 'console' } },
  { $axf: 'embed@1', type: 'host-run' },
].map((input) => ({ input, message: parseEmbedMessage(input), asString: parseEmbedMessage(JSON.stringify(input)) }));

const fixture = {
  $note: 'molly-shell@1 fixture, generated by spec/gen-molly-shell-fixture.mts from core/engines/molly-shell.ts; replayed by spec/check-molly-shell.mts (and the deferred Kotlin twin).',
  contract: MOLLY_SHELL_CONTRACT, sep: INSTANCE_SEP, viewSep: VIEW_SEP, prefix: HOST_ITEM_PREFIX, kinds: HOST_ITEM_KINDS, limits: SHELL_LIMITS, apps: APPS,
  parse, ofView, pages, next, titles, normalize, catalog, big, runs, parseRuns, states, messages,
};
writeFileSync(join(root, 'spec/fixtures/molly-shell.json'), JSON.stringify(fixture, null, 1) + '\n');
console.log('wrote spec/fixtures/molly-shell.json');

/**
 * Toolbar library check (enterprise-branding s17–s18): every starter toolbar validates, keeps the design-language
 * limits, names only known actions, providers, counters-or-bindings and widget starters, and the runtime side of
 * dynamic toolbars works: provider groups load through the application menu's provider registry (capped by `max`,
 * More… past it), `checked` bindings resolve, and TOOLBARS.md is in sync with the generator seeds.
 *
 *   npx -y tsx framework/spec/check-toolbars.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateAsset } from '../core/validate';
import { AxfRuntime } from '../core/runtime';
import { STANDARD_ACTIONS } from '../core/engines/actions';
import { CHECKED_KINDS } from '../core/engines/appmenu';

const root = new URL('../', import.meta.url).pathname;
let n = 0; const failures: string[] = [];
const ok = (c: unknown, what: string) => { if (c) n += 1; else failures.push(what); };

const read = (t: string) => existsSync(join(root, 'assets', t)) ? readdirSync(join(root, 'assets', t)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))) : [];
const toolbars = read('toolbar');
const known = new Set<string>();
const BUILTIN_PROVIDERS = ['views', 'nav', 'toolbar', 'settings', 'windows', 'dialogs', 'chrome'];
// action prefixes the runtime registers with params (plus standard ids); a toolbar item must use one of them
const PARAM_PREFIXES = ['swap', 'nav', 'dialog', 'spacing', 'slot.hide', 'design.package', 'settings.open', 'assets.random', 'assets.reset', 'alerts.open', 'windows.restore', 'toast', 'role'];

{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const probe = new AxfRuntime({ manifest: { app: { id: 'probe', name: 'Probe' }, defaults } as never, assets, storageKey: 'test:probe' });
  for (const { id } of probe.actions.list()) known.add(id);
}
ok(toolbars.length >= 25, `≥ 25 starter toolbars (${toolbars.length})`);
for (const a of toolbars) {
  const v = validateAsset(a);
  ok(v.ok, `${a.id}: validates (${v.errors?.join('; ')})`);
  const groups = a.data.groups as { id: string; items: { id: string; action: string; icon: string; badge?: string; checked?: string }[]; provider?: string; max?: number }[];
  const fixed = groups.reduce((s, g) => s + g.items.length, 0);
  ok(fixed <= 12, `${a.id}: ≤ 12 fixed items (${fixed})`);
  ok(new Set(groups.map((g) => g.id)).size === groups.length, `${a.id}: unique group ids`);
  for (const g of groups) {
    ok(new Set(g.items.map((i) => i.id)).size === g.items.length, `${a.id}/${g.id}: unique item ids`);
    if (g.provider !== undefined) {
      ok(typeof g.provider === 'string' && /^[a-z][a-z0-9.-]*$/.test(g.provider), `${a.id}/${g.id}: provider id`);
      ok(BUILTIN_PROVIDERS.includes(g.provider), `${a.id}/${g.id}: starter toolbars use built-in providers only (${g.provider})`);
      ok(g.max === undefined || (Number.isInteger(g.max) && g.max >= 1 && g.max <= 24), `${a.id}/${g.id}: max 1–24`);
    }
    for (const it of g.items) {
      const head = it.action.split(':')[0];
      ok(it.action in STANDARD_ACTIONS || known.has(it.action) || known.has(head) || PARAM_PREFIXES.includes(head), `${a.id}/${it.id}: known action (${it.action})`);
      if (it.checked) ok(CHECKED_KINDS.includes(it.checked.split(':')[0]), `${a.id}/${it.id}: checked binding kind (${it.checked})`);
    }
  }
  for (const w of (a.data.widgets ?? []) as { type: string; id: string }[]) ok(existsSync(join(root, 'assets', w.type, `${w.id}.json`)), `${a.id}: widget ${w.type}/${w.id} ships`);
}

// runtime: provider groups + toggles
{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, hidden: ['toolbar'] } as never, assets, storageKey: 'test:toolbars' });
  const chrome = await rt.loadToolbarProvider('chrome', 8);
  ok(chrome.length > 0 && chrome.every((i) => i.action?.startsWith('slot.hide:') && i.checked), 'chrome provider → toggle buttons with checked bindings');
  ok(rt.toolbarChecked('slot:toolbar') === false, 'slot:toolbar is off while the toolbar is hidden');
  rt.dispatch('slot.hide:toolbar:toggle');
  ok(rt.toolbarChecked('slot:toolbar') === true, 'toggling shows it: slot:toolbar on');
  ok(rt.toolbarChecked('hidden:toolbar') === false, 'hidden:toolbar mirrors it');
  ok(rt.toolbarChecked(undefined) === null, 'no binding → null (not a toggle)');
  rt.registerAppMenuProvider('test.many', { items: () => Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, label: `Item ${i}`, icon: 'star', action: `nav:x${i}` })), moreAction: 'nav:all', module: 'test' });
  const capped = await rt.loadToolbarProvider('test.many', 5);
  ok(capped.length === 6 && capped[5].id === 'test.many.more' && capped[5].action === 'nav:all', 'max caps the group, then the provider\'s More… entry');
  ok((await rt.loadToolbarProvider('test.many', 999)).length === 25, 'max clamps to 24 (+ More…)');
  ok((await rt.loadToolbarProvider('missing', 8)).length === 0, 'an unregistered provider gives no buttons');
  rt.setBadge('alerts.unread', 3);
  ok(rt.toolbarChecked('counter:alerts.unread') === true, 'counter: binding on above zero');
  rt.dispatch('swap:toolbar:live-pages');
  ok(rt.state.active.toolbar === 'live-pages', 'a library toolbar swaps in');
}

// docs in sync with the seeds
try { execFileSync('node', [join(root, 'cli', 'asset-library.mjs'), '--check'], { stdio: 'pipe' }); ok(true, 'asset library + TOOLBARS.md in sync'); }
catch (e) { ok(false, `asset library drift: ${String((e as { stdout?: Buffer }).stdout ?? e)}`); }

if (failures.length) { for (const f of failures) console.error(`✗ ${f}`); console.error(`check-toolbars: ${failures.length} of ${n + failures.length} checks failed`); process.exit(1); }
console.log(`check-toolbars: ${n} checks passed`);

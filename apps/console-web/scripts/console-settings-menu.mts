/**
 * Console settings leads every console context menu (CI: `npx -y tsx apps/console-web/scripts/console-settings-menu.mts`,
 * after the console build so src/axf is the fresh bake). Checks, on the console's own assets and runtime:
 *   - the lead is registered and every context-menu target of the console's asset (Amber) starts with
 *     Console settings, then one separator, then the target's own items, with Amber's own Settings folded in (not twice);
 *   - picking it opens Settings; `console.settings.open` (search, voice, MCP and CLI through console.actions) does too;
 *   - the console ships help for it; removing the lead leaves the asset's menus as they were.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AxfRuntime } from '../src/axf/core/runtime';
import { CONTEXT_LEAD_PREFIX, CONTEXT_LEAD_SEPARATOR_ID, withContextLead, type MenuEntry } from '../src/axf/core/engines/windows';
import { CONSOLE_SETTINGS_ACTION, CONSOLE_SETTINGS_ENTRY, CONSOLE_SETTINGS_HELP, CONSOLE_SETTINGS_LEAD, installConsoleSettingsMenu } from '../src/consoleSettingsMenu';

const app = new URL('../', import.meta.url).pathname;
const readJson = (p: string) => JSON.parse(readFileSync(join(app, p), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };

const manifest = readJson('axf.manifest.json');
const { appAssetsOfType } = await import(new URL('../../../framework/cli/shared-assets.mjs', import.meta.url).href);
const active: string = manifest.defaults['context-menu'];
const ctxAsset = (appAssetsOfType(app, 'context-menu') as { id: string; data: { targets: Record<string, MenuEntry[]> } }[]).find((a) => a.id === active);
ok(ctxAsset, `the console's context-menu asset (${active}) is found`);

// the baked shared assets, enough for every slot the runtime needs
const baked = join(app, 'src/axf/assets');
const assets = readdirSync(baked).flatMap((t) => readdirSync(join(baked, t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(baked, t, n), 'utf8'))));
const rt = new AxfRuntime({ manifest: { app: { id: 'console-test', name: 'Console test' }, defaults: manifest.defaults, startView: 'home' } as never, assets, storageKey: 'test:console-settings-menu' });
let settingsOpened = 0;
rt.actions.register('app.settings', () => { settingsOpened++; }, { label: 'Settings' });
const undo = installConsoleSettingsMenu(rt);
installConsoleSettingsMenu(rt); // idempotent: a library re-install doesn't add a second entry
const leads = [...rt.contextExtras.entries()].filter(([k]) => k.startsWith(CONTEXT_LEAD_PREFIX));
ok(leads.length === 1 && leads[0]![0] === CONSOLE_SETTINGS_LEAD, 'one lead registered');
const lead = leads[0]![1]('default');
ok(lead.length === 1 && lead[0]!.label === 'Console settings' && lead[0]!.action === 'app.settings', 'the lead is Console settings, opening Settings');

for (const [target, items] of Object.entries(ctxAsset!.data.targets)) {
  const menu = withContextLead(leads[0]![1](target), items);
  ok(menu[0]?.label === 'Console settings', `${target}: Console settings first`);
  if (items.some((i) => !i.separator && i.action !== 'app.settings')) ok(menu[1]?.id === CONTEXT_LEAD_SEPARATOR_ID, `${target}: then one separator`);
  ok(menu.filter((i) => i.action === 'app.settings').length === 1, `${target}: Settings shows once`);
  ok(!menu.at(-1)?.separator && !menu.some((x, i) => x.separator && menu[i + 1]?.separator), `${target}: no trailing or doubled separator`);
}

ok(rt.dispatch(CONSOLE_SETTINGS_ENTRY.action!) && settingsOpened === 1, 'picking Console settings opens Settings');
ok(rt.dispatch(CONSOLE_SETTINGS_ACTION) && settingsOpened === 2, `${CONSOLE_SETTINGS_ACTION} opens Settings (search, voice, MCP, CLI)`);
ok(rt.actions.list().some((a) => a.id === CONSOLE_SETTINGS_ACTION && a.meta.label === 'Console settings' && a.meta.searchable !== false), 'the action is named Console settings and is searchable');

const helpTargets = (CONSOLE_SETTINGS_HELP.entries ?? []).map((e) => (e as { target: string }).target);
ok(helpTargets.includes('console-settings') && helpTargets.includes(`action:${CONSOLE_SETTINGS_ACTION}`), 'help ships for the entry and its action');

undo();
ok(![...rt.contextExtras.keys()].some((k) => k.startsWith(CONTEXT_LEAD_PREFIX)), 'undo removes the lead');
const plain = ctxAsset!.data.targets.default ?? [];
ok(JSON.stringify(withContextLead([], plain)) === JSON.stringify(plain), 'without the lead the menu is the asset\'s own');

console.log(`console-settings-menu: ${checks} checks passed (asset ${ctxAsset!.id})`);

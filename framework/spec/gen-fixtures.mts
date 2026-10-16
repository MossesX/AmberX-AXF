/**
 * Generates port-conformance fixtures from the reference (TypeScript) engines.
 * Every port's test suite loads the same framework/assets and must reproduce these outputs exactly.
 *   npx -y tsx framework/spec/gen-fixtures.mts
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { colorThemeVars, styleThemeVars } from '../core/engines/theme';
import { compileLayout, layoutVars } from '../core/engines/layout';
import { buttonStyle, containerStyle, contextMenuStyle, dialogStyle, popupStyle, sliderStyle } from '../core/engines/components';
import { filterMenu, gateFor, hasPermission, resolvePermissions } from '../core/engines/uac';
import { ActionBus } from '../core/engines/actions';
import { validateAsset } from '../core/validate';

const root = new URL('..', import.meta.url).pathname;
const assetsDir = join(root, 'assets');
const out = join(root, 'spec/fixtures');
mkdirSync(out, { recursive: true });
const load = (type: string) => readdirSync(join(assetsDir, type)).map((f) => JSON.parse(readFileSync(join(assetsDir, type, f), 'utf8')));
const write = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');

write('theme.json', Object.fromEntries([
  ...load('color-theme').map((a) => [`color-theme:${a.id}`, colorThemeVars(a.data)]),
  ...load('style-theme').map((a) => [`style-theme:${a.id}`, styleThemeVars(a.data)]),
]));
write('layout.json', Object.fromEntries(load('layout').map((a) => [a.id, { compiled: compileLayout(a.data), vars: layoutVars(a.data) }])));
write('components.json', {
  button: Object.fromEntries(load('button').map((a) => [a.id, buttonStyle(a.data)])),
  slider: Object.fromEntries(load('slider').map((a) => [a.id, sliderStyle(a.data)])),
  container: Object.fromEntries(load('container').map((a) => [a.id, containerStyle(a.data)])),
  dialog: Object.fromEntries(load('dialog').map((a) => [a.id, dialogStyle(a.data)])),
  popup: Object.fromEntries(load('popup').map((a) => [a.id, popupStyle(a.data)])),
  'context-menu': Object.fromEntries(load('context-menu').map((a) => [a.id, contextMenuStyle(a.data)])),
});
write('uac.json', Object.fromEntries(load('uac-policy').map((p) => [p.id, {
  roles: Object.fromEntries(p.data.roles.map((r: { id: string }) => [r.id, [...resolvePermissions(p.data, r.id)].sort()])),
  checks: ['files.write', 'dev.deploy', 'assets.swap', 'uac.manage', 'anything.else'].map((perm) => ({ perm, byRole: Object.fromEntries(p.data.roles.map((r: { id: string }) => [r.id, hasPermission(resolvePermissions(p.data, r.id), perm)])) })),
  gate: Object.fromEntries(p.data.roles.map((r: { id: string }) => [r.id, gateFor(p.data, resolvePermissions(p.data, r.id), 'dev.deploy')])),
}])));
const menus = load('app-menu');
const standard = load('uac-policy').find((p) => p.id === 'standard').data;
write('menu-filter.json', Object.fromEntries(menus.map((m) => [m.id, Object.fromEntries(standard.roles.map((r: { id: string }) => {
  const granted = resolvePermissions(standard, r.id);
  return [r.id, m.data.menus.map((menu: { id: string; items: unknown[] }) => ({ id: menu.id, items: filterMenu(menu.items as never, (req) => gateFor(standard, granted, req)).map((i: { id: string }) => i.id) }))];
}))])));
write('actions.json', ['file.save', 'swap:color-theme:next', 'nav:home', 'dialog:import-asset', 'toast:success:Saved:ok', 'asset.json:{payload}', ''].map((spec) => ({ spec, parsed: ActionBus.parse(spec) })));
write('validation.json', [
  { case: 'missing-data', raw: { $axf: 'asset@1', type: 'button', id: 'x', name: 'X', version: '1' } },
  { case: 'bad-id', raw: { $axf: 'asset@1', type: 'button', id: 'Bad_Id', name: 'X', version: '1', data: {} } },
  { case: 'unknown-type', raw: { $axf: 'asset@1', type: 'nope', id: 'x', name: 'X', version: '1', data: {} } },
  { case: 'bad-enum', raw: { $axf: 'asset@1', type: 'button', id: 'x', name: 'X', version: '1', data: { shape: 'blob', fill: 'solid', weight: 600, uppercase: false, size: 'md', elevation: false } } },
  { case: 'uac-default-role', raw: { $axf: 'asset@1', type: 'uac-policy', id: 'x', name: 'X', version: '1', data: { defaultRole: 'ghost', gating: 'hide', roles: [{ id: 'a', label: 'A', permissions: [] }], permissions: {} } } },
].map((c) => ({ ...c, result: validateAsset(c.raw) })));
console.log('fixtures written to', out);

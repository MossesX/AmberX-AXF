/**
 * Generates port-conformance fixtures from the reference (TypeScript) engines.
 * Every port's test suite loads the same framework/assets and must reproduce these outputs exactly.
 *   npx -y tsx framework/spec/gen-fixtures.mts
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { colorThemeVars, styleThemeVars } from '../core/engines/theme';
import { compileLayout, layoutVars } from '../core/engines/layout';
import { appMenuStyle, buttonStyle, containerStyle, contextMenuStyle, dialogStyle, navMenuStyle, popupStyle, sliderStyle, toolbarStyle } from '../core/engines/components';
import { filterMenu, gateFor, hasPermission, resolvePermissions } from '../core/engines/uac';
import { ActionBus } from '../core/engines/actions';
import { validateAsset } from '../core/validate';
import { DEFAULT_PROJECT_RULES, validateProjectManifest } from '../core/project';

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
// Slot contract cases: a region that refuses its chrome drops out of the grid on every port.
const base = load('layout').find((a) => a.id === 'studio-dock')?.data ?? load('layout')[0].data;
write('layout-slots.json', Object.fromEntries(Object.entries({
  'no-menubar': { menubar: [] },
  'no-nav': { nav: [] },
  'no-toolbar': { toolbar: ['nav-menu'] },
  'overlay-dialog-only': { overlay: ['dialog'] },
}).map(([k, slots]) => { const data = { ...base, slots }; return [k, { slots, compiled: compileLayout(data) }]; })));
write('components.json', {
  button: Object.fromEntries(load('button').map((a) => [a.id, buttonStyle(a.data)])),
  slider: Object.fromEntries(load('slider').map((a) => [a.id, sliderStyle(a.data)])),
  container: Object.fromEntries(load('container').map((a) => [a.id, containerStyle(a.data)])),
  dialog: Object.fromEntries(load('dialog').map((a) => [a.id, dialogStyle(a.data)])),
  popup: Object.fromEntries(load('popup').map((a) => [a.id, popupStyle(a.data)])),
  'context-menu': Object.fromEntries(load('context-menu').map((a) => [a.id, contextMenuStyle(a.data)])),
  toolbar: Object.fromEntries(load('toolbar').map((a) => [a.id, toolbarStyle(a.data)])),
  'nav-menu': Object.fromEntries(load('nav-menu').map((a) => [a.id, navMenuStyle(a.data)])),
  'app-menu': Object.fromEntries(load('app-menu').map((a) => [a.id, appMenuStyle(a.data)])),
  // style fields set explicitly (the starter assets mostly use defaults)
  'chrome-cases': {
    'toolbar-compact-glass': toolbarStyle({ variant: 'labels', align: 'start', groups: [], showSearch: false, density: 'compact', surface: 'glass', divider: false }),
    'toolbar-roomy-raised': toolbarStyle({ variant: 'icons', align: 'center', groups: [], showSearch: true, density: 'roomy', surface: 'raised' }),
    'nav-compact-fill': navMenuStyle({ style: 'pills', sections: [], density: 'compact', indicator: 'fill', showIcons: false }),
    'nav-roomy-none': navMenuStyle({ style: 'list', sections: [], density: 'roomy', indicator: 'none' }),
    'menu-compact-glass': appMenuStyle({ menus: [], density: 'compact', surface: 'glass' }),
    'menu-roomy-raised': appMenuStyle({ menus: [], density: 'roomy', surface: 'raised' }),
  },
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
  { case: 'slots-not-object', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: ['nav'] } } },
  { case: 'slots-bad-region', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: { sidebar: ['nav-menu'] } } } },
  { case: 'slots-bad-type', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: { toolbar: ['toolbar', 'ribbon'] } } } },
  { case: 'slots-ok', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: { menubar: ['app-menu', 'toolbar'], nav: [] } } } },
  { case: 'chrome-bad-enum', raw: { $axf: 'asset@1', type: 'toolbar', id: 'x', name: 'X', version: '1', data: { variant: 'icons', align: 'start', groups: [], showSearch: false, density: 'huge' } } },
].map((c) => ({ ...c, result: validateAsset(c.raw) })));
console.log('fixtures written to', out);

// Project manifests (project-manifest@1): every port's validator must report the same rule ids, in order.
// `existing` = the project-relative paths that exist, so pathsExist rules run identically everywhere.
const okManifest = {
  $manifest: 'project-manifest@1', name: 'axf-demo', displayName: 'AXF Demo', kind: 'app', status: 'active', version: '0.1.0',
  platforms: ['web'], framework: { relation: 'built-on', appManifest: 'axf.manifest.json' },
  repo: { host: 'github', owner: 'MossesX', name: 'axf-demo', exists: false, visibility: 'private' },
  location: { repo: 'MossesX/AmberX-AXF', path: 'apps/demo' }, data: { shared: ['state/', 'notes.json'] }, created: '2026-10-18',
};
const projectCases: Record<string, { manifest: unknown; existing?: string[] }> = {
  valid: { manifest: okManifest, existing: ['axf.manifest.json', 'state', 'notes.json'] },
  'valid-no-file-access': { manifest: okManifest },
  'not-an-object': { manifest: ['x'] },
  'empty-object': { manifest: {} },
  'bad-name': { manifest: { ...okManifest, name: 'Bad_Name' } },
  'reserved-name': { manifest: { ...okManifest, name: 'shared' } },
  'no-repo': { manifest: { ...okManifest, repo: undefined } },
  'repo-without-exists': { manifest: { ...okManifest, repo: { owner: 'MossesX', name: 'axf-demo' } } },
  'future-repo-no-location': { manifest: { ...okManifest, location: undefined } },
  'bad-vocab': { manifest: { ...okManifest, kind: 'website', status: 'paused', platforms: ['web', 'tv'], repo: { ...okManifest.repo, host: 'svn', visibility: 'secret' } } },
  'unsafe-data-paths': { manifest: { ...okManifest, data: { shared: ['/etc/passwd', '../up', 'ok.json', 'a\\b'] } }, existing: ['ok.json', 'axf.manifest.json'] },
  'missing-data-files': { manifest: okManifest, existing: [] },
  'warnings-only': { manifest: { ...okManifest, version: 'v1', created: 'yesterday', repo: { ...okManifest.repo, url: 'http://x' }, extra: 1 }, existing: ['axf.manifest.json', 'state', 'notes.json'] },
  'display-name-too-long': { manifest: { ...okManifest, displayName: 'x'.repeat(81) } },
};
write('project-manifest.json', Object.fromEntries(Object.entries(projectCases).map(([k, c]) => {
  const raw = JSON.parse(JSON.stringify(c.manifest ?? null));
  const v = validateProjectManifest(raw, DEFAULT_PROJECT_RULES, c.existing ? { exists: (p) => c.existing!.includes(p) } : {});
  return [k, { manifest: raw, ...(c.existing ? { existing: c.existing } : {}), ok: v.ok, errors: v.errors.map((e) => e.rule), warnings: v.warnings.map((w) => w.rule) }];
})));

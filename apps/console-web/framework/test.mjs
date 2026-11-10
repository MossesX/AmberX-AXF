#!/usr/bin/env node
/**
 * inline-edit-tokens@1 / inline-override@1 checks (build inline-element-editing-plugin-right-click-any-el):
 * element paths from the markup the framework renders, the resolver's layers, the overrides store (get / set / unset /
 * list, one reset touches one record, the 4 KB rule), the migration, and the right-click capture layer.
 *   node apps/console-web/framework/test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as em from './tokens/element-map.mjs';
import * as rs from './tokens/resolve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, '../../../framework/schemas/customize.json'), 'utf8'));

/* ---------------- a tiny DOM: enough for ElementLike ---------------- */
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    className: attrs.class ?? '',
    classList: { contains: (c) => (attrs.class ?? '').split(/\s+/).includes(c) },
    getAttribute: (n) => (n in node.attrs ? String(node.attrs[n]) : null),
    parentElement: null,
    children,
  };
  for (const c of children) c.parentElement = node;
  return node;
}
const find = (node, pred) => (pred(node) ? node : node.children.map((c) => find(c, pred)).find(Boolean) ?? null);
const byAttr = (node, a, v) => find(node, (n) => n.getAttribute(a) === v);
const byClass = (node, c) => find(node, (n) => n.classList.contains(c));

/** The console's chrome as the framework renders it (AppMenu, NavTree, Chrome, Banner, TabGroup). */
function shell() {
  const menubar = el('div', { class: 'fx-menubar', role: 'menubar', 'data-fx-ctx-target': 'app-menu', 'data-fx-ctx-payload': 'app' }, [
    el('div', { class: 'fx-menubar__item' }, [
      el('button', { class: 'fx-menubar__btn', 'data-axf-menu-btn': 'assets' }, [el('span', { class: 'fx-menubar__label' })]),
      el('div', { class: 'fx-dropdown fx-popover', 'data-axf-menu': 'assets' }, [
        el('ul', { class: 'fx-menu', 'data-axf-menu-depth': '1' }, [
          el('li', { class: 'fx-menu__li', 'data-axf-item': 'import' }, [
            el('button', { class: 'fx-menu__item', 'data-axf-menu-item': 'import' }, [
              el('span', { class: 'fx-menu__icon' }, [el('svg', { class: 'fx-icon' })]),
              el('span', { class: 'fx-menu__label' }),
            ]),
          ]),
          el('li', { class: 'fx-menu__sep', role: 'separator', 'data-axf-item': 's1' }),
          el('li', { class: 'fx-menu__li is-open', 'data-axf-item': 'cycle' }, [
            el('button', { class: 'fx-menu__item', 'data-axf-menu-item': 'cycle' }, [el('span', { class: 'fx-menu__label' })]),
            el('div', { class: 'fx-menu__sub fx-popover' }, [
              el('ul', { class: 'fx-menu', 'data-axf-menu-depth': '2' }, [
                el('li', { class: 'fx-menu__li', 'data-axf-item': 'next-color' }, [
                  el('button', { class: 'fx-menu__item', 'data-axf-menu-item': 'next-color' }, [el('span', { class: 'fx-menu__label' }, [el('b', {})])]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
  const nav = el('nav', { class: 'fx-nav fx-nav--list', 'data-axf-nav': 'app', 'data-fx-ctx-target': 'nav' }, [
    el('div', { class: 'fx-nav__section', 'data-axf-nav-section': 'system' }, [
      el('div', { class: 'fx-nav__label' }),
      el('div', { class: 'fx-nav__group', 'data-axf-nav-item': 'settings' }, [
        el('button', { class: 'fx-nav__item fx-nav__item--parent', 'data-axf-nav-item': 'settings', 'data-fx-ctx-payload': 'settings' }, [
          el('svg', { class: 'fx-icon' }), el('span', { class: 'fx-nav__text' }), el('span', { class: 'fx-nav__badge' }), el('span', { class: 'fx-nav__chev' }),
        ]),
        el('div', { class: 'fx-nav__sub' }, [el('div', { class: 'fx-nav__sub-inner' }, [
          el('button', { class: 'fx-nav__item', 'data-axf-nav-item': 'plugins' }, [el('span', { class: 'fx-nav__text' })]),
        ])]),
      ]),
    ]),
  ]);
  const toolbar = el('div', { class: 'fx-toolbar fx-toolbar--icons', role: 'toolbar', 'data-axf-toolbar': 'app' }, [
    el('span', { class: 'fx-toolbar__widgets is-start' }, [el('span', { class: 'fx-toolbar__widget', 'data-axf-toolbar-widget': 'status/shipped' }, [el('span', { class: 'fx-widget-status' }, [el('span', { class: 'fx-widget-status__dot' })])])]),
    el('div', { class: 'fx-toolbar__group', role: 'group', 'data-axf-toolbar-group': 'edit' }, [
      el('button', { class: 'fx-toolbtn', 'data-axf-toolbtn': 'undo', 'data-axf-action': 'edit.undo' }, [el('svg', { class: 'fx-icon' }), el('span', { class: 'fx-toolbtn__badge' })]),
    ]),
  ]);
  const banner = el('div', { class: 'fx-banner is-flat', role: 'banner', 'data-fx-ctx-target': 'banner' }, [
    el('div', { class: 'fx-banner__side is-right' }, [
      el('span', { class: 'fx-banner__item', 'data-axf-banner-item': 'clock/digital-12h' }, [el('span', { class: 'fx-banner__clock' })]),
    ]),
  ]);
  const tabs = el('div', { class: 'fx-tabs', role: 'tablist', 'data-axf-tab-group': 'settings' }, [el('button', { class: 'fx-tab is-active', 'data-axf-tab': 'appearance' })]);
  const view = el('div', { class: 'fx-main__inner', 'data-axf-view': 'home' }, [
    el('div', { class: 'axp-hub__card', 'data-axf-el': 'card:approvals' }, [el('span', { class: 'axp-hub__title', 'data-axf-el': 'title' })]),
    el('div', { class: 'axp-hub__plain' }),
  ]);
  const toolbarInDialog = el('div', { class: 'fx-dialog', 'data-axf-dialog': 'axf.chrome.settings' }, [
    el('div', { class: 'fx-toolbar', role: 'toolbar', 'data-axf-toolbar-asset': 'settings-page' }, [el('div', { class: 'fx-toolbar__group', 'data-axf-toolbar-group': 'levels' })]),
  ]);
  return el('div', { class: 'fx-shell' }, [menubar, nav, toolbar, banner, tabs, view, toolbarInDialog]);
}

test('element paths: app menu down to the child, nav, toolbar, banner, tabs, views, nested roots', () => {
  const s = shell();
  const p = (n) => em.pathOf(n);
  assert.equal(p(byClass(s, 'fx-menubar')), 'app-menu:app');
  assert.equal(p(byAttr(s, 'data-axf-menu-btn', 'assets')), 'app-menu:app/menu:assets');
  assert.equal(p(byAttr(s, 'data-axf-menu', 'assets')), 'app-menu:app/menu:assets/panel');
  assert.equal(p(byAttr(s, 'data-axf-item', 'import')), 'app-menu:app/menu:assets/panel/item:import');
  assert.equal(p(byAttr(s, 'data-axf-menu-item', 'import')), 'app-menu:app/menu:assets/panel/item:import', 'li and its button: one path');
  assert.equal(p(byAttr(s, 'data-axf-item', 's1')), 'app-menu:app/menu:assets/panel/item:s1');
  const label = byAttr(s, 'data-axf-menu-item', 'import').children[1];
  assert.equal(p(label), 'app-menu:app/menu:assets/panel/item:import/label');
  assert.equal(p(byClass(s, 'fx-icon')), 'app-menu:app/menu:assets/panel/item:import/icon', 'the svg inside the icon span is the icon');
  assert.equal(p(byAttr(s, 'data-axf-menu-item', 'next-color')), 'app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color', 'sub menu down to the child');
  const deep = find(s, (n) => n.tagName === 'B');
  const a = em.addressOf(deep);
  assert.equal(a.path, 'app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color/label');
  assert.equal(a.own, false, 'an unaddressed child answers its nearest address');
  assert.equal(a.role, 'text');
  assert.equal(em.addressOf(byAttr(s, 'data-axf-menu-item', 'import')).element, byAttr(s, 'data-axf-item', 'import'), 'the li owns the item path');

  assert.equal(p(byAttr(s, 'data-axf-nav', 'app')), 'nav-menu:app');
  assert.equal(p(byAttr(s, 'data-axf-nav-section', 'system')), 'nav-menu:app/section:system');
  assert.equal(p(byClass(s, 'fx-nav__label')), 'nav-menu:app/section:system/label');
  assert.equal(p(byClass(s, 'fx-nav__item--parent')), 'nav-menu:app/section:system/item:settings');
  assert.equal(p(byClass(s, 'fx-nav__badge')), 'nav-menu:app/section:system/item:settings/badge');
  assert.equal(p(byClass(s, 'fx-nav__chev')), 'nav-menu:app/section:system/item:settings/chevron');
  assert.equal(p(byAttr(s, 'data-axf-nav-item', 'plugins')), 'nav-menu:app/section:system/item:settings/item:plugins', 'nav sub item under its parent');

  assert.equal(p(byAttr(s, 'data-axf-toolbar', 'app')), 'toolbar:app');
  assert.equal(p(byAttr(s, 'data-axf-toolbtn', 'undo')), 'toolbar:app/group:edit/item:undo');
  assert.equal(p(byClass(s, 'fx-toolbtn__badge')), 'toolbar:app/group:edit/item:undo/badge');
  assert.equal(p(byClass(s, 'fx-widget-status__dot')), 'toolbar:app/widgets:start/widget:status%2Fshipped/body:status/dot', 'a widget key with a slash is encoded');
  assert.equal(p(byClass(s, 'fx-banner__clock')), 'banner:app/side:right/widget:clock%2Fdigital-12h/clock');
  assert.equal(p(byAttr(s, 'data-axf-tab', 'appearance')), 'tab-group:settings/tab:appearance');
  assert.equal(p(byAttr(s, 'data-axf-el', 'title')), 'view:home/card:approvals/title', 'a plugin opts in with data-axf-el');
  assert.equal(em.addressOf(byClass(s, 'axp-hub__plain')).own, false, 'an unmarked plugin element has no path of its own');
  assert.equal(p(byAttr(s, 'data-axf-toolbar-group', 'levels')), 'dialog:axf.chrome.settings/toolbar:settings-page/group:levels', 'a toolbar inside a dialog nests under it');
  assert.equal(em.pathOf(el('div', {})), null, 'outside every root: no path');
});

test('path text: parse, chain, parent, within, role, ids', () => {
  const path = 'app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color/label';
  assert.deepEqual(em.chainOf(path), ['app-menu:app', 'app-menu:app/menu:assets', 'app-menu:app/menu:assets/panel', 'app-menu:app/menu:assets/panel/item:cycle', 'app-menu:app/menu:assets/panel/item:cycle/submenu', 'app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color', path]);
  assert.equal(em.parentOf(path), 'app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color');
  assert.equal(em.parentOf('toolbar:app'), null);
  assert.equal(em.rootTextOf(path), 'app-menu:app');
  assert.ok(em.isWithin(path, 'app-menu:app/menu:assets'));
  assert.ok(!em.isWithin('app-menu:app/menu:assets2', 'app-menu:app/menu:assets'), 'a prefix is not an ancestor');
  assert.equal(em.roleOfPath('toolbar:app'), 'root');
  assert.equal(em.roleOfPath('toolbar:app/group:edit'), 'group');
  assert.equal(em.roleOfPath('toolbar:app/group:edit/item:undo'), 'item');
  assert.equal(em.roleOfPath('toolbar:app/group:edit/item:undo/icon'), 'icon');
  assert.equal(em.roleOfPath(path), 'text');
  assert.equal(em.roleOfPath('app-menu:app/menu:assets/panel/item:s1/separator'), 'separator');
  assert.equal(em.parsePath('toolbar'), null, 'a root needs an instance');
  assert.equal(em.parsePath('toolbar:app/Group:x'), null, 'segment names are lower case');
  assert.equal(em.parsePath('toolbar:app//x'), null);
  assert.equal(em.decodeId(em.encodeId('status/shipped')), 'status/shipped');
  assert.equal(em.encodeId('a:b c%'), 'a%3Ab%20c%25');
  assert.equal(em.typeOfKind('nav-menu'), 'nav-menu');
  assert.equal(em.typeOfKind('view'), 'container');
});

test('resolver: every settable token per role, with its value and where it comes from', () => {
  const all = spec.tokens.map((t) => t.key);
  const root = rs.tokensForRole(spec, 'toolbar', 'root').map((t) => t.key);
  assert.deepEqual(root, all.filter((k) => { const t = spec.tokens.find((x) => x.key === k); return !t.types || t.types.includes('toolbar'); }), 'a root gets every token of its type');
  const item = rs.tokensForRole(spec, 'toolbar', 'item').map((t) => t.key);
  assert.ok(item.includes('textColor') && item.includes('background') && item.includes('borderColor') && item.includes('fontFamily') && item.includes('itemPadding') && item.includes('hover'));
  assert.ok(!item.includes('location') && !item.includes('width'));
  const text = rs.tokensForRole(spec, 'toolbar', 'text').map((t) => t.key);
  assert.ok(text.includes('textColor') && text.includes('fontSize') && !text.includes('iconSet') && !text.includes('padding'));
  const icon = rs.tokensForRole(spec, 'toolbar', 'icon').map((t) => t.key);
  assert.ok(icon.includes('iconColor') && icon.includes('iconSize') && !icon.includes('fontSize'));
  assert.deepEqual(rs.tokensForRole(spec, 'toolbar', 'separator').map((t) => t.key), ['borderColor', 'opacity', 'padding', 'borderWidth', 'shadow'], 'in schema order');
  assert.ok(!rs.tokensForRole(spec, 'container', 'root').some((t) => t.key === 'location'), 'a token with `types` stays with those types');

  const overrides = [
    { id: 'a', path: 'toolbar:app', scope: 'parent', token: 'textColor', value: 'accent', axHubValue: 'theme', by: 'brett', at: '2026-11-10T16:00:00Z' },
    { id: 'b', path: 'toolbar:app/group:edit/item:undo', scope: 'item', token: 'textColor', value: 'danger', axHubValue: 'accent', by: 'brett', at: '2026-11-10T16:01:00Z' },
    { id: 'c', path: 'toolbar:app/group:edit', scope: 'parent', token: 'fontSize', value: 120, axHubValue: 100, by: 'claude', at: '2026-11-10T16:02:00Z' },
    { id: 'd', path: 'toolbar:app', scope: 'parent', token: 'radius', value: 'pill', asset: 'touch-dock', axHubValue: 'theme', by: 'brett', at: '2026-11-10T16:03:00Z' },
    { id: 'e', path: 'toolbar:app', scope: 'item', token: 'background', value: 'surface2', axHubValue: 'theme', by: 'brett', at: '2026-11-10T16:04:00Z' },
  ];
  const sources = {
    spec, overrides,
    active: (type) => (type === 'toolbar' ? 'standard-icons' : undefined),
    custom: (type) => (type === 'toolbar' ? { values: { iconSet: 'duotone', textColor: 'muted' }, shared: true } : null),
    skinParts: (type) => (type === 'toolbar' ? { values: { iconSet: 'thin', gap: 'lg' }, skin: 'amber-night' } : null),
    themeLabel: () => 'hub-night · hub',
  };
  const r = rs.resolveElementTokens('toolbar:app/group:edit/item:undo/icon', sources);
  assert.equal(r.chain.length, 4, 'the element and each of its parents, root first');
  assert.deepEqual(r.chain.map((n) => n.path), ['toolbar:app', 'toolbar:app/group:edit', 'toolbar:app/group:edit/item:undo', 'toolbar:app/group:edit/item:undo/icon']);
  const tok = (node, k) => node.tokens.find((t) => t.token === k);
  const rootN = r.chain[0];
  assert.equal(tok(rootN, 'iconSet').value, 'duotone'); assert.equal(tok(rootN, 'iconSet').source.layer, 'custom'); assert.equal(tok(rootN, 'iconSet').source.key, 'axf.custom.toolbar');
  assert.equal(tok(rootN, 'gap').value, 'lg'); assert.equal(tok(rootN, 'gap').source.layer, 'skin'); assert.equal(tok(rootN, 'gap').source.skin, 'amber-night');
  assert.equal(tok(rootN, 'padding').value, 'theme'); assert.equal(tok(rootN, 'padding').source.layer, 'theme'); assert.equal(tok(rootN, 'padding').source.detail, 'hub-night · hub');
  assert.equal(tok(rootN, 'textColor').value, 'accent'); assert.equal(tok(rootN, 'textColor').source.layer, 'inline'); assert.equal(tok(rootN, 'textColor').axHubValue, 'muted', 'what a reset goes back to: the custom value under it');
  assert.equal(tok(rootN, 'textColor').axHubSource.layer, 'custom');
  assert.equal(tok(rootN, 'radius').value, 'theme', 'an override for another asset does not apply');
  assert.equal(tok(rootN, 'background').value, 'surface2', 'item scope on the root applies to the root');
  const groupN = r.chain[1];
  assert.equal(tok(groupN, 'textColor').value, 'accent'); assert.equal(tok(groupN, 'textColor').overriddenAt, 'toolbar:app', 'a parent override reaches the group');
  assert.equal(tok(groupN, 'background').value, 'theme', 'item scope on the root does not reach children');
  assert.equal(tok(groupN, 'fontSize').value, 120);
  const undoN = r.chain[2];
  assert.equal(tok(undoN, 'textColor').value, 'danger', 'the item wins over its parent'); assert.equal(tok(undoN, 'textColor').source.by, 'brett');
  assert.equal(tok(undoN, 'textColor').axHubValue, 'muted');
  const iconN = r.chain[3];
  assert.equal(iconN.role, 'icon');
  assert.equal(tok(iconN, 'iconColor').value, 'theme');
  assert.equal(tok(iconN, 'textColor').value, 'accent', 'an item-scoped override is that element only: the icon under it still answers the root parent override');
  assert.equal(tok(iconN, 'textColor').overriddenAt, 'toolbar:app');
  assert.equal(rs.inlineLayer([{ path: 'toolbar:app/group:edit/item:undo', scope: 'parent', token: 'textColor', value: 'info' }], 'toolbar:app/group:edit/item:undo/icon').textColor.value, 'info', 'a parent-scoped override on the item reaches its icon');
  assert.ok(!tok(iconN, 'fontSize'), 'an icon has no text tokens');
  assert.ok(rootN.tokens.every((t) => 'value' in t && 'axHubValue' in t && t.source && t.source.where));

  const withAsset = rs.resolvePath('toolbar:app', { ...sources, active: () => 'touch-dock' });
  assert.equal(tok(withAsset, 'radius').value, 'pill', 'the asset-specific override applies while that asset is active');
  const extra = rs.resolvePath('toolbar:app', { ...sources, extraTokens: (n) => [{ token: 'field.variant', label: 'Buttons', kind: 'choice', options: ['icons', 'labels'], value: 'icons', source: { layer: 'extra', where: 'this device · axf.chrome.toolbar.app', key: 'axf.chrome.toolbar.app' } }] });
  assert.equal(tok(extra, 'field.variant').value, 'icons'); assert.equal(tok(extra, 'field.variant').group, 'Asset');
  assert.ok(!tok(rs.resolvePath('toolbar:app/group:edit', { ...sources, extraTokens: () => [{ token: 'field.variant', value: 'x' }] }), 'field.variant'), 'extra tokens sit on the root only');
  assert.equal(rs.resolveElementTokens('nonsense', sources), null);
  const u = rs.inlineUnder(overrides, 'toolbar:app/group:edit');
  assert.deepEqual(u.map((x) => x.id), ['b', 'c']);
});

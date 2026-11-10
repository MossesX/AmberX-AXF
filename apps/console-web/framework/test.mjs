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

/* ---------------- inline-override@1: the store ---------------- */
import * as st from './tokens/overrides-store.mjs';
import * as mig from './tokens/migrations/2026-11-inline-overrides.mjs';

test('store: get / set / unset / list; one reset touches one record; keys ride the look', () => {
  const settings = st.mapSettings();
  let t = 0;
  const store = st.createOverridesStore({ settings, now: () => `2026-11-10T16:0${t++}:00Z`, by: 'brett' });
  const a = store.set({ path: 'toolbar:app', scope: 'parent', token: 'textColor', value: 'accent', axHubValue: 'theme', reason: 'warmer bar' });
  assert.equal(a.$axf, 'inline-override@1');
  assert.equal(a.id, 'toolbar:app|parent|textColor');
  assert.equal(a.key, 'axf.inline.toolbar:app'); assert.equal(a.root, 'toolbar:app'); assert.equal(a.by, 'brett'); assert.equal(a.at, '2026-11-10T16:00:00Z'); assert.equal(a.reason, 'warmer bar');
  store.set({ path: 'toolbar:app/group:edit/item:undo', token: 'textColor', value: 'danger', axHubValue: 'accent' });
  store.set({ path: 'toolbar:app/group:edit/item:undo', token: 'iconSize', value: 120, axHubValue: 100 });
  store.set({ path: 'toolbar:app', scope: 'parent', token: 'radius', value: 'pill', axHubValue: 'theme', asset: 'touch-dock' });
  store.set({ path: 'nav-menu:app/section:system/item:settings', token: 'background', value: 'accentSoft', axHubValue: 'theme', by: 'claude' });
  assert.deepEqual(Object.keys(settings.toObject()).sort(), ['axf.inline.nav-menu:app', 'axf.inline.toolbar:app'], 'one look setting per root');
  const saved = settings.get('axf.inline.toolbar:app');
  assert.equal(saved.$axf, 'inline-overrides@1');
  assert.deepEqual(Object.keys(saved.r).sort(), ['toolbar:app/group:edit/item:undo|item|iconSize', 'toolbar:app/group:edit/item:undo|item|textColor', 'toolbar:app|parent|radius@touch-dock', 'toolbar:app|parent|textColor']);
  assert.deepEqual(saved.r['toolbar:app|parent|textColor'], { v: 'accent', h: 'theme', by: 'brett', at: '2026-11-10T16:00:00Z', why: 'warmer bar' }, 'compact on the wire');
  assert.ok(JSON.stringify(saved).length < 600);

  assert.equal(store.get('toolbar:app/group:edit/item:undo', 'textColor').value, 'danger');
  assert.equal(store.get('toolbar:app/group:edit/item:undo', 'textColor', 'parent'), null, 'scope is part of the identity');
  assert.equal(store.get('toolbar:app', 'radius', 'parent', 'touch-dock').asset, 'touch-dock');
  assert.equal(store.get('toolbar:app', 'radius', 'parent'), null);
  assert.equal(store.get('nonsense', 'x'), null);

  assert.equal(store.list().length, 5);
  assert.deepEqual(store.list({ root: 'nav-menu:app' }).map((r) => r.token), ['background']);
  assert.deepEqual(store.list({ kind: 'toolbar', token: 'textColor' }).map((r) => r.path), ['toolbar:app', 'toolbar:app/group:edit/item:undo']);
  assert.deepEqual(store.list({ by: 'claude' }).map((r) => r.id), ['nav-menu:app/section:system/item:settings|item|background']);
  assert.deepEqual(store.list({ q: 'undo' }).map((r) => r.token), ['iconSize', 'textColor']);
  assert.deepEqual(store.list({ q: 'warmer' }).map((r) => r.id), ['toolbar:app|parent|textColor'], 'search reaches the reason');
  assert.deepEqual(store.list({ under: 'toolbar:app/group:edit' }).length, 2);
  assert.deepEqual(store.list({ scope: 'parent' }).length, 2);
  assert.deepEqual(store.list({ since: '2026-11-10T16:03:00Z' }).map((r) => r.token), ['background', 'radius']);
  assert.deepEqual(store.roots().map((r) => [r.root, r.kind, r.count]), [['nav-menu:app', 'nav-menu', 1], ['toolbar:app', 'toolbar', 4]]);
  assert.equal(store.effectiveFor('toolbar:app/group:edit/item:undo/icon').textColor.value, 'accent');
  assert.equal(store.effectiveFor('toolbar:app', 'touch-dock').radius.value, 'pill');
  assert.equal(store.effectiveFor('toolbar:app', 'standard-icons').radius, undefined);

  // reset one: only that record goes; the rest of the root and the other roots stay
  assert.equal(store.unset('toolbar:app/group:edit/item:undo', 'textColor'), true);
  assert.equal(store.unset('toolbar:app/group:edit/item:undo', 'textColor'), false, 'already gone');
  assert.equal(store.get('toolbar:app/group:edit/item:undo', 'iconSize').value, 120, 'the sibling record on the same element stays');
  assert.equal(store.get('toolbar:app', 'textColor', 'parent').value, 'accent', 'the parent record stays: the item now inherits it again');
  assert.equal(store.effectiveFor('toolbar:app/group:edit/item:undo').textColor.value, 'accent');
  assert.equal(store.list().length, 4);
  assert.equal(store.unset('nav-menu:app/section:system/item:settings', 'background'), true);
  assert.equal(settings.get('axf.inline.nav-menu:app'), undefined, 'an empty root clears its key');
  assert.ok(settings.get('axf.inline.toolbar:app'), 'the other root is untouched');

  // validation and the 4 KB rule
  assert.throws(() => store.set({ path: 'Toolbar', token: 'textColor', value: 'x' }), /path/);
  assert.throws(() => store.set({ path: 'toolbar:app', token: 'text color', value: 'x' }), /token/);
  assert.throws(() => store.set({ path: 'toolbar:app', token: 'textColor', value: { a: 1 } }), /value/);
  assert.throws(() => store.set({ path: 'toolbar:app', token: 'textColor', value: 'x', scope: 'all' }), /scope/);
  const big = st.createOverridesStore({ settings: st.mapSettings(), by: 'x' });
  assert.throws(() => { for (let i = 0; i < 200; i++) big.set({ path: `banner:app/side:right/widget:w${i}`, token: 'textColor', value: 'accent', axHubValue: 'theme' }); }, /over 4096/);
  assert.ok(big.list().length > 20 && big.list().length < 200, 'the records before the cap were kept');

  // malformed saved values are dropped, never thrown
  const dirty = st.mapSettings({ 'axf.inline.toolbar:app': { $axf: 'inline-overrides@1', r: { 'toolbar:app|parent|textColor': { v: 'accent' }, 'nav-menu:app|item|textColor': { v: 'x' }, 'toolbar:app|sideways|x': { v: 1 }, 'toolbar:app|item|background': { v: { no: 1 } }, 'toolbar:app|item|opacity': { v: 50, h: 100, by: 'b<script>', at: 'not a date', why: 'y'.repeat(400) } } }, 'axf.inline.not a path': { r: {} }, 'axf.inline.toolbar:app/group:edit': { r: {} } });
  const ds = st.createOverridesStore({ settings: dirty });
  assert.deepEqual(ds.list().map((r) => [r.id, r.value, r.by, r.at, r.reason.length]), [['toolbar:app|parent|textColor', 'accent', '', '', 0], ['toolbar:app|item|opacity', 50, '', '', 200]], 'at one path: parent before item');
  assert.ok(st.isInlineKey('axf.inline.toolbar:app') && !st.isInlineKey('axf.inline.toolbar:app/group:edit') && !st.isInlineKey('axf.tokens.theme'));
});

test('migration: axf.custom.* and axf.chrome.* become records; token sets stay; dry by default; idempotent', () => {
  const legacy = {
    'axf.custom.toolbar': { all: true, shared: { textColor: 'muted', iconSet: 'duotone', fontSize: 100 }, byId: { 'touch-dock': { radius: 'pill' } } },
    'axf.custom.nav-menu': { all: false, shared: { textColor: 'accent' }, byId: { 'sidebar-list': { background: 'surface2' }, 'icon-rail': { iconSize: 120, textColor: 'theme' } } },
    'axf.custom.banner': { all: true, shared: {} },
    'axf.custom.nope': { all: true, shared: { textColor: 'accent' } },
    'axf.chrome.toolbar.app': { variant: 'labels', density: 'compact' },
    'axf.chrome.tab-group.settings': { style: 'pills' },
    'axf.chrome.tab-group.settings.asset': 'chips',
    'axf.chrome.settings.toolbar': 'chrome-toolbar-console',
    'axf.tokens.nav': { '*': { 'colors.text': 'accent', 'accents.home': 'danger' } },
    'axf.tokens.theme': { '*': { accent: '#ff0000' } },
    'axf.look': { compact: true },
  };
  const r = mig.migrateInlineOverrides(legacy, { spec, now: '2026-11-10T17:00:00Z', assetData: (type) => (type === 'toolbar' ? { variant: 'icons', density: 'regular', align: 'start' } : null) });
  assert.equal(r.id, '2026-11-inline-overrides');
  const ids = r.records.map((x) => x.id).sort();
  assert.deepEqual(ids, [
    'nav-menu:app|parent|background@sidebar-list', 'nav-menu:app|parent|iconSize@icon-rail',
    'tab-group:settings|parent|field.style',
    'toolbar:app|parent|density@touch-dock'.replace('density@touch-dock', 'field.density'), 'toolbar:app|parent|field.variant',
    'toolbar:app|parent|iconSet', 'toolbar:app|parent|textColor',
  ].sort());
  const by = Object.fromEntries(r.records.map((x) => [x.id, x]));
  assert.equal(by['toolbar:app|parent|textColor'].axHubValue, 'theme', 'custom sat on the theme');
  assert.equal(by['toolbar:app|parent|textColor'].migratedFrom, 'axf.custom.toolbar');
  assert.equal(by['toolbar:app|parent|textColor'].by, 'migration'); assert.equal(by['toolbar:app|parent|textColor'].at, '2026-11-10T17:00:00Z');
  assert.equal(by['toolbar:app|parent|field.variant'].value, 'labels'); assert.equal(by['toolbar:app|parent|field.variant'].axHubValue, 'icons', 'the asset’s own value');
  assert.equal(by['tab-group:settings|parent|field.style'].axHubValue, null, 'no asset data given');
  assert.equal(by['nav-menu:app|parent|background@sidebar-list'].asset, 'sidebar-list');
  assert.ok(!ids.some((i) => i.includes('fontSize')), 'a default value is not an override');
  assert.ok(!ids.some((i) => i.includes('radius')), 'byId values are ignored while apply-to-all is on');
  assert.ok(!ids.some((i) => i.startsWith('nav-menu:app|parent|textColor')), 'shared values are ignored while apply-to-all is off; a theme value is not an override');
  assert.deepEqual(r.clears.sort(), ['axf.chrome.tab-group.settings', 'axf.chrome.toolbar.app', 'axf.custom.nav-menu', 'axf.custom.toolbar']);
  assert.deepEqual(r.skipped.map((s) => s.key).sort(), ['axf.chrome.settings.toolbar', 'axf.chrome.tab-group.settings.asset', 'axf.custom.banner', 'axf.custom.nope']);
  assert.ok(!Object.keys(r.writes).some((k) => !k.startsWith('axf.inline.')));
  assert.ok(!('axf.tokens.nav' in r.writes) && !r.clears.includes('axf.tokens.nav') && !r.clears.includes('axf.look'), 'token sets and retired keys are left alone');
  for (const v of Object.values(r.writes)) assert.ok(JSON.stringify(v).length <= 4096);

  // apply: dry keeps the legacy keys; clearLegacy removes exactly the migrated ones
  const target = st.mapSettings({ ...legacy });
  const done = mig.applyMigration(r, target);
  assert.deepEqual(done.written.sort(), ['axf.inline.nav-menu:app', 'axf.inline.tab-group:settings', 'axf.inline.toolbar:app']);
  assert.deepEqual(done.cleared, []); assert.deepEqual(done.kept.sort(), r.clears.sort());
  assert.ok(target.get('axf.custom.toolbar'), 'legacy key kept until the CSS phase');
  const store = st.createOverridesStore({ settings: target });
  assert.equal(store.list().length, 7);
  const done2 = mig.applyMigration(r, target, { clearLegacy: true });
  assert.deepEqual(done2.cleared.sort(), r.clears.sort());
  assert.equal(target.get('axf.custom.toolbar'), undefined); assert.ok(target.get('axf.tokens.nav'), 'not ours to clear');

  // idempotent: a second run over the migrated settings adds nothing
  const again = mig.migrateInlineOverrides({ ...legacy, ...target.toObject() }, { spec, existing: (k) => target.get(k) });
  assert.equal(again.records.length, 0);
  assert.equal(Object.keys(again.writes).length, 0);
  assert.ok(again.skipped.some((s) => /already migrated/.test(s.why)));
  assert.ok(mig.isLegacyOverrideKey('axf.custom.toolbar') && mig.isLegacyOverrideKey('axf.chrome.toolbar.app') && !mig.isLegacyOverrideKey('axf.chrome.toolbar.app.asset') && !mig.isLegacyOverrideKey('axf.tokens.nav'));
});

/* ---------------- the right-click capture layer ---------------- */
import * as cap from './inline-edit/capture.mjs';

/** A document fake: listeners by phase, elementFromPoint, dispatched events; elements get `closest` for the pass selector. */
function fakeDoc(tree) {
  const listeners = { capture: [], bubble: [] };
  const dispatched = [];
  const passes = (n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName) || n.getAttribute('contenteditable') === 'true' || n.classList.contains('fx-ctx') || n.getAttribute('data-axf-inline-ignore') !== null;
  const walk = (n) => { n.closest = () => { for (let e = n; e; e = e.parentElement) if (passes(e)) return e; return null; }; n.children.forEach(walk); };
  walk(tree);
  let under = null;
  const doc = {
    addEventListener: (type, fn, capture) => { assert.equal(type, 'contextmenu'); (capture ? listeners.capture : listeners.bubble).push(fn); },
    removeEventListener: (type, fn, capture) => { const l = capture ? listeners.capture : listeners.bubble; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    elementFromPoint: () => under,
    dispatchEvent: (ev) => { dispatched.push(ev); return true; },
    listeners, dispatched,
    setUnder: (n) => { under = n; },
    /** Fire a right-click like the browser: capture listeners on the document first, then the bubble ones unless stopped. */
    rightClick: (target, init = {}) => {
      const ev = { type: 'contextmenu', target, clientX: 10, clientY: 10, altKey: false, defaultPrevented: false, stopped: false, ...init,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const fn of [...listeners.capture]) { fn(ev); if (ev.stopped) return ev; }
      for (const fn of [...listeners.bubble]) { fn(ev); if (ev.stopped) return ev; }
      return ev;
    },
  };
  return doc;
}

test('capture layer: attached only while the mode is on; deepest child; chain from the path; native and app menus left alone', () => {
  globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  const s = shell();
  const doc = fakeDoc(s);
  const appMenu = []; // the framework's own context menu (Overlays.tsx): a bubble-phase listener
  doc.addEventListener('contextmenu', (ev) => { appMenu.push(ev.target); ev.preventDefault(); }, false);
  const opened = [];
  const capture = cap.createInlineEditCapture({ doc, onOpen: (d) => opened.push(d) });
  assert.equal(capture.enabled, false);
  assert.equal(doc.listeners.capture.length, 0, 'off: not attached at all');

  const deep = find(s, (n) => n.tagName === 'B');
  doc.setUnder(deep);
  let ev = doc.rightClick(deep);
  assert.equal(opened.length, 0); assert.equal(appMenu.length, 1, 'off: the app menu runs as before');

  const settings = st.mapSettings();
  const unbind = cap.bindInlineEditMode(capture, settings);
  assert.equal(capture.enabled, false, 'switch off → still not attached');
  settings.set(cap.INLINE_EDIT_MODE_KEY, true);
  // a plain map has no onChange / subscribe: rebind reads the switch
  unbind(); cap.bindInlineEditMode(capture, settings);
  assert.equal(capture.enabled, true); assert.equal(doc.listeners.capture.length, 1, 'on: one capture-phase listener');

  ev = doc.rightClick(deep);
  assert.equal(opened.length, 1); assert.equal(appMenu.length, 1, 'the app menu did not run'); assert.ok(ev.defaultPrevented && ev.stopped);
  const d = opened[0];
  assert.equal(d.$axf, 'inline-edit-open@1');
  assert.equal(d.path, 'app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color/label', 'hit-tested to the deepest addressed child');
  assert.deepEqual(d.chain, em.chainOf(d.path), 'the parent chain comes from the path');
  assert.equal(d.chain[0], 'app-menu:app'); assert.equal(d.root, 'app-menu:app'); assert.equal(d.role, 'text');
  assert.equal(d.target, deep, 'what was under the pointer'); assert.equal(d.own, false);
  assert.equal(d.element, deep.parentElement, 'the owner of the path: the label span');
  assert.equal(d.owners.length, d.chain.length, 'one DOM element per chain step');
  assert.equal(doc.dispatched.length, 1); assert.equal(doc.dispatched[0].type, cap.INLINE_EDIT_OPEN_EVENT); assert.equal(doc.dispatched[0].detail.path, d.path);

  // elementFromPoint wins over the event target (the real pointer position), the target is the fallback
  const undo = byAttr(s, 'data-axf-toolbtn', 'undo');
  doc.setUnder(undo.children[0]);
  doc.rightClick(byClass(s, 'fx-menubar'));
  assert.equal(opened.at(-1).path, 'toolbar:app/group:edit/item:undo/icon');
  doc.setUnder(null);
  doc.rightClick(undo);
  assert.equal(opened.at(-1).path, 'toolbar:app/group:edit/item:undo');

  // left alone: outside every root, text fields, an open context menu, opt-out, Alt, already handled
  const outside = el('div', { class: 'something-else' }); outside.closest = () => null;
  const before = { opened: opened.length, menu: appMenu.length };
  doc.rightClick(outside);
  assert.equal(opened.length, before.opened); assert.equal(appMenu.length, before.menu + 1, 'not a framework element: the app menu runs');
  const field = el('input', {}); const bar = byClass(s, 'fx-toolbar'); bar.children.push(field); field.parentElement = bar; field.closest = () => field;
  doc.rightClick(field);
  assert.equal(opened.length, before.opened, 'a text field keeps its native menu'); assert.equal(appMenu.length, before.menu + 2);
  const ctx = el('div', { class: 'fx-ctx' }, [el('button', { class: 'fx-menu__item', 'data-axf-action': 'x' })]); const row = ctx.children[0]; row.closest = () => ctx;
  doc.rightClick(row);
  assert.equal(opened.length, before.opened, 'inside the open context menu: left alone');
  const ignored = el('span', { class: 'fx-toolbtn__badge', 'data-axf-inline-ignore': '' }); ignored.parentElement = undo; ignored.closest = () => ignored;
  doc.rightClick(ignored);
  assert.equal(opened.length, before.opened, 'opt-out attribute');
  doc.rightClick(undo, { altKey: true });
  assert.equal(opened.length, before.opened, 'Alt + right-click passes through');
  doc.rightClick(undo, { defaultPrevented: true });
  assert.equal(opened.length, before.opened, 'an event someone already handled is not taken');
  doc.rightClick(undo);
  assert.equal(opened.length, before.opened + 1);

  // switch off → detached, app menu back
  capture.disable();
  assert.equal(doc.listeners.capture.length, 0, 'off again: nothing listens');
  const m = appMenu.length;
  doc.rightClick(undo);
  assert.equal(opened.length, before.opened + 1); assert.equal(appMenu.length, m + 1);
  capture.enable(); capture.enable();
  assert.equal(doc.listeners.capture.length, 1, 'enable twice: one listener');
  capture.disable();
  assert.ok(cap.inlineEditModeOn(true) && cap.inlineEditModeOn('on') && !cap.inlineEditModeOn(false) && !cap.inlineEditModeOn(undefined) && !cap.inlineEditModeOn('off'));
  assert.equal(cap.INLINE_EDIT_MODE_KEY, 'axf.inline-edit.mode');
  assert.throws(() => cap.createInlineEditCapture({ doc: null }), /document/);
  delete globalThis.CustomEvent;
});

test('entry: index.mjs re-exports every piece', async () => {
  const fx = await import('./index.mjs');
  for (const k of ['pathOf', 'addressOf', 'chainOf', 'resolveElementTokens', 'inlineLayer', 'createOverridesStore', 'INLINE_KEY', 'createInlineEditCapture', 'bindInlineEditMode', 'INLINE_EDIT_MODE_KEY', 'INLINE_EDIT_OPEN_EVENT']) assert.equal(typeof fx[k], k === 'INLINE_EDIT_MODE_KEY' || k === 'INLINE_EDIT_OPEN_EVENT' ? 'string' : 'function', k);
  assert.equal(typeof fx.inlineOverridesMigration2026_11.migrateInlineOverrides, 'function');
});

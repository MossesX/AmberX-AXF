/**
 * Per-instance transparency reaches the element (build land-per-instance-settings-picker; Brett, Nov 13 2026: "every
 * tab group, application menu, navigation menu, toolbar can have its own settings interface that changes only it, and
 * they all have transparency"). In jsdom, with chrome drawn the way the framework and hand-drawn strips draw it:
 *
 *   - each kind's surface gets its own opacity token (and backdrop where the kind frosts) from
 *     `axf.chrome.<kind>.<instance>.transparency`, on the box that paints it (a nav's region, a context menu's panel)
 *   - two toolbars / two tab rows: setting one never touches the other
 *   - 'inherit' (or clearing the setting) removes the tokens again, so the element follows the style theme
 *   - the installed host re-applies on a settings change and when chrome mounts later
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-chrome-transparency.mts
 */
import { JSDOM } from 'jsdom';
import { CHROME_INSTANCE_KEY } from '../core/engines/chrome-settings-rules.mjs';

const dom = new JSDOM(`<!doctype html><body><div class="fx-shell">
  <div class="fx-menubar" role="menubar" data-fx-ctx-target="app-menu" data-fx-ctx-payload="app"></div>
  <div class="fx-toolbar" role="toolbar" aria-label="App toolbar" data-fx-ctx-target="toolbar" data-fx-ctx-payload="app"></div>
  <div role="toolbar" aria-label="Tree search"></div>
  <div role="toolbar" aria-label="Grid tools" data-axf-toolbar="grid.tools"></div>
  <aside class="fx-region--nav" data-side="left"><nav class="fx-nav" aria-label="Main" data-axf-nav="app" data-fx-ctx-target="nav" data-fx-ctx-payload="app"></nav></aside>
  <div class="fx-tabs" role="tablist" data-fx-ctx-target="tab-group" data-fx-ctx-payload="settings.tabs"></div>
  <div class="fx-tabs" role="tablist" data-fx-ctx-target="tab-group" data-fx-ctx-payload="ui-review.sections"></div>
  <div class="fx-banner" data-fx-ctx-target="banner"></div>
  <nav data-axf-not-nav><div role="toolbar" aria-label="Preview bar"></div></nav>
</div></body>`, { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) g[k] = (dom.window as unknown as Record<string, unknown>)[k];
const { applyChromeTransparency, installChromeTransparency } = await import('../react/chromeTransparency');

const doc = dom.window.document;
const $ = (sel: string) => doc.querySelector<HTMLElement>(sel)!;
const v = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);
let n = 0; const failures: string[] = [];
const ok = (c: unknown, what: string) => { if (c) n += 1; else failures.push(what); };

const saved = new Map<string, unknown>();
const listeners = new Set<() => void>();
const get = (k: string) => saved.get(k);
const set = (type: string, instance: string, t: string | null) => {
  if (t === null) saved.delete(CHROME_INSTANCE_KEY(type, instance)); else saved.set(CHROME_INSTANCE_KEY(type, instance), { transparency: t });
  listeners.forEach((f) => f());
};

const appBar = $('[data-fx-ctx-payload="app"][role="toolbar"]'), tree = $('[aria-label="Tree search"]'), grid = $('[data-axf-toolbar="grid.tools"]');
const menubar = $('.fx-menubar'), nav = $('nav.fx-nav'), region = $('.fx-region--nav'), banner = $('.fx-banner');
const tabsA = $('[data-fx-ctx-payload="settings.tabs"]'), tabsB = $('[data-fx-ctx-payload="ui-review.sections"]');

// nothing set: no element carries tokens of its own
applyChromeTransparency(doc, get);
ok(!doc.querySelector('[data-axf-own-transparency]'), 'nothing set: no element has its own transparency');

// one of each kind
set('toolbar', 'app', '60'); set('toolbar', 'tree-search', '30'); set('app-menu', 'app', '80'); set('nav-menu', 'app', '50');
set('tab-group', 'settings.tabs', '40'); set('banner', 'app', '70');
applyChromeTransparency(doc, get);
ok(v(appBar, '--fx-opacity-toolbar') === '0.6' && v(appBar, '--fx-backdrop-toolbar') === 'blur(var(--fx-blur))', `app toolbar: 60% (${v(appBar, '--fx-opacity-toolbar')})`);
ok(v(tree, '--fx-opacity-toolbar') === '0.3', `an unnamed toolbar (its aria-label slug): 30% (${v(tree, '--fx-opacity-toolbar')})`);
ok(v(grid, '--fx-opacity-toolbar') === '', 'a toolbar with no setting of its own is untouched by the others');
ok(v(menubar, '--fx-opacity-toolbar') === '0.8', `menu bar: 80% (${v(menubar, '--fx-opacity-toolbar')})`);
ok(v(nav, '--fx-nav-opacity') === '0.5' && v(region, '--fx-nav-opacity') === '0.5' && v(region, '--fx-nav-backdrop') !== '', 'nav: 50% on the nav and on the region that paints it');
ok(v(tabsA, '--fx-tab-opacity') === '0.4', `tab row settings.tabs: 40% (${v(tabsA, '--fx-tab-opacity')})`);
ok(v(tabsB, '--fx-tab-opacity') === '', 'tab row ui-review.sections: untouched by settings.tabs');
ok(v(banner, '--fx-opacity-banner') === '0.7', `banner: 70% (${v(banner, '--fx-opacity-banner')})`);

// opaque: the token is 1 and the frost goes away
set('toolbar', 'app', '100'); applyChromeTransparency(doc, get);
ok(v(appBar, '--fx-opacity-toolbar') === '1' && v(appBar, '--fx-backdrop-toolbar') === 'none', 'app toolbar opaque: 1, no backdrop');

// inherit / cleared: the tokens are removed again
set('toolbar', 'app', 'inherit'); set('nav-menu', 'app', null); applyChromeTransparency(doc, get);
ok(v(appBar, '--fx-opacity-toolbar') === '' && !appBar.hasAttribute('data-axf-own-transparency'), 'app toolbar inherit: back on the theme');
ok(v(nav, '--fx-nav-opacity') === '' && v(region, '--fx-nav-opacity') === '' && !region.hasAttribute('data-axf-own-transparency'), 'nav cleared: region back on the theme');
ok(v(tree, '--fx-opacity-toolbar') === '0.3', 'clearing one toolbar leaves the other');

// the host: re-applies on a settings change and on chrome mounted later
const raf = (f: FrameRequestCallback) => { f(0); return 1; };
(dom.window as unknown as { requestAnimationFrame: typeof raf }).requestAnimationFrame = raf;
const host = installChromeTransparency(doc as unknown as Document, get, (fn) => { listeners.add(fn); return () => listeners.delete(fn); });
set('toolbar', 'grid.tools', '20');
ok(v(grid, '--fx-opacity-toolbar') === '0.2', `host: a settings change applies (${v(grid, '--fx-opacity-toolbar')})`);
const later = doc.createElement('div'); later.setAttribute('role', 'tablist'); later.setAttribute('data-fx-ctx-target', 'tab-group'); later.setAttribute('data-fx-ctx-payload', 'late.tabs');
set('tab-group', 'late.tabs', '10');
$('.fx-shell').appendChild(later);
await new Promise((r) => setTimeout(r, 20));
ok(v(later, '--fx-tab-opacity') === '0.1', `host: a tab row mounted later gets its own (${v(later, '--fx-tab-opacity')})`);
host.dispose();

if (failures.length) { console.error(`check-chrome-transparency: ${failures.length} failure(s)`); for (const f of failures) console.error(`  ${f}`); process.exit(1); }
console.log(`check-chrome-transparency: ${n} checks passed (every chrome kind's own transparency reaches only its own element)`);

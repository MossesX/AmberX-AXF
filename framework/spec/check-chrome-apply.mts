/**
 * chrome-settings@1 applies everywhere (build chrome-settings-actually-apply-toolbars, Nov 13 2026; Brett: "do all tab
 * groups have their own settings interface ... the toolbar and nav ignore it, why"). The settings dialog saves each
 * instance's fields as `axf.chrome.<type>.<instance>`; tab groups read them (TabGroup.tsx), and this check proves every
 * other chrome kind does too:
 *
 *   - every value of every field of the toolbar, navigation menu, application menu, banner and context menu, set on the
 *     app instance, is in the data that kind renders with (`rt.chromeData`, the banner's `rt.banner().data`)
 *   - every two different values of a field give a different render input (the compiled root style + the data the
 *     component draws from), so no field is silently ignored
 *   - Tap to confirm (instance-only) follows the instance setting on every kind
 *   - a page toolbar's own instance (its asset id) applies to it and never leaks into the app toolbar
 *   - overrides persist: a fresh runtime on the same storage (a reload) renders the same
 *
 *   npx -y tsx framework/spec/check-chrome-apply.mts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AxfRuntime } from '../core/runtime';
import { toolbarStyle } from '../core/engines/components';
import { tapConfigFor } from '../core/engines/tapconfirm';
import { CHROME_FIELDS, CHROME_INSTANCE_KEY, CHROME_TAP_FIELD, CHROME_TAP_OPTIONS } from '../core/engines/chrome-settings-rules.mjs';
import { wsToolbarAttrs, wsToolbarLook } from '../libs/workspace/look';

// a localStorage stand-in so settings persist across runtimes the way a reload does in the browser
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const root = new URL('../', import.meta.url).pathname;
let n = 0; const failures: string[] = [];
const ok = (c: unknown, what: string) => { if (c) n += 1; else failures.push(what); };

const read = (t: string) => existsSync(join(root, 'assets', t)) ? readdirSync(join(root, 'assets', t)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))) : [];
const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const STORAGE = 'test:chrome-apply';
const make = () => new AxfRuntime({ manifest: { app: { id: 'chrome-apply', name: 'Chrome apply' }, defaults } as never, assets, storageKey: STORAGE });

type Kind = 'toolbar' | 'nav-menu' | 'app-menu' | 'banner' | 'context-menu';
const KINDS: Kind[] = ['toolbar', 'nav-menu', 'app-menu', 'banner', 'context-menu'];

/**
 * The fields each component reads from the data while it draws (Chrome.tsx Toolbar / NavMenu, NavTree, Banner.tsx,
 * Overlays.tsx ContextMenuHost); everything else reaches the screen only through the compiled root style. A field in
 * neither list renders the same for every value and fails below.
 */
const COMPONENT_READS: Record<Kind, string[]> = {
  toolbar: ['variant', 'align', 'showSearch'],
  'nav-menu': ['style'],
  'app-menu': [],
  banner: ['surface', 'divider'],
  'context-menu': ['showIcons', 'showShortcuts'],
};

/** What the kind renders with: the compiled root style (attributes + vars), the fields its component reads, the folded toolbar, the nav-style switch. */
function renderInput(rt: AxfRuntime, kind: Kind): string {
  const data = ((kind === 'banner' ? rt.banner().data : rt.chromeData(kind)) ?? {}) as Record<string, unknown>;
  const { vars, attrs } = rt.compileStyles();
  const reads = Object.fromEntries(COMPONENT_READS[kind].map((k) => [k, data[k]]));
  const extra = kind === 'nav-menu' ? { navStyle: rt.navStyleData() !== null } : kind === 'toolbar' ? { foldable: rt.toolbarCollapsed() } : {};
  return JSON.stringify({ vars, attrs, reads, extra });
}

const valuesOf = (f: { kind: string; options?: string[]; min?: number; max?: number }): (string | number | boolean)[] =>
  f.kind === 'toggle' ? [true, false] : f.kind === 'number' ? [f.min!, Math.round((f.min! + f.max!) / 2), f.max!] : [...(f.options ?? [])];

{
  const rt = make();
  for (const kind of KINDS) {
    ok(rt.assetOrNull(kind as never), `${kind}: the framework defaults ship one`);
    const key = CHROME_INSTANCE_KEY(kind, 'app');
    for (const f of CHROME_FIELDS[kind]) {
      if (f.key === CHROME_TAP_FIELD) continue; // instance-only: checked below through the tap-confirm engine
      const seen = new Map<string, string | number | boolean>();
      for (const v of valuesOf(f)) {
        rt.settings.set(key, { [f.key]: v } as never);
        const data = (kind === 'banner' ? rt.banner().data : rt.chromeData(kind)) as Record<string, unknown> | null;
        ok(data && data[f.key] === v, `${kind}.${f.key}=${String(v)}: in the data the ${kind} renders with (got ${String(data?.[f.key])})`);
        const sig = renderInput(rt, kind);
        const dup = seen.get(sig);
        ok(dup === undefined, `${kind}.${f.key}: ${String(v)} renders the same as ${String(dup)} (the setting is ignored)`);
        seen.set(sig, v);
      }
      rt.settings.clear(key);
    }
    for (const v of CHROME_TAP_OPTIONS) {
      rt.settings.set(key, { [CHROME_TAP_FIELD]: v } as never);
      const on = tapConfigFor((k: string) => rt.settings.get(k), kind, 'app').enabled;
      if (v === 'on') ok(on, `${kind}.tapConfirm=on: armed`);
      if (v === 'off') ok(!on, `${kind}.tapConfirm=off: not armed`);
      rt.settings.clear(key);
    }
  }
}

// a page toolbar is its own instance: its settings apply to it, the app toolbar is untouched
{
  const rt = make();
  const page = rt.registry.list('toolbar')[0]!;
  const before = rt.chromeData('toolbar');
  rt.settings.set(CHROME_INSTANCE_KEY('toolbar', page.id), { variant: 'labels', surface: 'glass', density: 'roomy' } as never);
  const own = rt.chromeData('toolbar', page.id, page.data)!;
  ok(own.variant === 'labels' && own.surface === 'glass' && own.density === 'roomy', `page toolbar ${page.id}: its own overrides apply`);
  ok(toolbarStyle(own).attrs['data-fx-toolbar-surface'] === 'glass', `page toolbar ${page.id}: its style output follows`);
  ok(JSON.stringify(rt.chromeData('toolbar')) === JSON.stringify(before), 'page toolbar overrides never reach the app toolbar');
  rt.settings.clear(CHROME_INSTANCE_KEY('toolbar', page.id));
}

// a workspace (plugin) toolbar is its own instance (its toolbar id): every value of every toolbar field changes what it
// draws (its look attributes + the fields the component reads), and never leaks into another toolbar or the app toolbar
{
  const rt = make();
  const get = (k: string) => rt.settings.get(k);
  const tb = { id: 'check.ws-tools', labels: false }, other = { id: 'check.ws-other', labels: false };
  const key = CHROME_INSTANCE_KEY('toolbar', tb.id);
  const draws = () => { const look = wsToolbarLook(get, tb); return JSON.stringify({ attrs: wsToolbarAttrs(look, false), showSearch: look.showSearch, collapsible: look.collapsible }); };
  const app0 = JSON.stringify(rt.chromeData('toolbar')), other0 = JSON.stringify(wsToolbarLook(get, other));
  for (const f of CHROME_FIELDS.toolbar) {
    if (f.key === CHROME_TAP_FIELD) continue;
    const seen = new Map<string, string | number | boolean>();
    for (const v of valuesOf(f)) {
      rt.settings.set(key, { [f.key]: v } as never);
      ok((wsToolbarLook(get, tb) as unknown as Record<string, unknown>)[f.key] === v, `workspace toolbar ${f.key}=${String(v)}: applied`);
      const sig = draws(), dup = seen.get(sig);
      ok(dup === undefined, `workspace toolbar ${f.key}: ${String(v)} draws the same as ${String(dup)} (the setting is ignored)`);
      seen.set(sig, v);
    }
    ok(JSON.stringify(rt.chromeData('toolbar')) === app0 && JSON.stringify(wsToolbarLook(get, other)) === other0, `workspace toolbar ${f.key}: other toolbars untouched`);
    rt.settings.clear(key);
  }
  ok(wsToolbarLook(get, { id: tb.id, labels: true }).variant === 'icons-labels', 'workspace toolbar: its definition\'s labels is the default Buttons choice');
}

// persist + reload: what one runtime saved, the next renders
{
  const a = make();
  a.settings.set(CHROME_INSTANCE_KEY('toolbar', 'app'), { surface: 'raised', variant: 'labels' } as never);
  a.settings.set(CHROME_INSTANCE_KEY('nav-menu', 'app'), { indicator: 'fill', density: 'compact' } as never);
  a.settings.set(CHROME_INSTANCE_KEY('app-menu', 'app'), { surface: 'glass' } as never);
  a.settings.set(CHROME_INSTANCE_KEY('banner', 'app'), { height: 40 } as never);
  const b = make();
  const s = b.compileStyles();
  ok(s.attrs['data-fx-toolbar-surface'] === 'raised' && s.attrs['data-fx-toolbar'] === 'labels', 'reload: toolbar look kept');
  ok(s.attrs['data-fx-nav-indicator'] === 'fill', 'reload: nav active mark kept');
  ok(s.attrs['data-fx-menubar'] === 'glass', 'reload: menu bar surface kept');
  ok(s.vars['--fx-banner-h'] === '40px', `reload: banner height kept (${s.vars['--fx-banner-h']})`);
  for (const k of KINDS) b.settings.clear(CHROME_INSTANCE_KEY(k, 'app'));
  ok(b.compileStyles().attrs['data-fx-toolbar-surface'] === (b.asset('toolbar').data.surface ?? 'flat'), 'reset: back to the asset');
}

// the style dependency key changes with an override, so the provider re-applies the root style live
{
  const rt = make();
  const k0 = rt.styleSettingsKey();
  rt.settings.set(CHROME_INSTANCE_KEY('nav-menu', 'app'), { style: 'pills' } as never);
  ok(rt.styleSettingsKey() !== k0, 'live: an override changes the style dependency key');
  rt.settings.clear(CHROME_INSTANCE_KEY('nav-menu', 'app'));
}

if (failures.length) { console.error(`check-chrome-apply: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`check-chrome-apply: ${n} checks passed (every chrome settings value applies on toolbar, nav, menu bar, banner, context menu, workspace toolbars)`);

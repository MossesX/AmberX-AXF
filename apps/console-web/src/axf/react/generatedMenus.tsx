/**
 * Generated nested menus (nested-menu@1, core/engines/menugen.mjs) for a running app.
 *
 * `generatedMenusLibrary(cfg)` is an AxfWebLibrary an app (or one of its plugins) installs. It reads the live UI
 * registry (every page, dialog and settings tab in the search index, the shared app-menu asset merged with every
 * library's contributions, the shared nav-menu asset and the sections libraries add), generates the app-menu and
 * nav-menu assets `<app>-generated`, registers them, and when the override setting is on (default) swaps them in
 * place of the shared menus. It regenerates whenever the registry changes (a plugin installed, a page added), so a
 * new plugin shows up in the right category by itself. The Dev Console, AmberX and Molly all install it with their
 * own id and label, so their menus are generated the same exact way.
 *
 * Control (every menu and setting): actions `menus.jump[:query]` (search / jump-to, also a dialog), `menus.open:<entry>`,
 * `menus.favorite[:<entry>[:on|off]]`, `menus.override[:on|off|toggle]`, `menus.set:<field>:<value>`, `menus.get`,
 * `menus.generate`, `menus.outline`, `menus.recents.clear`, `menus.favorites.clear`, `menus.settings`. They reach REST,
 * MCP and the CLI through plugin-commands@1 (the wrapping plugin declares them) and voice through the actions bus.
 * Settings: Settings → Plugins → Menus, one collapsible section per group (General, Categories, Favourites, Recent,
 * Preview). Theme tokens and framework controls only.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssetType, AxfRuntime, MenuItem, NavItem } from '../core';
import { mergeAppMenu, type MergedMenuItem } from '../core/engines/appmenu';
import {
  FAVORITES_ID, GENERATED_SUFFIX, JUMP_ACTION, MENU_CATEGORIES, NESTED_MENU_DEFAULTS, NESTED_MENU_FIELDS, NESTED_MENU_KEYS as K,
  generateMenuAssets, menuFieldErrors, parseFieldValue, pushRecent, searchMenuIndex, toggleFavorite, treeOutline,
  type GeneratedMenuAssets, type MenuIndexEntry, type MenuSourceInput, type NestedMenuOptions,
} from '../core/engines/menugen.mjs';
import { useAxfState, useRuntime } from './AxfProvider';
import { Button, Chip, Container, Kbd, Slider } from './components/Controls';
import { Note, SelectField, Switch, TextField } from './components/Forms';
import { Icon } from './components/Icon';
import { MenuList } from './components/MenuList';
import type { AxfWebLibrary } from './library';

export interface GeneratedMenusConfig {
  /** the installing library's id (the console plugin's, Molly's, AmberX's) */
  id: string;
  label?: string;
  version?: string;
  /** the app id the assets are generated for (default: the runtime's manifest app id) */
  app?: string;
  appLabel?: string;
  /** settings tab id (default `menus`) and its parent (default `plugins`) */
  settingsTab?: string;
  settingsParent?: string;
  /** more registry entries (Molly's apps, an app's own extras) */
  extraSources?: (rt: AxfRuntime) => MenuSourceInput[];
  builtWith?: { model: string; builtAt?: string };
}

export const JUMP_DIALOG = 'menus.jump';
const DEBOUNCE_MS = 200;

/* ---------------- settings ---------------- */

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const asBool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const asNum = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The generator options the settings hold right now. */
export function menuOptionsFrom(rt: AxfRuntime): Omit<NestedMenuOptions, 'app' | 'appLabel'> {
  const g = (k: string) => rt.settings.get(k);
  return {
    maxPerLevel: asNum(g(K.maxPerLevel), NESTED_MENU_DEFAULTS.maxPerLevel),
    recentsMax: asNum(g(K.recentsMax), NESTED_MENU_DEFAULTS.recentsMax),
    showFavorites: asBool(g(K.showFavorites), NESTED_MENU_DEFAULTS.showFavorites),
    showRecents: asBool(g(K.showRecents), NESTED_MENU_DEFAULTS.showRecents),
    groupByPlugin: asBool(g(K.groupByPlugin), NESTED_MENU_DEFAULTS.groupByPlugin),
    style: (NESTED_MENU_FIELDS.style.options as readonly string[]).includes(String(g(K.style))) ? (g(K.style) as 'list' | 'rail' | 'pills') : NESTED_MENU_DEFAULTS.style,
    favorites: asList(g(K.favorites)),
    recents: asList(g(K.recents)),
    hidden: asList(g(K.hidden)),
  };
}
const overrideOn = (rt: AxfRuntime) => asBool(rt.settings.get(K.override), NESTED_MENU_FIELDS.override.default as boolean);

/* ---------------- the registry ---------------- */

/** The id of the shared (not generated) asset of a type: what was active before the override, else the manifest's. */
export function sharedAssetId(rt: AxfRuntime, type: 'app-menu' | 'nav-menu', genId: string): string {
  const prev = rt.settings.get(K.previous);
  const saved = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>)[type] : undefined;
  const fromSettings = typeof saved === 'string' && saved !== genId && rt.registry.has(type, saved) ? saved : '';
  if (fromSettings) return fromSettings;
  const active = rt.getState().active[type];
  if (active && active !== genId) return active;
  const def = (rt.manifest.defaults as Record<string, string | undefined>)[type];
  return def && rt.registry.has(type, def) ? def : rt.registry.list(type).find((a) => a.id !== genId)?.id ?? '';
}

/**
 * Every entry the app can open, from the live registry: pages, dialogs and settings tabs (the search index), the
 * shared application menu with every library's contributions, the shared navigation and the sections libraries add.
 */
export function collectMenuSources(rt: AxfRuntime, selfId: string, genId: string, extra: MenuSourceInput[] = []): MenuSourceInput[] {
  const out: MenuSourceInput[] = [];
  const owner = new Map<string, { id: string; label: string; menu?: { category?: string; subcategory?: string; keywords?: string[] } }>();
  for (const l of rt.libraries) {
    const rec = { id: l.id, label: l.label, menu: l.menu };
    for (const v of l.ui?.views ?? []) owner.set(`view:${v.id}`, rec);
    for (const d of l.ui?.dialogs ?? []) owner.set(`dialog:${d.id}`, rec);
    for (const t of l.ui?.settingsTabs ?? []) owner.set(`settings-tab:${t.id}`, rec);
    owner.set(`lib:${l.id}`, rec);
  }
  const mod = (key: string | undefined) => {
    const o = key ? owner.get(key) : undefined;
    return o ? { module: o.id, moduleLabel: o.label, category: o.menu?.category, subcategory: o.menu?.subcategory, keywords: o.menu?.keywords ?? [] } : { module: 'app', moduleLabel: '', keywords: [] as string[] };
  };
  for (const e of rt.search.entries()) {
    const f = e.focus as Record<string, string>;
    if (e.kind === 'view' && f.view) { const m = mod(`view:${f.view}`); out.push({ ...m, kind: 'page', view: f.view, action: `nav:${f.view}`, label: e.label, icon: e.icon, keywords: [...m.keywords, ...(e.keywords ?? [])], requires: e.requires }); }
    else if (e.kind === 'dialog' && f.id) { const m = mod(`dialog:${f.id}`); if (m.module === selfId) continue; out.push({ ...m, kind: 'dialog', action: `dialog:${f.id}`, label: e.label, icon: e.icon, keywords: [...m.keywords, ...(e.keywords ?? [])], requires: e.requires }); }
    else if (e.kind === 'settings-tab' && f.tab) { const m = mod(`settings-tab:${f.tab}`); out.push({ ...m, kind: 'settings', action: `settings.open:${f.tab}`, label: e.label, icon: e.icon, keywords: [...m.keywords, ...(e.keywords ?? [])], requires: e.requires }); }
  }
  // the shared application menu + contributions (never our own generated one, never our own items)
  const menuId = sharedAssetId(rt, 'app-menu', genId);
  const menuAsset = menuId ? rt.registry.get('app-menu', menuId) : undefined;
  if (menuAsset) {
    const merged = mergeAppMenu(menuAsset.data, rt.appMenuContributed().filter((c) => c.module !== selfId));
    const walk = (items: readonly MergedMenuItem[], hint: string, hintId: string, trail: string[]) => {
      for (const it of items) {
        if (it.separator) continue;
        const m = it.origin === 'asset' ? mod(undefined) : { ...mod(`lib:${it.origin}`), module: it.origin };
        const base = { ...m, label: it.label, icon: it.icon, hint, hintId, keywords: [...m.keywords, ...trail], requires: it.requires, badge: it.badge, shortcut: it.shortcut };
        if (it.provider) out.push({ ...base, kind: 'list', provider: it.provider });
        else if (it.action && it.action !== JUMP_ACTION) out.push({ ...base, action: it.action });
        if (it.items) walk(it.items, hint, hintId, [...trail, it.label ?? ''].filter(Boolean));
      }
    };
    for (const m of merged.menus) if (m.origin !== selfId) walk(m.items, m.label, m.id, []);
  }
  // the shared navigation + the sections libraries add
  const navId = sharedAssetId(rt, 'nav-menu', genId);
  const navAsset = navId ? rt.registry.get('nav-menu', navId) : undefined;
  const walkNav = (items: readonly NavItem[], hint: string | undefined, m: ReturnType<typeof mod>) => {
    for (const it of items) {
      if (it.view) out.push({ ...m, kind: /^apps$/i.test(hint ?? '') ? 'app' : 'page', view: it.view, action: `nav:${it.view}`, label: it.label, icon: it.icon, requires: it.requires, badge: it.badge, hint, hintId: hint });
      if (it.items) walkNav(it.items, hint ?? it.label, m);
    }
  };
  for (const s of navAsset?.data.sections ?? []) walkNav(s.items, s.label ?? undefined, mod(undefined));
  for (const s of rt.navExtras) if (s.id !== selfId) walkNav(s.items, s.label, { ...mod(`lib:${s.id}`), module: s.id });
  return [...out, ...extra];
}

/* ---------------- the library ---------------- */

export function generatedMenusLibrary(cfg: GeneratedMenusConfig): AxfWebLibrary {
  const tab = cfg.settingsTab ?? 'menus';
  let rt: AxfRuntime | null = null;
  let gen: GeneratedMenuAssets | null = null;
  let last = '';
  let genId = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };

  const toast = (msg: string, kind: 'info' | 'success' | 'warning' | 'danger' = 'info') => rt?.toast(msg, kind, 'Menus');

  function regenerate(force = false): GeneratedMenuAssets | null {
    if (!rt) return null;
    const app = cfg.app ?? rt.manifest.app.id;
    const appLabel = cfg.appLabel ?? rt.manifest.app.name;
    genId = `${app.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}${GENERATED_SUFFIX}`.slice(0, 48);
    const sources = collectMenuSources(rt, cfg.id, genId, cfg.extraSources?.(rt) ?? []);
    const next = generateMenuAssets(sources, { ...menuOptionsFrom(rt), app, appLabel, header: appLabel });
    const text = JSON.stringify([next.appMenu.data, next.navMenu.data]);
    if (text === last && !force) return gen;
    last = text;
    gen = next;
    for (const asset of [next.appMenu, next.navMenu]) {
      const r = rt.registry.has(asset.type as AssetType, asset.id) ? rt.hotReplaceAsset(asset, cfg.id) : rt.registry.register(asset, 'app', cfg.id);
      if (!r.ok) rt.terminal.warn('menus', `generated ${asset.type} not accepted: ${r.errors.join('; ')}`);
    }
    rt.terminal.log('menus', `generated: ${next.stats.placed} entries, ${next.stats.categories} categories, widest ${next.stats.widest}, deepest ${next.stats.deepest}`);
    notify();
    return gen;
  }

  /** Swap the generated assets in (override on) or the shared ones back (off). Only once the saved look is known. */
  function applyOverride() {
    if (!rt || !genId || !rt.appearanceReady()) return;
    const want = overrideOn(rt);
    const active = rt.getState().active;
    for (const type of ['app-menu', 'nav-menu'] as const) {
      if (!rt.registry.has(type, genId)) continue;
      if (want && active[type] !== genId) {
        const prev = rt.settings.get(K.previous);
        const saved = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, string>) : {};
        if (active[type] && active[type] !== genId) rt.settings.set(K.previous, JSON.parse(JSON.stringify({ ...saved, [type]: active[type] })));
        if (rt.can('assets.swap') && !rt.lockedByAppearance('assets.swap')) rt.swap(type, genId);
      } else if (!want && active[type] === genId) {
        const back = sharedAssetId(rt, type, genId);
        if (back && rt.can('assets.swap') && !rt.lockedByAppearance('assets.swap')) rt.swap(type, back);
      }
    }
  }

  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; regenerate(); applyOverride(); }, DEBOUNCE_MS); };

  function entryById(id: string): MenuIndexEntry | undefined { return gen?.index.find((e) => e.id === id); }
  function runEntry(e: MenuIndexEntry): boolean {
    if (!rt) return false;
    if (e.action) return rt.dispatch(e.action);
    if (e.provider) { rt.toast(`${e.label} is a live list: open it from the menu.`, 'info', 'Menus'); return false; }
    return false;
  }
  function currentEntryId(): string { const s = rt?.getState(); return s?.dialog && s.dialog.id !== JUMP_DIALOG ? `dialog:${s.dialog.id}` : `page:${s?.view ?? ''}`; }
  function setFavorite(id: string, on?: boolean) {
    if (!rt) return;
    const next = toggleFavorite(asList(rt.settings.get(K.favorites)), id, on);
    rt.settings.set(K.favorites, next);
    const e = entryById(id);
    toast(`${e?.label ?? id} ${next.includes(id) ? 'pinned to' : 'removed from'} Favourites.`, 'success');
  }
  const argsOf = (args: string[], payload?: string) => (args.length ? args : payload ? [payload] : []);

  const lib: AxfWebLibrary = {
    id: cfg.id,
    label: cfg.label ?? 'Menus',
    version: cfg.version ?? '0.1.0',
    ...(cfg.builtWith ? { builtWith: cfg.builtWith } : {}),
    provides: [`dialog:${JUMP_DIALOG}`, `settings-tab:${tab}`],
    register(runtime) {
      rt = runtime;
      const on = runtime.actions.register.bind(runtime.actions);
      on(JUMP_ACTION, (args, ctx) => {
        const q = argsOf(args, ctx.payload).join(' ').trim();
        if (!q) return runtime.openDialog(JUMP_DIALOG);
        const hits = gen ? searchMenuIndex(gen.index, q, { max: 2, favorites: asList(runtime.settings.get(K.favorites)), recents: asList(runtime.settings.get(K.recents)) }) : [];
        if (hits.length === 1 || (hits.length > 1 && hits[0]!.label.toLowerCase() === q.toLowerCase())) { runEntry(hits[0]!); return; }
        runtime.openDialog(JUMP_DIALOG, { query: q });
      }, { label: 'Jump to a menu entry…', params: true });
      on('menus.open', (args, ctx) => { const id = argsOf(args, ctx.payload).join(':'); const e = id ? entryById(id) : undefined; if (!e) return toast(`No menu entry "${id}".`, 'warning'); runEntry(e); }, { label: 'Open a generated-menu entry by id', params: true, searchable: false });
      on('menus.favorite', (args, ctx) => {
        const a = argsOf(args, ctx.payload);
        const raw = a[0] && a[0] !== 'toggle' && a[0] !== 'on' && a[0] !== 'off' ? a[0] : '';
        const id = !raw ? currentEntryId() : raw.includes(':') ? raw : `page:${raw}`;
        const flag = a.find((x) => x === 'on' || x === 'off');
        setFavorite(id, flag === undefined ? undefined : flag === 'on');
      }, { label: 'Pin the current page to Favourites (toggle)' });
      on('menus.override', (args, ctx) => {
        const a = argsOf(args, ctx.payload)[0] ?? 'toggle';
        const now = overrideOn(runtime);
        const next = a === 'toggle' ? !now : /^(on|true|1|yes)$/i.test(a);
        runtime.settings.set(K.override, next);
        regenerate(); applyOverride();
        toast(next ? 'Generated nested menus are on.' : 'Back to the shared menus.', 'success');
      }, { label: 'Generated nested menus on / off' });
      on('menus.generate', () => { const g = regenerate(true); applyOverride(); if (g) toast(`${g.stats.placed} entries in ${g.stats.categories} categories; widest level ${g.stats.widest}, deepest ${g.stats.deepest}.`, 'success'); }, { label: 'Regenerate the menus now' });
      on('menus.set', (args, ctx) => {
        const a = argsOf(args, ctx.payload);
        const field = a[0] ?? '';
        const value = parseFieldValue(field, a.slice(1).join(':'));
        const errors = menuFieldErrors(field, value);
        if (errors.length) return toast(errors.join('; '), 'danger');
        runtime.settings.set((K as Record<string, string>)[field]!, value as never);
        schedule();
        toast(`${NESTED_MENU_FIELDS[field as keyof typeof NESTED_MENU_FIELDS].title}: ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}.`, 'success');
      }, { label: 'Change one menu setting (field:value)', params: true });
      on('menus.get', () => { const g = gen ?? regenerate(); const o = menuOptionsFrom(runtime); if (g) toast(`${g.stats.placed} entries, ${g.stats.categories} categories, cap ${o.maxPerLevel}, override ${overrideOn(runtime) ? 'on' : 'off'}.`); return { stats: g?.stats, settings: { ...o, override: overrideOn(runtime) }, assets: { appMenu: g?.appMenu.id, navMenu: g?.navMenu.id } }; }, { label: 'Menu generator status' });
      on('menus.outline', () => { const g = gen ?? regenerate(); return g ? treeOutline(g.tree) : ''; }, { label: 'The generated menu tree as text', searchable: false });
      on('menus.recents.clear', () => { runtime.settings.clear(K.recents); toast('Recent list cleared.', 'success'); }, { label: 'Clear the Recent list' });
      on('menus.favorites.clear', () => { runtime.settings.clear(K.favorites); toast('Favourites cleared.', 'success'); }, { label: 'Clear Favourites' });
      on('menus.settings', () => runtime.dispatch(`settings.open:${tab}`), { label: 'Menu settings…' });

      // recents: every page shown and dialog opened (ours excepted), newest first
      let lastView = runtime.getState().view;
      let lastDialog = runtime.getState().dialog?.id ?? '';
      const remember = (id: string) => { const max = asNum(runtime.settings.get(K.recentsMax), NESTED_MENU_DEFAULTS.recentsMax); if (max > 0) runtime.settings.set(K.recents, pushRecent(asList(runtime.settings.get(K.recents)), id, max)); };
      runtime.subscribe(() => {
        const s = runtime.getState();
        if (s.view !== lastView) { lastView = s.view; if (s.view) remember(`page:${s.view}`); }
        const d = s.dialog?.id ?? '';
        if (d !== lastDialog) { lastDialog = d; if (d && d !== JUMP_DIALOG) remember(`dialog:${d}`); }
        schedule();
      });
      runtime.settings.onAnyChange((key) => { if (key.startsWith('axf.menus.')) schedule(); });
      // the other libraries are still registering: generate once they are in, then keep up
      setTimeout(() => { regenerate(); applyOverride(); }, 0);
    },
    dialogs: {
      [JUMP_DIALOG]: { title: 'Jump to…', icon: 'search', searchable: false, render: (props, close) => <JumpDialog query={typeof props.query === 'string' ? props.query : ''} close={close} index={() => gen?.index ?? []} /> },
    },
    settingsTabs: [{ id: tab, label: 'Menus', icon: 'menu', order: 36, parent: cfg.settingsParent ?? 'plugins', description: 'The generated nested menus: categories, favourites, recents and the override of the shared menus.' }],
    settingsPanels: [
      { id: `${tab}.general`, tab, title: 'General', icon: 'sliders', order: 10, render: () => <GeneralPanel regenerate={() => { regenerate(true); applyOverride(); }} gen={() => gen} subscribe={(fn) => { listeners.add(fn); return () => listeners.delete(fn); }} /> },
      { id: `${tab}.categories`, tab, title: 'Categories', icon: 'layers', order: 20, render: () => <CategoriesPanel gen={() => gen} subscribe={(fn) => { listeners.add(fn); return () => listeners.delete(fn); }} /> },
      { id: `${tab}.favorites`, tab, title: 'Favourites', icon: 'star', order: 30, render: () => <FavoritesPanel gen={() => gen} /> },
      { id: `${tab}.recents`, tab, title: 'Recent', icon: 'clock', order: 40, render: () => <RecentsPanel gen={() => gen} /> },
      { id: `${tab}.preview`, tab, title: 'Preview', icon: 'eye', order: 50, render: () => <PreviewPanel gen={() => gen} subscribe={(fn) => { listeners.add(fn); return () => listeners.delete(fn); }} /> },
    ],
    appMenu: [
      { id: `${cfg.id}.view`, menu: 'view', menuLabel: 'View', menuOrder: 60, order: 30, items: [
        { id: 'menus.override', label: 'Generated nested menus', icon: 'menu', action: 'menus.override:toggle', checked: `setting:${K.override}` },
        { id: 'menus.jump', label: 'Jump to…', icon: 'search', action: JUMP_ACTION, shortcut: 'Ctrl+Shift+K' },
      ] },
    ],
    contextMenu: [
      { id: `${cfg.id}.ctx.nav-item`, target: 'nav-item', items: [{ id: 'menus.ctx.favorite', label: 'Pin / unpin in Favourites', icon: 'star', action: 'menus.favorite' }] },
      { id: `${cfg.id}.ctx.nav`, target: 'nav', items: [{ id: 'menus.ctx.nav.settings', label: 'Menu settings…', icon: 'menu', action: 'menus.settings' }, { id: 'menus.ctx.nav.jump', label: 'Jump to…', icon: 'search', action: JUMP_ACTION }] },
      { id: `${cfg.id}.ctx.app-menu`, target: 'app-menu', items: [{ id: 'menus.ctx.menu.override', label: 'Generated nested menus', icon: 'menu', action: 'menus.override:toggle', checked: `setting:${K.override}` }, { id: 'menus.ctx.menu.generate', label: 'Regenerate menus', icon: 'refresh', action: 'menus.generate' }, { id: 'menus.ctx.menu.settings', label: 'Menu settings…', icon: 'settings', action: 'menus.settings' }] },
    ],
  };
  return lib;
}

/* ---------------- jump-to dialog ---------------- */

function JumpDialog({ query, close, index }: { query: string; close: () => void; index: () => MenuIndexEntry[] }) {
  const rt = useRuntime();
  useAxfState();
  const [q, setQ] = useState(query);
  const box = useRef<HTMLDivElement>(null);
  const favorites = asList(rt.settings.get(K.favorites));
  const recents = asList(rt.settings.get(K.recents));
  const all = index();
  const hits = useMemo(() => (q.trim() ? searchMenuIndex(all, q, { max: 12, favorites, recents }) : [...favorites, ...recents].map((id) => all.find((e) => e.id === id)).filter((e): e is MenuIndexEntry => !!e).slice(0, 12)), [all, q, favorites, recents]);
  useEffect(() => { box.current?.querySelector('input')?.focus(); }, []);
  const items: MenuItem[] = hits.filter((e) => e.action).map((e) => ({ id: e.id, label: e.label, icon: e.icon ?? 'layout', action: e.action!, requires: e.requires }));
  const run = () => { const e = hits.find((h) => h.action); if (e?.action) { rt.dispatch(e.action); close(); } };
  return (
    <div className="fx-stack" ref={box} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } }}>
      <TextField label="Jump to" value={q} onChange={setQ} placeholder="A page, dialog, setting or action…" autoFocus />
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        {q.trim() ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} · ` : 'Favourites and recent first · '}
        <Kbd>Enter</Kbd> opens the first · <Kbd>Esc</Kbd> closes
      </p>
      {items.length ? <MenuList items={items} onDone={close} showShortcuts={false} /> : <Note tone="info" icon="search">Nothing matches yet. Try a word from the page or plugin name.</Note>}
      {hits[0] && <div className="fx-row fx-row--wrap"><span className="fx-small fx-muted">{hits[0].path.join(' › ')}</span><Button icon="star" size="sm" onClick={() => rt.dispatch(`menus.favorite:${hits[0]!.id}`)}>{favorites.includes(hits[0].id) ? 'Unpin' : 'Pin'} “{hits[0].label}”</Button></div>}
    </div>
  );
}

/* ---------------- settings panels (one collapsible section per group) ---------------- */

type Gen = () => GeneratedMenuAssets | null;
type Sub = (fn: () => void) => () => void;

function useGen(gen: Gen, subscribe?: Sub): GeneratedMenuAssets | null {
  const [, tick] = useState(0);
  useEffect(() => subscribe?.(() => tick((n) => n + 1)), [subscribe]);
  useAxfState();
  return gen();
}

function Section({ title, icon, open = true, children }: { title: string; icon: string; open?: boolean; children: ReactNode }) {
  return <Container title={title} icon={icon} collapsible defaultOpen={open}>{children}</Container>;
}

function GeneralPanel({ regenerate, gen, subscribe }: { regenerate: () => void; gen: Gen; subscribe: Sub }) {
  const rt = useRuntime();
  const g = useGen(gen, subscribe);
  const o = menuOptionsFrom(rt);
  const set = (k: string, v: boolean | number | string) => rt.settings.set(k, v);
  return (
    <div className="fx-stack">
      <Section title="Override" icon="menu">
        <Switch label={NESTED_MENU_FIELDS.override.title} hint={NESTED_MENU_FIELDS.override.text} checked={overrideOn(rt)} onChange={(v) => rt.dispatch(`menus.override:${v ? 'on' : 'off'}`)} />
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={regenerate}>Regenerate now</Button>
          <Button icon="search" onClick={() => rt.dispatch(JUMP_ACTION)}>Jump to…</Button>
          {g && <Chip tone="accent">{g.stats.placed} entries · {g.stats.categories} categories · widest {g.stats.widest} · deepest {g.stats.deepest}</Chip>}
        </div>
        {g?.notes.map((n) => <Note key={n} tone="warning" icon="alert">{n}</Note>)}
      </Section>
      <Section title="Shape" icon="sliders">
        <Slider label={NESTED_MENU_FIELDS.maxPerLevel.title} value={o.maxPerLevel ?? 12} min={NESTED_MENU_FIELDS.maxPerLevel.min} max={NESTED_MENU_FIELDS.maxPerLevel.max} onChange={(v) => set(K.maxPerLevel, v)} unit=" rows" />
        <Switch label={NESTED_MENU_FIELDS.groupByPlugin.title} hint={NESTED_MENU_FIELDS.groupByPlugin.text} checked={o.groupByPlugin !== false} onChange={(v) => set(K.groupByPlugin, v)} />
        <SelectField label={NESTED_MENU_FIELDS.style.title} hint={NESTED_MENU_FIELDS.style.text} value={o.style ?? 'list'} options={(NESTED_MENU_FIELDS.style.options ?? []).map((v) => ({ value: v, label: v === 'list' ? 'List (sub menus slide open)' : v === 'rail' ? 'Icon rail' : 'Pills' }))} onChange={(v) => set(K.style, v)} />
      </Section>
    </div>
  );
}

function CategoriesPanel({ gen, subscribe }: { gen: Gen; subscribe: Sub }) {
  const rt = useRuntime();
  const g = useGen(gen, subscribe);
  const hidden = asList(rt.settings.get(K.hidden));
  const counts = g?.stats.perCategory ?? {};
  return (
    <Section title="Categories" icon="layers">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Every entry lands in one of these by its words; a plugin can declare its own (`menu.category` in plugin.json). Switch a category off to leave its entries to search only.</p>
      <div className="fx-stack">
        {MENU_CATEGORIES.map((c) => (
          <div key={c.id} className="fx-row fx-row--wrap">
            <Icon name={c.icon} size={14} />
            <Switch label={`${c.label}${counts[c.id] ? ` (${counts[c.id]})` : ''}`} checked={!hidden.includes(c.id)} onChange={(v) => rt.settings.set(K.hidden, v ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function EntryRows({ ids, gen, onRemove }: { ids: string[]; gen: Gen; onRemove: (id: string) => void }) {
  const rt = useRuntime();
  const g = gen();
  if (!ids.length) return <p className="fx-small fx-muted" style={{ margin: 0 }}>Nothing here yet.</p>;
  return (
    <div className="fx-stack">
      {ids.map((id) => {
        const e = g?.index.find((x) => x.id === id);
        return (
          <div key={id} className="fx-row fx-row--wrap">
            <Icon name={e?.icon ?? 'layout'} size={14} />
            <span>{e?.label ?? id}</span>
            <span className="fx-small fx-muted">{e?.path.join(' › ') ?? ''}</span>
            {e?.action && <Button size="sm" icon="external" onClick={() => rt.dispatch(e.action!)}>Open</Button>}
            <Button size="sm" icon="x" onClick={() => onRemove(id)}>Remove</Button>
          </div>
        );
      })}
    </div>
  );
}

function FavoritesPanel({ gen }: { gen: Gen }) {
  const rt = useRuntime();
  useAxfState();
  const favorites = asList(rt.settings.get(K.favorites));
  return (
    <Section title="Favourites" icon="star">
      <Switch label={NESTED_MENU_FIELDS.showFavorites.title} hint={NESTED_MENU_FIELDS.showFavorites.text} checked={asBool(rt.settings.get(K.showFavorites), true)} onChange={(v) => rt.settings.set(K.showFavorites, v)} />
      <div className="fx-row fx-row--wrap">
        <Button icon="star" onClick={() => rt.dispatch('menus.favorite')}>Pin the current page</Button>
        <Button icon="trash" onClick={() => rt.dispatch('menus.favorites.clear')} disabled={!favorites.length}>Clear</Button>
      </div>
      <EntryRows ids={favorites} gen={gen} onRemove={(id) => rt.dispatch(`menus.favorite:${id}:off`)} />
    </Section>
  );
}

function RecentsPanel({ gen }: { gen: Gen }) {
  const rt = useRuntime();
  useAxfState();
  const recents = asList(rt.settings.get(K.recents));
  return (
    <Section title="Recent" icon="clock" open={false}>
      <Switch label={NESTED_MENU_FIELDS.showRecents.title} hint={NESTED_MENU_FIELDS.showRecents.text} checked={asBool(rt.settings.get(K.showRecents), true)} onChange={(v) => rt.settings.set(K.showRecents, v)} />
      <Slider label={NESTED_MENU_FIELDS.recentsMax.title} value={asNum(rt.settings.get(K.recentsMax), NESTED_MENU_DEFAULTS.recentsMax)} min={NESTED_MENU_FIELDS.recentsMax.min} max={NESTED_MENU_FIELDS.recentsMax.max} onChange={(v) => rt.settings.set(K.recentsMax, v)} />
      <div className="fx-row"><Button icon="trash" onClick={() => rt.dispatch('menus.recents.clear')} disabled={!recents.length}>Clear</Button></div>
      <EntryRows ids={recents} gen={gen} onRemove={(id) => rt.settings.set(K.recents, recents.filter((x) => x !== id))} />
    </Section>
  );
}

function PreviewPanel({ gen, subscribe }: { gen: Gen; subscribe: Sub }) {
  const g = useGen(gen, subscribe);
  return (
    <Section title="Preview" icon="eye" open={false}>
      {g ? <pre className="fx-small" style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--fx-font-mono)' }}>{treeOutline(g.tree)}</pre> : <p className="fx-small fx-muted" style={{ margin: 0 }}>Not generated yet.</p>}
    </Section>
  );
}

export { FAVORITES_ID };

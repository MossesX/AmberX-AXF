/**
 * One shell's model (pure apart from the runtime it reads): the surfaces Molly knows (shell-surface@1), the one menu
 * index over them (menu-index@1), favorites, recents, opening a ref, and named layouts (xlayout@1).
 *
 * Where the surfaces come from, newest first:
 *   1. native surfaces: an app's native mount (molly-one-shell s7/s8) registers its surface and an opener through the
 *      capability `axf.shell@1` (`register`). Nothing is written by hand per app.
 *   2. Molly's own surface, from its live search index (every view, action, settings tab, setting, dialog and menu item
 *      Molly and its plugins register), so a new plugin shows up by itself.
 *   3. Stopgap until the native mounts land: the apps' chrome xLayout already receives (their navigation, menus and
 *      toolbars as data, `axf.xlayout@1` → `chrome()`), turned into surfaces and opened through xLayout. It goes with
 *      Molly's frames in molly-one-shell s11; a native surface for the same app always replaces it.
 */
import type { AxfRuntime } from '../../../src/axf/core';
import type { UnifiedChrome, UnifiedMenuItem } from '../../../src/axf/core/engines/chrome';
import { buildMenuIndex, pruneRefs, pushRecent, toggleFavorite, type MenuIndex } from '../../../src/axf/core/engines/menu-index';
import { mergeSurfaces, parseRef, resolveRef, SHELL_SURFACE_CONTRACT, surfaceFromSearch, type ShellSurface, type SurfaceItem } from '../../../src/axf/core/engines/shell-surface';
import { normalizeXLayout, parseNamedLayout, removeLayout, saveLayout, type LayoutMode, type OpenTarget, type XLayoutData, type XNamedLayout } from '../../../src/axf/core/engines/xlayout';
import { mollyService } from '../../../src/molly/host';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';

export const PLUGIN_ID = 'ai.amberx.axf.molly.shell';
export const FOLDER = 'shell';
export const SHELL_SERVICE = 'axf.shell@1';
const XLAYOUT_SERVICE = 'axf.xlayout@1';

/** Settings keys (one value each; last save wins). */
export const K = {
  favorites: 'shell.favorites',
  recents: 'shell.recents',
  maxPerLevel: 'shell.menu.maxPerLevel',
  hiddenApps: 'shell.menu.hiddenApps',
  layouts: 'shell.layouts',
  active: 'shell.layout.active',
  dock: (id: string) => `shell.layout.dock.${id}`,
} as const;

/** What xLayout offers (its capability, `axf.xlayout@1`); only the parts One shell uses. */
interface XLayoutLike {
  chrome(): UnifiedChrome;
  run(item: { id: string; label: string; app?: string; action: string; open: OpenTarget }): void;
  mode(): { mode: LayoutMode; preset: string };
  setMode(mode: LayoutMode, preset?: string): boolean;
  snapshot(): unknown;
  restore(snapshot: unknown): boolean;
}
export const xlayout = () => mollyService<XLayoutLike>(XLAYOUT_SERVICE);

/** Opens one of a native surface's items; true when it did. */
export type SurfaceOpener = (item: SurfaceItem, target: OpenTarget) => boolean;
interface Registered { surface: ShellSurface; open: SurfaceOpener | null }

/** One shell's capability (`axf.shell@1`): native app mounts register here; anyone can read or open. */
export interface ShellService {
  /** register an app's surface (shell-surface@1) and how to open its items; returns the remover */
  register(surface: unknown, open?: SurfaceOpener): () => void;
  surfaces(): ShellSurface[];
  index(): MenuIndex;
  open(ref: string, target?: OpenTarget): boolean;
}

const parseList = (v: unknown): string[] => { if (typeof v !== 'string' || !v) return []; try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };

export class ShellModel {
  private readonly native = new Map<string, Registered>();
  private readonly listeners = new Set<() => void>();
  rev = 0;
  constructor(private readonly rt: AxfRuntime) {}

  subscribe(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  changed(): void { this.rev++; this.listeners.forEach((f) => f()); }

  register(raw: unknown, open?: SurfaceOpener): () => void {
    const [s] = mergeSurfaces([raw]);
    if (!s) { this.rt.terminal.warn('shell', 'a surface was refused (not shell-surface@1, or not a native mount)'); return () => {}; }
    const entry: Registered = { surface: s, open: open ?? null };
    this.native.set(s.app.id, entry);
    this.changed();
    return () => { if (this.native.get(s.app.id) === entry) { this.native.delete(s.app.id); this.changed(); } };
  }

  /** Molly's own surface: its live search index, without the apps' pages (those are the apps' own). */
  private mollySurface(): ShellSurface | null {
    const entries = this.rt.search.entries().filter((e) => {
      if (e.kind !== 'view') return true;
      const v = (e.focus as { view?: string }).view ?? '';
      return !mollyApp(v.split('/')[0]);
    });
    return surfaceFromSearch({ id: 'molly', label: 'Molly', icon: 'home' }, { kind: 'native', module: 'molly', auth: 'none' }, entries);
  }

  /** Stopgap: an app's chrome as xLayout received it (navigation, menus, toolbars) as its surface. */
  private chromeSurfaces(): ShellSurface[] {
    // every app is in the menu with at least its home screen; its pages, menus and toolbar join once xLayout has them
    let chrome: UnifiedChrome | null = null;
    try { chrome = xlayout()?.chrome() ?? null; } catch { chrome = null; }
    const nav = chrome?.nav ?? [], menus = chrome?.menus ?? [], toolbars = chrome?.toolbars ?? [];
    const out: unknown[] = [];
    for (const a of MOLLY_APPS) {
      if (this.native.has(a.id)) continue; // a native surface replaces the stopgap
      const items: Record<string, unknown>[] = [{ kind: 'screen', id: 'home', label: a.label, icon: a.icon, detail: a.description }];
      const strip = (id: string) => (id.startsWith(`${a.id}:`) ? id.slice(a.id.length + 1) : id);
      for (const sec of nav.filter((s) => s.app === a.id)) for (const it of sec.items) items.push({ kind: 'screen', id: strip(it.id), label: it.label, icon: it.icon, ...(sec.label && sec.label !== a.label ? { category: ['Screens', sec.label] } : {}) });
      const walk = (list: UnifiedMenuItem[], path: string[]) => {
        for (const it of list) {
          if (it.separator || it.locked) continue;
          if (it.items?.length) { walk(it.items, [...path, it.label]); continue; }
          items.push({ kind: 'menu', id: strip(it.id), label: it.label, icon: it.icon, category: ['Menus', ...path].slice(0, 4) });
        }
      };
      for (const m of menus.filter((m) => m.app === a.id)) walk(m.items, m.label === a.label ? [] : [m.label]);
      for (const t of toolbars.filter((t) => t.app === a.id)) for (const it of t.items) if (!it.locked) items.push({ kind: 'action', id: strip(it.id), label: it.label, icon: it.icon, category: ['Toolbar'] });
      out.push({ $axf: SHELL_SURFACE_CONTRACT, app: { id: a.id, label: a.label, icon: a.icon, url: a.url, description: a.description }, mount: { kind: 'native', module: `@axf-stopgap/xlayout-${a.id}`, auth: 'none' }, items });
    }
    return mergeSurfaces(out);
  }

  /** Is this app's surface the stopgap (still shown through xLayout) rather than native? */
  isStopgap(app: string): boolean { return !this.native.has(app) && !!mollyApp(app); }

  surfaces(): ShellSurface[] {
    const own = this.mollySurface();
    return mergeSurfaces([...(own ? [own] : []), ...this.chromeSurfaces(), ...[...this.native.values()].map((r) => r.surface)]);
  }

  favorites(): string[] { return parseList(this.rt.settings.get(K.favorites)); }
  recents(): string[] { return parseList(this.rt.settings.get(K.recents)); }
  hiddenApps(): string[] { return parseList(this.rt.settings.get(K.hiddenApps)); }
  maxPerLevel(): number { const n = Number(this.rt.settings.get(K.maxPerLevel)); return Number.isFinite(n) && n > 0 ? n : 12; }

  index(opts: { kinds?: string[] } = {}): MenuIndex {
    return buildMenuIndex(this.surfaces(), { favorites: this.favorites(), recents: this.recents(), maxPerLevel: this.maxPerLevel(), hiddenApps: this.hiddenApps(), appOrder: ['molly', ...MOLLY_APPS.map((a) => a.id)], kinds: opts.kinds, allowed: (p) => this.rt.can(p) });
  }

  toggleFavorite(ref: string): boolean {
    const next = toggleFavorite(this.favorites(), ref);
    this.rt.settings.set(K.favorites, JSON.stringify(next));
    this.changed();
    return next.includes(ref);
  }
  clearRecents(): void { this.rt.settings.clear(K.recents); this.changed(); }
  pruneSaved(): void { const idx = this.index(); this.rt.settings.set(K.favorites, JSON.stringify(pruneRefs(this.favorites(), idx))); this.rt.settings.set(K.recents, JSON.stringify(pruneRefs(this.recents(), idx))); this.changed(); }

  /** Open a ref (`<app>:<kind>:<id>`) in the main area, a floating window or a pane; it joins the recents. */
  open(ref: string, target: OpenTarget = 'main'): boolean {
    const hit = resolveRef(this.surfaces(), ref);
    if (!hit) { this.rt.toast(`Nothing called ${ref} is in Molly's menus.`, 'warning', 'Open'); return false; }
    const { surface, item } = hit;
    let done = false;
    const native = this.native.get(surface.app.id);
    if (native?.open) done = native.open(item, target);
    else if (surface.app.id === 'molly') done = this.openOwn(item);
    else done = this.openStopgap(surface.app.id, item, target);
    if (done) { this.rt.settings.set(K.recents, JSON.stringify(pushRecent(this.recents(), ref))); this.changed(); }
    return done;
  }

  private openOwn(item: SurfaceItem): boolean {
    switch (item.kind) {
      case 'screen': this.rt.navigate(item.id); return true;
      case 'dialog': this.rt.openDialog(item.id); return true;
      case 'settings': return this.rt.dispatch(`settings.open:${item.id}`);
      case 'setting': return this.rt.dispatch(`settings.open:${item.parent ?? ''}`);
      default: return this.rt.dispatch(item.id);
    }
  }

  private openStopgap(app: string, item: SurfaceItem, target: OpenTarget): boolean {
    if (item.id === 'home' && item.kind === 'screen') { this.rt.navigate(app); return true; }
    const x = xlayout();
    if (!x) { this.rt.navigate(app); return true; }
    x.run({ id: `${app}.${item.id}`, label: item.label, app, action: `${app}:${item.id}`, open: target });
    return true;
  }

  /* ---------- named layouts ---------- */

  private layoutData(): XLayoutData {
    let layouts: unknown = [];
    try { layouts = JSON.parse(String(this.rt.settings.get(K.layouts) ?? '[]')); } catch { /* broken: none */ }
    return normalizeXLayout({ apps: [], layouts, active: this.rt.settings.get(K.active) ?? null });
  }
  layouts(): XNamedLayout[] { return this.layoutData().layouts; }
  activeLayout(): string | null { return this.layoutData().active; }

  /** Save what is on screen now (mode, preset, the dock arrangement) as a named layout. */
  saveLayout(label: string): XNamedLayout | null {
    const x = xlayout();
    const id = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layout';
    const { mode, preset } = x?.mode() ?? { mode: 'single' as LayoutMode, preset: 'single' };
    const l = parseNamedLayout({ id: id.length < 2 ? `${id}-1` : id, label, mode, preset });
    if (!l) return null;
    const d = saveLayout(this.layoutData(), l);
    this.rt.settings.set(K.layouts, JSON.stringify(d.layouts));
    this.rt.settings.set(K.active, d.active);
    const snap = x?.snapshot();
    if (snap) this.rt.settings.set(K.dock(l.id), JSON.stringify(snap)); else this.rt.settings.clear(K.dock(l.id));
    this.changed();
    return l;
  }

  /** Switch to a named layout: its mode and preset, then its dock arrangement. */
  switchLayout(id: string): boolean {
    const l = this.layouts().find((x) => x.id === id);
    const x = xlayout();
    if (!l || !x) return false;
    x.setMode(l.mode, l.preset);
    const raw = this.rt.settings.get(K.dock(l.id));
    if (typeof raw === 'string' && raw) { try { x.restore(JSON.parse(raw)); } catch { /* the preset stands */ } }
    this.rt.settings.set(K.active, l.id);
    this.changed();
    return true;
  }

  removeLayout(id: string): void {
    const d = removeLayout(this.layoutData(), id);
    this.rt.settings.set(K.layouts, JSON.stringify(d.layouts));
    if (d.active) this.rt.settings.set(K.active, d.active); else this.rt.settings.clear(K.active);
    this.rt.settings.clear(K.dock(id));
    this.changed();
  }

  setMode(mode: LayoutMode): boolean {
    const x = xlayout();
    if (!x) { this.rt.toast('Layout modes need the xLayout plugin.', 'info', 'Layout'); return false; }
    const ok = x.setMode(mode);
    this.rt.settings.clear(K.active);
    this.changed();
    return ok;
  }
}

/** A ref's app label and item label, for toasts. */
export function describeRef(model: ShellModel, ref: string): string {
  const p = parseRef(ref);
  const hit = resolveRef(model.surfaces(), ref);
  return hit ? `${hit.surface.app.label} › ${hit.item.label}` : p ? `${p.app} › ${p.id}` : ref;
}

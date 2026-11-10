/**
 * One shell's model (pure apart from the runtime it reads): the surfaces Molly knows (shell-surface@1), the one menu
 * index over them (menu-index@1), favorites, recents, opening a ref, and named layouts (xlayout@1).
 *
 * Where the surfaces come from, newest first:
 *   1. native surfaces: an app's native mount (molly-one-shell s7/s8) registers its surface and an opener through the
 *      capability `axf.shell@1` (`register`). Nothing is written by hand per app.
 *   2. Molly's own surface, from its live search index (every view, action, settings tab, setting, dialog and menu item
 *      Molly and its plugins register), so a new plugin shows up by itself.
 *   3. An app with no native surface yet (Expenses) or still loading: listed with its home entry only; it opens its
 *      screen in Molly (loading, or "open it on its own"). Never a frame (the frame stopgap went in molly-one-shell s11).
 */
import type { AxfRuntime } from '../../../src/axf/core';
import type { UnifiedChrome } from '../../../src/axf/core/engines/chrome';
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

  /** Apps not (yet) registered natively: their home entry only, so every app is always in the menu. */
  private pendingSurfaces(): ShellSurface[] {
    return mergeSurfaces(MOLLY_APPS.filter((a) => !this.native.has(a.id)).map((a) => ({
      $axf: SHELL_SURFACE_CONTRACT, app: { id: a.id, label: a.label, icon: a.icon, url: a.url, description: a.description },
      mount: { kind: 'native', module: `@axf-app/${a.id}`, auth: a.auth ?? 'none' },
      items: [{ kind: 'screen', id: 'home', label: a.label, icon: a.icon, detail: a.description }],
    })));
  }

  /** Has this app registered its native surface (its screens, actions and settings are in the menu)? */
  isNative(app: string): boolean { return app === 'molly' || this.native.has(app); }

  surfaces(): ShellSurface[] {
    const own = this.mollySurface();
    return mergeSurfaces([...(own ? [own] : []), ...this.pendingSurfaces(), ...[...this.native.values()].map((r) => r.surface)]);
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
    else if (item.kind === 'screen') { this.rt.navigate(surface.app.id); done = true; }
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

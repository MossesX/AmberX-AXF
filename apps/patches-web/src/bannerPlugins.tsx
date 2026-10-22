/**
 * The banner plugins Patches runs above every tab (Brett, Oct 22 2026: "port all the banner plugins to Patches and
 * install them; remove all banner plugins from console and pilot").
 *
 * - The plugins: every Dev Console plugin that contributes a banner, baked into src/plugins (scripts/bake-banner-plugins.mjs),
 *   plus the approvals banner, which moved here (it was only a banner). The console draws no plugin banners any more.
 * - Their server parts stay in the console (they read its data and its host). The baked web parts reach them through
 *   Patches' own server (`/api/console/...`, server/main.py), which holds the console token; the browser needs none.
 * - Installed in Patches: Patches' plugin list (server, app `patches`) has each of them, on by default, with a switch in
 *   Settings → Patches → Plugins. Only the ones switched on are loaded (lazily, so a plugin that is off never starts).
 * - What Patches runs of each: its banners, the dialogs they open and its settings (Banner settings shows them). Its
 *   pages, menus, search entries and context items belong to the console and stay there.
 * - A banner tap that names something only the console has (one of its views, or an action that opens one) brings the
 *   Console tab up and hands it over as an embed@1 `relay` message; the console runs it like its own tap.
 */
import type { AxfRuntime } from './axf/core';
import { ActionBus } from './axf/core';
import type { AxfWebLibrary } from './axf/react';

export interface BannerPluginManifest { id: string; name: string; version: string; description?: string }
export interface BannerPlugin { folder: string; manifest: BannerPluginManifest; owned: boolean }

const manifests = import.meta.glob('./plugins/*/plugin.json', { eager: true, import: 'default' }) as Record<string, BannerPluginManifest>;
const loaders = import.meta.glob('./plugins/*/web/index.tsx') as Record<string, () => Promise<{ plugin?: AxfWebLibrary }>>;
const folderOf = (path: string) => path.split('/')[2] ?? '';

/** Plugins whose code lives in Patches (not baked from the console): their actions run here. */
const OWNED = new Set(['approvals-banner']);

/** Every banner plugin Patches has, by name. */
export const BANNER_PLUGINS: BannerPlugin[] = Object.entries(manifests)
  .map(([path, manifest]) => ({ folder: folderOf(path), manifest, owned: OWNED.has(folderOf(path)) }))
  .filter((p) => p.manifest?.id && loaders[`./plugins/${p.folder}/web/index.tsx`])
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

/** Where a relayed banner tap goes: the app tab it came from (the Dev Console for every baked plugin). */
export type Relay = (kind: 'action' | 'view' | 'dialog', target: string) => void;

/** Views Patches itself has (its tabs, settings and what its libraries add); anything else is the console's. */
let knownView: (view: string) => boolean = () => true;
export function setKnownViews(fn: (view: string) => boolean): void { knownView = fn; }

/**
 * The runtime a baked plugin's `register` sees: the same runtime, except that
 * - the actions it registers note which action is running, so a jump to a console view from inside it hands the whole
 *   action to the console (which keeps whatever the action set up, e.g. which build to show);
 * - its search entries and context-menu extras are not added (they open console pages; the console has them).
 */
function facade(rt: AxfRuntime, relay: Relay): AxfRuntime {
  let running: string | null = null;
  const actions = new Proxy(rt.actions, {
    get(t, p) {
      if (p === 'register') {
        return (id: string, fn: Parameters<AxfRuntime['actions']['register']>[1], meta: Parameters<AxfRuntime['actions']['register']>[2]) =>
          t.register(id, (args, ctx) => {
            const before = running;
            running = args.length ? `${id}:${args.join(':')}` : id;
            try { return fn(args, ctx); } finally { running = before; }
          }, meta);
      }
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  const quiet = (obj: object, method: string) => new Proxy(obj, {
    get(t, p) {
      if (p === method) return () => () => undefined;
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return new Proxy(rt, {
    get(t, p) {
      if (p === 'actions') return actions;
      if (p === 'search') return quiet(t.search as object, 'add');
      if (p === 'contextExtras') return quiet(t.contextExtras as object, 'set');
      if (p === 'navigate') return (view: string) => {
        if (knownView(view)) return t.navigate(view);
        if (running) relay('action', running); else relay('view', view);
      };
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/** What Patches runs of a plugin: its banners, the dialogs they open, its settings; `register` through the facade. */
export function forPatches(lib: AxfWebLibrary, p: BannerPlugin, relay: Relay): AxfWebLibrary {
  return {
    id: lib.id,
    label: lib.label,
    version: lib.version,
    banners: lib.banners,
    dialogs: lib.dialogs,
    tabs: lib.tabs,
    settings: lib.settings,
    settingsPanels: lib.settingsPanels,
    // under Settings → Plugins, like every plugin's settings
    settingsTabs: lib.settingsTabs?.map((t) => ({ ...t, parent: t.parent ?? 'plugins' })),
    register: lib.register ? (rt) => lib.register!(p.owned ? rt : facade(rt, relay)) : undefined,
  };
}

const loaded = new Map<string, AxfWebLibrary>();
/** Load the web parts of these plugins (once each). A plugin that fails to load is skipped and said in the terminal. */
export async function loadBannerPlugins(rt: AxfRuntime, list: BannerPlugin[], relay: Relay): Promise<AxfWebLibrary[]> {
  const out: AxfWebLibrary[] = [];
  for (const p of list) {
    let lib = loaded.get(p.folder);
    if (!lib) {
      try {
        const mod = await loaders[`./plugins/${p.folder}/web/index.tsx`]!();
        if (!mod.plugin || mod.plugin.id !== p.manifest.id) throw new Error('its web part does not export the plugin');
        lib = forPatches(mod.plugin, p, relay);
        loaded.set(p.folder, lib);
      } catch (e) {
        rt.terminal.warn('plugins', `${p.manifest.name} not loaded: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    out.push(lib);
  }
  return out;
}

/**
 * Patches' runtime hands a banner's jump to a console page, or an action only the console has, to the Console tab
 * (`relay`). Installed once; Patches' own views and actions are untouched.
 */
export function relayUnknown(rt: AxfRuntime, relay: Relay): void {
  const g = rt as unknown as { __patchesRelay?: boolean; navigate: (v: string) => void; dispatch: AxfRuntime['dispatch'] };
  if (g.__patchesRelay) return;
  g.__patchesRelay = true;
  const navigate = rt.navigate.bind(rt);
  const dispatch = rt.dispatch.bind(rt);
  g.navigate = (view: string) => { if (knownView(view)) navigate(view); else relay('view', view); };
  g.dispatch = (spec, ctx) => {
    const { id } = ActionBus.parse(spec);
    if (id && !rt.actions.get(id) && !rt.takenByHost({ action: spec })) { relay('action', spec); return true; }
    return dispatch(spec, ctx);
  };
}

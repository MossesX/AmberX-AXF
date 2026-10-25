/*
 * Context menu designer — saved designs (server: /api/plugins/context-menu-designer/designs) and the bridge to the
 * runtime: every saved menu is registered as context-menu asset `ctxd-<id>` and every saved style goes into one
 * stylesheet (<style id="axp-ctxd-live">) scoped to the real context menu.
 */
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import { ASSET_PREFIX, compile, normalizeDesign, styleSheet, toAsset, type Design } from './core';

export const FOLDER = 'context-menu-designer';
export const ID = 'ai.amberx.axf.console.context-menu-designer';

const api = pluginApi(FOLDER, 'The context menu designer');

let designs: Design[] = [];
let loaded = false;
let lastError = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const getDesigns = () => designs;
export const loadError = () => lastError;
export const isLoaded = () => loaded;
export function subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** Register every saved menu as a context-menu asset and rewrite the live stylesheet. */
export function applyToRuntime(rt: AxfRuntime): void {
  const active = (rt.getState().active as Record<string, string>)['context-menu'];
  const css: string[] = [];
  for (const d of designs) {
    const c = compile(d, designs);
    css.push(styleSheet(c.styles, '.fx-ctx'));
    if (d.kind !== 'menu') continue;
    const base = d.base && !d.base.startsWith(ASSET_PREFIX) ? rt.registry.get('context-menu', d.base) : undefined;
    const others = { ...((base?.data as { targets?: Record<string, unknown> } | undefined)?.targets ?? {}) };
    delete others.default;
    const asset = toAsset(d, designs, others);
    rt.registry.register(asset, 'imported', 'context-menu-designer');
    if (active === asset.id) rt.swap('context-menu' as never, asset.id); // recompile the menu on screen
  }
  if (typeof document === 'undefined') return;
  let el = document.getElementById('axp-ctxd-live') as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = 'axp-ctxd-live'; document.head.appendChild(el); }
  el.textContent = css.filter(Boolean).join('\n');
}

export async function loadDesigns(rt?: AxfRuntime): Promise<void> {
  try {
    const r = await api.call<{ items: unknown[] }>('designs');
    designs = r.items.map(normalizeDesign);
    lastError = '';
    loaded = true;
    if (rt) applyToRuntime(rt);
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  emit();
}

export async function saveDesign(rt: AxfRuntime, d: Design): Promise<Design> {
  const r = await api.call<{ design: unknown }>(`designs/${encodeURIComponent(d.id)}`, { method: 'PUT', body: JSON.stringify(d) });
  const saved = normalizeDesign(r.design);
  designs = [...designs.filter((x) => x.id !== saved.id), saved];
  applyToRuntime(rt);
  emit();
  return saved;
}

export async function deleteDesign(rt: AxfRuntime, d: Design): Promise<void> {
  await api.call(`designs/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
  designs = designs.filter((x) => x.id !== d.id);
  if (d.kind === 'menu') {
    const id = `${ASSET_PREFIX}${d.id}`;
    // the asset stays registered until reload; move the screen off it so nothing points at a deleted design
    if ((rt.getState().active as Record<string, string>)['context-menu'] === id) {
      const other = rt.registry.list('context-menu' as never).find((a) => !a.id.startsWith(ASSET_PREFIX));
      if (other) rt.swap('context-menu' as never, other.id);
    }
  }
  applyToRuntime(rt);
  emit();
}

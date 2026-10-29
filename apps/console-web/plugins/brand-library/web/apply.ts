/**
 * Brand library — apply a piece to the running app. A branding package becomes the brand; a logo, animated logo or
 * icon pack goes into the active brand as a derived package (`bl-<hash>`, model.ts → deriveBranding). Everything
 * the package names is registered first (from the server's closure), then the runtime hot-swaps `branding`. The pick
 * is saved in this plugin's config and re-applied on the next load (or, when the look comes from axHub, the hub
 * document is the truth and only the assets are made available).
 */
import type { AxfRuntime } from '@console/axf/core';
import { loadClosure, loadConfig, saveConfig } from './api';
import { brandingRefs, deriveBranding, type Applied, type BrandType, type Config, type LibAsset } from './model';

const ORIGIN = 'brand-library';

function registerAll(rt: AxfRuntime, items: LibAsset[]): number {
  let bad = 0;
  for (const a of items) {
    const { facets: _f, ...plain } = a;
    const r = rt.registry.register(plain, 'imported', ORIGIN);
    if (!r.ok) bad++;
  }
  return bad;
}

async function registerRefs(rt: AxfRuntime, b: LibAsset): Promise<void> {
  for (const ref of brandingRefs(b)) {
    if (rt.registry.has(ref.type as never, ref.id)) continue;
    try { registerAll(rt, (await loadClosure(ref.type, ref.id)).items); } catch { /* the engine falls back to the mark / framework icons */ }
  }
}

const activeBranding = (rt: AxfRuntime): LibAsset | null => (rt.assetOrNull('branding' as never) as unknown as LibAsset | null) ?? null;

/** Apply `piece`; returns the saved config, or throws with a plain message. */
export async function applyPiece(rt: AxfRuntime, piece: LibAsset): Promise<Config> {
  let target: LibAsset;
  if (piece.type === 'branding') {
    const cl = await loadClosure('branding', piece.id);
    if (registerAll(rt, cl.items)) throw new Error(`${piece.name} didn't validate in this app.`);
    target = piece;
  } else {
    registerAll(rt, (await loadClosure(piece.type, piece.id)).items);
    const base = activeBranding(rt);
    target = deriveBranding(base, piece);
    if (base) await registerRefs(rt, target);
    if (registerAll(rt, [target])) throw new Error(`The brand with ${piece.name} didn't validate.`);
  }
  if (!rt.swap('branding' as never, target.id)) throw new Error('Your role can\'t change the brand here.');
  const applied: Applied = { type: 'branding', id: target.id, at: new Date().toISOString(), ...(piece.type === 'branding' ? {} : { asset: target }) };
  return saveConfig({ applied });
}

/** On load: make the last applied brand available again and re-apply it (unless axHub drives the look). */
export async function restoreApplied(rt: AxfRuntime): Promise<void> {
  let c: Config;
  try { c = await loadConfig(); } catch { return; }
  const ap = c.applied;
  if (!ap) return;
  try {
    if (ap.asset) { await registerRefs(rt, ap.asset); registerAll(rt, [ap.asset]); }
    else registerAll(rt, (await loadClosure(ap.type as BrandType, ap.id)).items);
  } catch { return; }
  if (rt.hasAppearanceSource()) { rt.refreshFromSaved(); return; }
  if (rt.registry.has('branding' as never, ap.id) && (rt.getState().active as Record<string, string>).branding !== ap.id) rt.swap('branding' as never, ap.id);
}

/** Forget the applied brand and go back to the app's default branding. */
export async function resetBrand(rt: AxfRuntime): Promise<Config> {
  rt.swap('branding' as never, 'default');
  return saveConfig({ applied: null });
}

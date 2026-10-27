import { ASSET_TYPES, type Asset, type AssetEnvelope, type AssetType } from './types';
import { validateAsset, type ValidationResult } from './validate';

export type AssetSource = 'builtin' | 'app' | 'imported';

export interface RegisteredAsset extends AssetEnvelope {
  /** where the asset came from (not part of the on-disk format) */
  readonly __source?: AssetSource;
  /** which module registered it (a library or plugin id), when known */
  readonly __origin?: string;
}

/** An asset id registered again by someone else with different content (see AxfRuntime.diagnostics). */
export interface AssetReplacement { type: string; id: string; was: string; now: string }

/** In-memory store of every asset available to the app, keyed by type then id. */
export class AssetRegistry {
  private store = new Map<AssetType, Map<string, RegisteredAsset>>();
  /**
   * Called when two modules clash: an asset replaces one with the same type and id that another module registered,
   * with other content. Apps and imports overriding a built-in asset are deliberate overrides, not clashes.
   */
  onReplace?: (r: AssetReplacement) => void;

  constructor() {
    for (const t of ASSET_TYPES) this.store.set(t, new Map());
  }

  /**
   * A plugin's own asset (toolbar-binding@1): validated as shipped by `plugin`, so a toolbar must be a plugin toolbar of
   * that plugin (owner.kind "plugin", owner.plugin = its id, attach = the element it controls) or it is refused.
   */
  registerPluginAsset(raw: unknown, plugin: string, source: AssetSource = 'app'): ValidationResult & { asset?: AssetEnvelope } {
    return this.register(raw, source, plugin, plugin);
  }

  register(raw: unknown, source: AssetSource = 'builtin', origin?: string, plugin?: string): ValidationResult & { asset?: AssetEnvelope } {
    const result = validateAsset(raw, plugin !== undefined ? { plugin } : {});
    if (!result.ok) return result;
    const asset = Object.freeze({ ...(raw as AssetEnvelope), __source: source, ...(origin ? { __origin: origin } : {}) }) as RegisteredAsset;
    const prev = this.store.get(asset.type)!.get(asset.id);
    if (prev?.__origin && asset.__origin && prev.__origin !== asset.__origin && this.onReplace) {
      const strip = ({ __source: _s, __origin: _o, ...rest }: RegisteredAsset) => JSON.stringify(rest);
      if (strip(prev) !== strip(asset)) this.onReplace({ type: asset.type, id: asset.id, was: prev.__origin, now: asset.__origin });
    }
    this.store.get(asset.type)!.set(asset.id, asset);
    return { ...result, asset };
  }

  get<K extends AssetType>(type: K, id: string): Asset<K> | undefined {
    return this.store.get(type)?.get(id) as Asset<K> | undefined;
  }

  has(type: AssetType, id: string): boolean {
    return !!this.store.get(type)?.has(id);
  }

  list<K extends AssetType>(type: K): Asset<K>[] {
    return [...(this.store.get(type)?.values() ?? [])] as Asset<K>[];
  }

  all(): RegisteredAsset[] {
    return ASSET_TYPES.flatMap((t) => [...this.store.get(t)!.values()]);
  }

  sourceOf(type: AssetType, id: string): AssetSource | undefined {
    return this.store.get(type)?.get(id)?.__source;
  }

  count(): number {
    return this.all().length;
  }
}

/** Strip runtime-only fields to get the portable on-disk JSON. */
export function serializeAsset(asset: AssetEnvelope): string {
  const { __source: _s, ...rest } = asset as RegisteredAsset;
  return JSON.stringify(rest, null, 2);
}

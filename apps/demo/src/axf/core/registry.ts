import { ASSET_TYPES, type Asset, type AssetEnvelope, type AssetType } from './types';
import { validateAsset, type ValidationResult } from './validate';

export type AssetSource = 'builtin' | 'app' | 'imported';

export interface RegisteredAsset extends AssetEnvelope {
  /** where the asset came from (not part of the on-disk format) */
  readonly __source?: AssetSource;
}

/** In-memory store of every asset available to the app, keyed by type then id. */
export class AssetRegistry {
  private store = new Map<AssetType, Map<string, RegisteredAsset>>();

  constructor() {
    for (const t of ASSET_TYPES) this.store.set(t, new Map());
  }

  register(raw: unknown, source: AssetSource = 'builtin'): ValidationResult & { asset?: AssetEnvelope } {
    const result = validateAsset(raw);
    if (!result.ok) return result;
    const asset = Object.freeze({ ...(raw as AssetEnvelope), __source: source }) as RegisteredAsset;
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

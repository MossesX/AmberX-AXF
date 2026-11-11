/**
 * The skin library: skins as a first-class category of the asset store (Brett, Nov 11 2026: "Get the skin stuff done.
 * In the asset store, the skins."). Browse every skin (skin@1 assets and the design packages that read as skins),
 * favourite, duplicate, delete, import, export, apply in this app or hub-wide, and save what the skin editor makes.
 *
 * Saved skins are plain skin@1 assets. Where they are kept is a store: a host (a plugin, through the
 * `axf.skin-store@1` web service) keeps them on its server so the REST API, MCP, CLI and voice see the same list;
 * without one they live in this app's settings (`axf.skins.custom`). Favourites follow the same rule.
 */
import type { AssetEnvelope, AssetType } from './types';
import type { AxfRuntime } from './runtime';
import type { ActionBus } from './engines/actions';
import { serializeAsset } from './registry';
import { normalizeSkin, skinErrors, SKIN_TYPE, type SkinData, type SkinEntry } from './engines/skin';

/** The web service a host publishes on `globalThis.__axfWebServices` to keep saved skins and favourites for every client. */
export const SKIN_STORE_SERVICE = 'axf.skin-store@1';
export const SKIN_CUSTOM_KEY = 'axf.skins.custom';
export const SKIN_FAVOURITES_KEY = 'axf.skins.favourites';
/** The asset store tab the Assets view opens on (`skins` = the skin browser). */
export const ASSET_STORE_TAB_KEY = 'axf.assets.tab';
export const SKIN_EDITOR_DIALOG = 'axf.skin.editor';
export const SKIN_IMPORT_DIALOG = 'axf.skin.import';
/** The editor's unsaved skin: registered (never saved) so the app can show it live. */
export const SKIN_DRAFT_ID = 'skin-editor-draft';
export const SKIN_LIBRARY_ORIGIN = 'skin-library';

export const SKIN_ACTIONS = {
  browse: 'skins.browse',
  edit: 'skins.edit',
  create: 'skins.new',
  preview: 'skins.preview',
  apply: 'skins.apply',
  everywhere: 'skins.everywhere',
  favourite: 'skins.favourite',
  duplicate: 'skins.duplicate',
  remove: 'skins.delete',
  exportSkin: 'skins.export',
  importSkin: 'skins.import',
} as const;

export interface SkinStore {
  /** Saved skins (skin@1) the host keeps. */
  list(): Promise<AssetEnvelope[]>;
  /** Save (create or overwrite) one skin; returns it as stored. */
  save(asset: AssetEnvelope, overwrite: boolean): Promise<AssetEnvelope>;
  remove(id: string): Promise<void>;
  favourites(): Promise<string[]>;
  setFavourite(id: string, on: boolean): Promise<string[]>;
  /** The hub-wide skin (null = none). Absent: the host cannot set it, the UI says how to. */
  setGlobal?(id: string | null): Promise<void>;
}

export interface LibraryEntry extends SkinEntry {
  /** A saved skin (made, duplicated or imported here): it can be overwritten and deleted. */
  custom: boolean;
  favourite: boolean;
  tags: string[];
  author: string;
}

export type LibraryShow = 'all' | 'skins' | 'packages' | 'favourites' | 'custom';
export interface LibraryFilter { q?: string; show?: LibraryShow }

export interface SaveResult { ok: boolean; id: string; errors: string[] }

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** A skin id from a name: lowercase letters, digits and dashes, at most 48 characters. */
export function skinSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skin';
}

/** `base`, or `base-2`, `base-3`… whichever is free. */
export function freeSkinId(base: string, taken: ReadonlySet<string>): string {
  const b = skinSlug(base);
  if (!taken.has(b)) return b;
  for (let n = 2; ; n++) if (!taken.has(`${b}-${n}`)) return `${b}-${n}`;
}

/** Search (name, id, description, tags) and the show filter. */
export function filterSkins(entries: readonly LibraryEntry[], f: LibraryFilter = {}): LibraryEntry[] {
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const show = f.show ?? 'all';
  return entries.filter((e) => {
    if (show === 'skins' && e.kind !== 'skin') return false;
    if (show === 'packages' && e.kind !== 'design-package') return false;
    if (show === 'favourites' && !e.favourite) return false;
    if (show === 'custom' && !e.custom) return false;
    const hay = `${e.name} ${e.id} ${e.description} ${e.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A skin@1 asset from editor fields. */
export function skinAsset(id: string, name: string, data: SkinData, extra: { description?: string; tags?: string[]; author?: string } = {}): AssetEnvelope<SkinData> {
  return { $axf: 'asset@1', type: SKIN_TYPE as AssetType, id, name: name.trim() || id, version: '1.0.0', description: extra.description ?? '', author: extra.author ?? '', tags: [...new Set(['skin', ...(extra.tags ?? [])])], data };
}

/** What is wrong with a skin asset before it is saved. */
export function skinAssetErrors(raw: unknown): string[] {
  const a = raw as Partial<AssetEnvelope> | null;
  if (!a || typeof a !== 'object') return ['not an asset'];
  const out: string[] = [];
  if (a.$axf !== 'asset@1') out.push('$axf must be asset@1');
  if (a.type !== SKIN_TYPE) out.push('type must be skin');
  if (typeof a.id !== 'string' || !ID.test(a.id) || a.id.length > 60) out.push('id must be lowercase letters, digits and dashes');
  if (a.id === SKIN_DRAFT_ID) out.push('that id is reserved for the editor');
  if (typeof a.name !== 'string' || !a.name.trim()) out.push('name is required');
  out.push(...skinErrors(a.data));
  return out;
}

const parseList = (v: unknown): AssetEnvelope[] => {
  if (typeof v !== 'string') return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; }
};

/** The skin library of one app. `rt.skins`. */
export class SkinLibrary {
  private store: SkinStore | null = null;
  private storeFavs: string[] | null = null;
  private readonly listeners = new Set<() => void>();
  private rev = 0;

  constructor(private readonly rt: AxfRuntime) {
    for (const a of parseList(rt.settings.get(SKIN_CUSTOM_KEY))) rt.registry.register(a, 'imported', SKIN_LIBRARY_ORIGIN);
  }

  /* ---- change feed for the UI ---- */
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  revision = (): number => this.rev;
  private changed(): void { this.rev++; for (const f of this.listeners) f(); }

  /** A host keeps saved skins and favourites from now on (and its saved skins are registered). */
  async useStore(store: SkinStore | null): Promise<void> {
    this.store = store;
    this.storeFavs = null;
    if (store) {
      const [saved, favs] = await Promise.all([store.list().catch(() => []), store.favourites().catch(() => [])]);
      for (const a of saved) this.rt.registry.register(a, 'imported', SKIN_LIBRARY_ORIGIN);
      this.storeFavs = favs;
    }
    this.changed();
  }

  hasStore(): boolean { return !!this.store; }
  canSetGlobal(): boolean { return !!this.store?.setGlobal; }

  /* ---- reading ---- */

  isCustom(id: string): boolean {
    const a = this.rt.registry.get(SKIN_TYPE as AssetType, id) as { __source?: string } | undefined;
    return !!a && id !== SKIN_DRAFT_ID && a.__source !== 'builtin';
  }

  favourites(): string[] {
    if (this.storeFavs) return this.storeFavs;
    const v = this.rt.settings.get(SKIN_FAVOURITES_KEY);
    return Array.isArray(v) ? v : [];
  }

  entries(): LibraryEntry[] {
    const favs = new Set(this.favourites());
    return this.rt.skinList().map((e) => {
      const a = this.rt.registry.get((e.kind === 'skin' ? SKIN_TYPE : 'design-package') as AssetType, e.id) as AssetEnvelope | undefined;
      return { ...e, custom: e.kind === 'skin' && this.isCustom(e.id), favourite: favs.has(e.id), tags: a?.tags ?? [], author: a?.author ?? '' };
    });
  }

  list(f?: LibraryFilter): LibraryEntry[] { return filterSkins(this.entries(), f); }

  entry(id: string): LibraryEntry | undefined { return this.entries().find((e) => e.id === id); }

  /** Any skin (or design package) as a skin@1 asset: what Export writes and what Duplicate and the editor start from. */
  asSkinAsset(id: string): AssetEnvelope<SkinData> | null {
    const e = this.entry(id);
    if (!e) return null;
    const a = this.rt.registry.get(SKIN_TYPE as AssetType, id) as AssetEnvelope | undefined;
    if (a) return JSON.parse(serializeAsset(a)) as AssetEnvelope<SkinData>;
    return skinAsset(id, e.name, e.data, { description: e.description, tags: e.tags, author: e.author });
  }

  exportJson(id: string): string {
    const a = this.asSkinAsset(id);
    return a ? JSON.stringify(a, null, 2) : '';
  }

  takenIds(): Set<string> { return new Set(this.entries().map((e) => e.id)); }

  /* ---- writing ---- */

  private guard(): boolean {
    if (this.rt.lockedByAppearance('assets.import')) { this.rt.toast('The look is locked.', 'warning', 'Skins'); return false; }
    if (!this.rt.can('assets.import')) { this.rt.toast('Your role needs "assets.import" to save skins.', 'danger', 'Skins'); return false; }
    return true;
  }

  private writeLocal(): void {
    const mine = this.rt.registry.list(SKIN_TYPE as AssetType).filter((a) => this.isCustom(a.id)).map((a) => JSON.parse(serializeAsset(a)) as AssetEnvelope);
    const clean = mine.map(({ __origin: _o, ...rest }: AssetEnvelope & { __origin?: string }) => rest);
    this.rt.settings.set(SKIN_CUSTOM_KEY, JSON.stringify(clean));
  }

  /** Save a skin. A new id must be free; `overwrite` replaces a saved skin (never a built-in one). */
  async save(raw: AssetEnvelope, overwrite = false): Promise<SaveResult> {
    const id = String((raw as { id?: unknown }).id ?? '');
    const errors = skinAssetErrors(raw);
    const exists = this.takenIds().has(id);
    if (exists && !overwrite) errors.push(`"${id}" is taken: save under another name or overwrite`);
    if (exists && overwrite && !this.isCustom(id)) errors.push(`"${id}" is a built-in skin: save it as a new skin`);
    if (errors.length) return { ok: false, id, errors };
    if (!this.guard()) return { ok: false, id, errors: ['not allowed'] };
    const asset = { ...raw, data: normalizeSkin(raw.data) } as AssetEnvelope;
    let stored = asset;
    if (this.store) {
      try { stored = await this.store.save(asset, overwrite); } catch (e) { return { ok: false, id, errors: [(e as Error).message] }; }
    }
    const r = this.rt.registry.register(stored, 'imported', SKIN_LIBRARY_ORIGIN);
    if (!r.ok) return { ok: false, id, errors: r.errors };
    if (!this.store) this.writeLocal();
    this.rt.terminal.ok('assets', `skin ${id} saved`);
    this.changed();
    this.rt.refreshLook();
    return { ok: true, id, errors: [] };
  }

  /** A copy of any skin (or design package) under a free id. */
  async duplicate(id: string, name?: string): Promise<SaveResult> {
    const src = this.asSkinAsset(id);
    if (!src) return { ok: false, id, errors: [`no skin "${id}"`] };
    const newName = name?.trim() || `${src.name} copy`;
    const copy = { ...src, id: freeSkinId(name?.trim() || `${id}-copy`, this.takenIds()), name: newName, tags: [...new Set([...(src.tags ?? []), 'custom'])] };
    const r = await this.save(copy);
    if (r.ok) this.rt.toast(`${newName} saved.`, 'success', 'Skins');
    return r;
  }

  /** Import skin@1 JSON (one asset or a list). Ids that are taken get a free one. */
  async importJson(text: string): Promise<{ ok: string[]; errors: string[] }> {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ok: [], errors: ['That is not valid JSON.'] }; }
    const out = { ok: [] as string[], errors: [] as string[] };
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const a = item as AssetEnvelope;
      const taken = this.takenIds();
      const fixed = a && typeof a === 'object' && typeof a.id === 'string' && taken.has(a.id) ? { ...a, id: freeSkinId(a.id, taken) } : a;
      const r = await this.save(fixed);
      if (r.ok) out.ok.push(r.id); else out.errors.push(`${r.id || '?'}: ${r.errors.join('; ')}`);
    }
    if (out.ok.length) this.rt.toast(`${out.ok.length} skin${out.ok.length > 1 ? 's' : ''} imported.`, 'success', 'Skins');
    return out;
  }

  /** Delete a saved skin. Built-in skins and design packages stay; a skin in use here is turned off first by the caller. */
  async remove(id: string): Promise<boolean> {
    if (!this.isCustom(id)) { this.rt.toast(`${id} is built in; only saved skins can be deleted.`, 'warning', 'Skins'); return false; }
    if (this.rt.skinAt().id === id) { this.rt.toast('That skin is in use in this app: apply another one first.', 'warning', 'Skins'); return false; }
    if (!this.guard()) return false;
    if (this.store) {
      try { await this.store.remove(id); } catch (e) { this.rt.toast((e as Error).message, 'danger', 'Skins'); return false; }
    }
    this.rt.registry.remove(SKIN_TYPE as AssetType, id);
    if (!this.store) this.writeLocal();
    if (this.favourites().includes(id)) await this.setFavourite(id, false);
    this.rt.terminal.ok('assets', `skin ${id} deleted`);
    this.changed();
    return true;
  }

  async setFavourite(id: string, on: boolean): Promise<boolean> {
    const cur = this.favourites();
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    if (this.store) {
      try { this.storeFavs = await this.store.setFavourite(id, on); } catch (e) { this.rt.toast((e as Error).message, 'danger', 'Skins'); return false; }
    } else this.rt.settings.set(SKIN_FAVOURITES_KEY, next);
    this.changed();
    return true;
  }

  /**
   * Apply in this app. Applying another skin drops this app's per-part overrides of the old one: `rt.skinOverrides()`
   * lists them, and the UI asks first (the apply-skin override question).
   */
  apply(id: string): boolean { return this.rt.useSkin(true, id); }

  /** The hub-wide skin (every app that follows it); null = none. Needs a host that can write it. */
  async applyEverywhere(id: string | null): Promise<boolean> {
    if (!this.store?.setGlobal) { this.rt.toast('Set the hub-wide skin with: node framework/cli/skins.mjs global <skin>', 'info', 'Skins'); return false; }
    try { await this.store.setGlobal(id); } catch (e) { this.rt.toast((e as Error).message, 'danger', 'Skins'); return false; }
    this.rt.toast(id ? `${this.entry(id)?.name ?? id} is the hub-wide skin.` : 'No hub-wide skin.', 'success', 'Skins');
    this.changed();
    return true;
  }

  /** Show the editor's draft on the app (never saved). null drops the draft and puts the saved look back. */
  previewDraft(data: SkinData | null, name = 'Unsaved skin'): boolean {
    if (!data) {
      this.rt.previewSkin(null);
      this.rt.registry.remove(SKIN_TYPE as AssetType, SKIN_DRAFT_ID);
      return true;
    }
    const r = this.rt.registry.register(skinAsset(SKIN_DRAFT_ID, name, data, { description: 'The skin editor\'s unsaved skin' }), 'app', SKIN_LIBRARY_ORIGIN);
    if (!r.ok) return false;
    this.rt.previewSkin(null);
    return this.rt.previewSkin(SKIN_DRAFT_ID);
  }

  /** Open the skin browser (the asset store's Skins tab). */
  browse(): void {
    this.rt.settings.set(ASSET_STORE_TAB_KEY, 'skins');
    this.rt.navigate('assets');
  }

  /** The skin JSON as a file download (browsers); elsewhere the JSON goes to the terminal. */
  download(id: string): boolean {
    const json = this.exportJson(id);
    if (!json) return false;
    const doc = (globalThis as { document?: Document }).document;
    const U = (globalThis as { URL?: typeof URL }).URL;
    if (!doc || !U?.createObjectURL) { this.rt.terminal.ok('assets', json); return true; }
    const url = U.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = doc.createElement('a');
    link.href = url; link.download = `${id}.skin.json`;
    link.click();
    setTimeout(() => U.revokeObjectURL(url), 1000);
    return true;
  }

  /** skins.* actions: console_action, MCP, voice and the command palette reach every browser and editor action. */
  registerActions(a: ActionBus): void {
    const want = (id?: string) => { if (id && this.entry(id)) return true; this.rt.toast(id ? `No skin "${id}".` : 'Which skin?', 'warning', 'Skins'); return false; };
    a.register(SKIN_ACTIONS.browse, () => this.browse(), { label: 'Browse skins (asset store)' });
    a.register(SKIN_ACTIONS.create, ([from]) => this.rt.openDialog(SKIN_EDITOR_DIALOG, { from: from || this.rt.skinAt().id || '' }), { label: 'New skin (skin editor)', requires: 'assets.import', params: true });
    a.register(SKIN_ACTIONS.edit, ([id]) => { if (want(id)) this.rt.openDialog(SKIN_EDITOR_DIALOG, { id }); }, { label: 'Edit a skin', requires: 'assets.import', params: true });
    a.register(SKIN_ACTIONS.preview, ([id]) => { if (!id || id === 'off') this.rt.previewSkin(null); else if (want(id)) this.rt.previewSkin(id); }, { label: 'Preview a skin without saving (off = stop)', requires: 'assets.swap', params: true });
    a.register(SKIN_ACTIONS.apply, ([id]) => { if (want(id)) this.apply(id!); }, { label: 'Apply a skin in this app', requires: 'assets.swap', params: true });
    a.register(SKIN_ACTIONS.everywhere, ([id]) => { if (!id || id === 'off') void this.applyEverywhere(null); else if (want(id)) void this.applyEverywhere(id); }, { label: 'Make a skin the hub-wide skin (off = none)', requires: 'assets.swap', params: true });
    a.register(SKIN_ACTIONS.favourite, ([id, v]) => { if (want(id)) void this.setFavourite(id!, v === 'on' ? true : v === 'off' ? false : !this.favourites().includes(id!)); }, { label: 'Favourite a skin (on / off / toggle)', params: true });
    a.register(SKIN_ACTIONS.duplicate, ([id]) => { if (want(id)) void this.duplicate(id!); }, { label: 'Duplicate a skin', requires: 'assets.import', params: true });
    a.register(SKIN_ACTIONS.remove, ([id]) => { if (want(id)) void this.remove(id!); }, { label: 'Delete a saved skin', requires: 'assets.import', params: true });
    a.register(SKIN_ACTIONS.exportSkin, ([id]) => { if (want(id)) this.download(id!); }, { label: 'Export a skin as JSON', params: true });
    a.register(SKIN_ACTIONS.importSkin, () => this.rt.openDialog(SKIN_IMPORT_DIALOG, {}), { label: 'Import skins from JSON', requires: 'assets.import' });
  }
}

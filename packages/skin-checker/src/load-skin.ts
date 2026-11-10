/**
 * The skin-check@1 loader (Node only, not pure): finds skins and design packages in the asset folders, resolves the
 * colour theme, style theme, typography, density and sizing assets each one names, and builds the SkinCheckSubject
 * the engine checks. Also persists the writes of an applied fix.
 *
 * Where it looks, first match wins:
 *   1. the overlay folder (`overlayDir`, the console plugin's data folder): `<overlay>/assets/<type>/<id>.json`,
 *      where applied fixes are kept. Built-in assets are never rewritten by the console; a fixed copy goes here and
 *      shadows the built-in from then on (`axf skin fix --write --in-place` writes the repo file instead).
 *   2. `framework/assets/<type>/<id>.json` under the repo root.
 *
 * A skin that names no typography, density or sizing asset is checked against `standard` (what the hub falls back to).
 * Nothing throws on bad data: a missing or unreadable asset is `null` in the subject and the engine skips its rules.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkinCheckAsset, SkinCheckSubject, SkinCheckTokenType, SkinCheckWrite } from './contract.ts';
import { SUBJECT_KEY } from './engine.ts';
import { subjectVars } from './vars.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SCALE_FALLBACK = 'standard';

export interface LoadOptions {
  /** Repo root (framework/assets lives under it). */
  root?: string;
  /** Folder whose `assets/<type>/<id>.json` shadow the built-ins (applied fixes). */
  overlayDir?: string | null;
}
export interface AssetFile { $axf: 'asset@1'; type: string; id: string; name?: string; data: unknown; [k: string]: unknown }
export interface SkinListing { id: string; name: string; kind: 'skin' | 'design-package'; fixed: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function dirs(type: string, o: LoadOptions): { dir: string; overlay: boolean }[] {
  const out: { dir: string; overlay: boolean }[] = [];
  if (o.overlayDir) out.push({ dir: join(o.overlayDir, 'assets', type), overlay: true });
  out.push({ dir: join(o.root ?? REPO_ROOT, 'framework', 'assets', type), overlay: false });
  return out;
}

function readJson(file: string): AssetFile | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return isObj(raw) && isObj(raw.data) && typeof raw.id === 'string' ? raw as AssetFile : null;
  } catch {
    return null;
  }
}

/** The asset file of a type and id, with where it came from; null when no folder has it. */
export function findAsset(type: string, id: string, o: LoadOptions = {}): { file: string; asset: AssetFile; overlay: boolean } | null {
  if (!ID.test(id)) return null;
  for (const d of dirs(type, o)) {
    const file = join(d.dir, `${id}.json`);
    if (!existsSync(file)) continue;
    const asset = readJson(file);
    if (asset && asset.id === id) return { file, asset, overlay: d.overlay };
  }
  return null;
}

function idsIn(type: string, o: LoadOptions): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const d of [...dirs(type, o)].reverse()) {
    if (!existsSync(d.dir)) continue;
    for (const f of readdirSync(d.dir)) if (f.endsWith('.json') && ID.test(f.slice(0, -5))) out.set(f.slice(0, -5), d.overlay);
  }
  return out;
}

/** Every skin, then every design package, sorted by id within each. `fixed` = an overlay copy shadows the built-in. */
export function listSkins(o: LoadOptions = {}): SkinListing[] {
  const out: SkinListing[] = [];
  for (const kind of ['skin', 'design-package'] as const) {
    for (const [id, overlay] of [...idsIn(kind, o)].sort(([a], [b]) => a.localeCompare(b))) {
      const a = findAsset(kind, id, o);
      if (a) out.push({ id, name: typeof a.asset.name === 'string' ? a.asset.name : id, kind, fixed: overlay });
    }
  }
  return out;
}

function asset<T>(type: string, id: unknown, o: LoadOptions): SkinCheckAsset<T> | null {
  if (typeof id !== 'string' || !id) return null;
  const a = findAsset(type, id, o);
  return a ? { id, data: a.asset.data as T } : null;
}

/**
 * Build the subject for a skin or design package id (a skin wins when both have the id; `kind` forces one).
 * Returns `{ error }` when there is no such skin.
 */
export function loadSubject(skinId: string, o: LoadOptions & { kind?: 'skin' | 'design-package' } = {}): { subject: SkinCheckSubject; error?: undefined } | { subject?: undefined; error: string } {
  const kinds = o.kind ? [o.kind] : (['skin', 'design-package'] as const);
  for (const kind of kinds) {
    const found = findAsset(kind, skinId, o);
    if (!found) continue;
    const d = found.asset.data as Record<string, unknown>;
    const slots = (kind === 'skin' ? d.assets : isObj(d.extras) ? d.extras.slots : null) as Record<string, unknown> | null;
    const slot = (t: string) => (isObj(slots) && typeof slots[t] === 'string' ? slots[t] as string : SCALE_FALLBACK);
    const base: Omit<SkinCheckSubject, 'vars'> = {
      skin: { id: skinId, name: typeof found.asset.name === 'string' ? found.asset.name : skinId, kind, data: d as unknown as SkinCheckSubject['skin']['data'] },
      colorTheme: asset('color-theme', kind === 'skin' ? d.colorTheme : d['color-theme'], o),
      styleTheme: asset('style-theme', kind === 'skin' ? d.styleTheme : d['style-theme'], o),
      typography: asset('typography', slot('typography'), o),
      density: asset('density', slot('density'), o),
      sizing: asset('sizing', slot('sizing'), o),
    };
    return { subject: { ...base, vars: subjectVars(base) } };
  }
  return { error: `no skin or design package called ${skinId}` };
}

/**
 * Persist the writes of an applied fix: every asset the writes touch is written whole (asset@1 envelope, the patched
 * data from `subject`) into the overlay folder, or over its own file with `inPlace`. Returns the files written.
 */
export function persistWrites(subject: SkinCheckSubject, writes: readonly SkinCheckWrite[], o: LoadOptions & { inPlace?: boolean } = {}): string[] {
  const touched = new Map<string, { type: SkinCheckTokenType; id: string }>();
  for (const w of writes) touched.set(`${w.token.type}:${w.token.id}`, { type: w.token.type, id: w.token.id });
  const files: string[] = [];
  for (const { type, id } of touched.values()) {
    const fileType = type === 'skin' ? subject.skin.kind : type;
    const src = findAsset(fileType, id, o);
    const held = subject[SUBJECT_KEY[type]] as { id: string; data: unknown } | null;
    if (!src || !held || held.id !== id) continue;
    const target = o.inPlace || !o.overlayDir ? src.file : join(o.overlayDir, 'assets', fileType, `${id}.json`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify({ ...src.asset, data: held.data }, null, 2)}\n`);
    files.push(target);
  }
  return files;
}

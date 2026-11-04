/**
 * lib-docstore — documents on this device and on axHub's data server (library@1 `ai.amberx.axf.docstore`).
 *
 *   const store = createDocStore({ folder: 'projects', hub: 'https://axhub.amberxai.com', project: 'my-app', hubOn })
 *   await store.list()                       // summaries from every store, newest copy wins
 *   await store.load(id) / save(doc) / remove(id)
 *   await putBlob(key, blob) / getBlob(key)  // device-only files (IndexedDB)
 *
 * A document is any JSON object with `id`, `name`, `updatedAt`; give `split` / `join` to store a big map (e.g. the pieces of
 * a project) in chunks under the hub's 64 KB limit. Parts: device, hub {project, chunk}, blobs {db}.
 */
import type { AxfWebLibrary } from '../../react/library';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import spec from './library.json';

export const DOCSTORE_LIBRARY_ID = 'ai.amberx.axf.docstore';
const PARTS = (spec as { parts: LibraryPart[] }).parts;
export interface DocstoreConfig { folder: string; device: boolean; hub: false | { project: string; chunk: number }; blobs: false | { db: string } }
let config: DocstoreConfig = { folder: 'docs', device: true, hub: false, blobs: { db: '' } };
export function configureDocstore(installed: ({ parts?: Record<string, unknown> } & Record<string, unknown>) | null | undefined): DocstoreConfig {
  const on = (id: string) => partOn(installed, id, PARTS);
  const pp = (id: string) => partParams(installed, id, PARTS.find((p) => p.id === id));
  config = {
    folder: String(installed?.folder ?? 'docs'), device: on('device'),
    hub: on('hub') ? { project: String(pp('hub').project ?? ''), chunk: Number(pp('hub').chunk ?? 48000) } : false,
    blobs: on('blobs') ? { db: String(pp('blobs').db ?? '') } : false,
  };
  return config;
}
export const docstoreConfig = () => config;

export interface Doc { id: string; name: string; updatedAt: string }
export interface DocSummary { id: string; name: string; updatedAt: string; size?: number; where: 'device' | 'hub' | 'both' }
/** how a document becomes head + a map stored in chunks (and back) */
export interface DocSplit<D> { split: (d: D) => { head: Record<string, unknown>; items: Record<string, unknown> }; join: (head: Record<string, unknown>, items: Record<string, unknown>) => D }
export interface Store<D extends Doc> { readonly id: 'device' | 'hub'; list(): Promise<DocSummary[]>; load(id: string): Promise<D | null>; save(d: D, summary?: Partial<DocSummary>): Promise<void>; remove(id: string): Promise<void> }

const safe = <T,>(f: () => T, fb: T): T => { try { return f(); } catch { return fb; } };

export class DeviceStore<D extends Doc> implements Store<D> {
  readonly id = 'device' as const;
  constructor(readonly folder: string, private parse: (raw: unknown) => D = (x) => x as D) {}
  private get indexKey() { return `axf-docs:${this.folder}`; }
  private key(id: string) { return `axf-docs:${this.folder}:${id}`; }
  private index(): DocSummary[] { return safe(() => JSON.parse(localStorage.getItem(this.indexKey) ?? '[]') as DocSummary[], []); }
  async list() { return this.index(); }
  async load(id: string) { const raw = safe(() => localStorage.getItem(this.key(id)), null); if (!raw) return null; try { return this.parse(JSON.parse(raw)); } catch { return null; } }
  async save(d: D, summary: Partial<DocSummary> = {}) {
    const text = JSON.stringify(d);
    try { localStorage.setItem(this.key(d.id), text); } catch (e) { throw new Error(`This device is out of room (${(e as Error).message}). Export some documents and delete them, or keep them on axHub.`); }
    const l = this.index().filter((x) => x.id !== d.id);
    l.unshift({ id: d.id, name: d.name, updatedAt: d.updatedAt, size: text.length, ...summary, where: 'device' });
    safe(() => localStorage.setItem(this.indexKey, JSON.stringify(l)), undefined);
  }
  async remove(id: string) { safe(() => localStorage.removeItem(this.key(id)), undefined); safe(() => localStorage.setItem(this.indexKey, JSON.stringify(this.index().filter((x) => x.id !== id))), undefined); }
}

/** axHub's data server (decision #88): GET/PUT /data/<project>/<folder>/…, ETag / If-Match, 64 KB per file */
export class HubStore<D extends Doc> implements Store<D> {
  readonly id = 'hub' as const;
  private etags = new Map<string, string>();
  constructor(readonly hub: string, readonly project: string, readonly folder: string, private shape?: DocSplit<D>, readonly chunk = 48000, private parse: (raw: unknown) => D = (x) => x as D) {}
  private url(path: string) { return `${this.hub.replace(/\/+$/, '')}/data/${encodeURIComponent(this.project)}/${this.folder}/${path}`; }
  private async get<T>(path: string): Promise<T | null> {
    const r = await fetch(this.url(path), { credentials: 'include', redirect: 'error', headers: { accept: 'application/json' } });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('Sign in to axHub to keep documents there.');
    if (!r.ok) throw new Error(`axHub answered ${r.status}.`);
    const tag = r.headers.get('etag'); if (tag) this.etags.set(path, tag);
    return (await r.json()) as T;
  }
  private async put(path: string, body: unknown, retried = false): Promise<void> {
    const text = JSON.stringify(body);
    if (text.length > 64_000) throw new Error(`${path} is over axHub's 64 KB limit.`);
    const tag = this.etags.get(path);
    const r = await fetch(this.url(path), { method: 'PUT', credentials: 'include', redirect: 'error', headers: { 'content-type': 'application/json', ...(tag ? { 'if-match': tag } : {}) }, body: text });
    if (r.status === 409 && !retried) { this.etags.delete(path); await this.get(path); return this.put(path, body, true); } // someone else saved: last save wins
    if (!r.ok) throw new Error(`axHub refused ${path} (${r.status}).`);
    const t2 = r.headers.get('etag'); if (t2) this.etags.set(path, t2);
  }
  async list(): Promise<DocSummary[]> { return ((await this.get<{ items: DocSummary[] }>('index.json'))?.items ?? []).map((x) => ({ ...x, where: 'hub' as const })); }
  async load(id: string): Promise<D | null> {
    const head = await this.get<Record<string, unknown> & { chunks?: number }>(`${id}/head.json`);
    if (!head) return null;
    if (!this.shape) return this.parse(head);
    const items: Record<string, unknown> = {};
    for (let i = 0; i < (head.chunks ?? 0); i++) Object.assign(items, (await this.get<Record<string, unknown>>(`${id}/chunk-${i}.json`)) ?? {});
    const { chunks: _c, ...rest } = head;
    return this.parse(this.shape.join(rest, items));
  }
  async save(d: D, summary: Partial<DocSummary> = {}): Promise<void> {
    if (!this.shape) await this.put(`${d.id}/head.json`, d);
    else {
      const { head, items } = this.shape.split(d);
      const parts = chunkMap(items, this.chunk);
      for (let i = 0; i < parts.length; i++) await this.put(`${d.id}/chunk-${i}.json`, parts[i]);
      await this.put(`${d.id}/head.json`, { ...head, chunks: parts.length });
    }
    const list = (await this.list().catch(() => [])).filter((x) => x.id !== d.id);
    list.unshift({ id: d.id, name: d.name, updatedAt: d.updatedAt, ...summary, where: 'hub' });
    await this.put('index.json', { $format: 'docstore-index@1', items: list.slice(0, 500) });
  }
  async remove(id: string): Promise<void> { await this.put('index.json', { $format: 'docstore-index@1', items: (await this.list()).filter((x) => x.id !== id) }); }
}

/** split a map into pieces whose JSON stays under `max` bytes (a single oversized entry gets a piece of its own) */
export function chunkMap(items: Record<string, unknown>, max: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{}]; let size = 2;
  for (const [k, v] of Object.entries(items)) {
    const n = JSON.stringify(k).length + JSON.stringify(v).length + 2;
    if (size + n > max && Object.keys(out[out.length - 1]!).length) { out.push({}); size = 2; }
    out[out.length - 1]![k] = v; size += n;
  }
  return out;
}

/** device + (when on) hub, behind one interface: saves go to every store, loads take the newest copy */
export class DocStore<D extends Doc> {
  device: DeviceStore<D> | null;
  hub: HubStore<D> | null = null;
  hubError: string | null = null;
  constructor(readonly opts: { folder?: string; hub?: string; project?: string; hubOn?: boolean; shape?: DocSplit<D>; parse?: (raw: unknown) => D }) {
    const folder = opts.folder ?? config.folder;
    this.device = config.device ? new DeviceStore<D>(folder, opts.parse) : null;
    this.setHub(!!opts.hubOn);
  }
  /** switch the hub store on or off (needs the hub part, an address and a project) */
  setHub(on: boolean) {
    const project = this.opts.project || (config.hub ? config.hub.project : '');
    this.hub = on && config.hub && this.opts.hub && project ? new HubStore<D>(this.opts.hub, project, this.opts.folder ?? config.folder, this.opts.shape, config.hub.chunk, this.opts.parse) : null;
    this.hubError = null;
  }
  stores(): Store<D>[] { return [...(this.device ? [this.device] : []), ...(this.hub ? [this.hub] : [])]; }
  async list(): Promise<DocSummary[]> {
    const lists = await Promise.all(this.stores().map((s) => s.list().catch((e) => { if (s.id === 'hub') this.hubError = (e as Error).message; return [] as DocSummary[]; })));
    const map = new Map<string, DocSummary>();
    for (const l of lists) for (const x of l) { const had = map.get(x.id); map.set(x.id, had ? { ...(had.updatedAt >= x.updatedAt ? had : x), where: 'both' } : x); }
    return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async load(id: string): Promise<D | null> {
    let best: D | null = null;
    for (const s of this.stores()) { const d = await s.load(id).catch(() => null); if (d && (!best || d.updatedAt > best.updatedAt)) best = d; }
    return best;
  }
  /** the device copy first (never lost), then the hub; a hub failure is kept in `hubError`, not thrown */
  async save(d: D, summary?: Partial<DocSummary>): Promise<void> {
    if (this.device) await this.device.save(d, summary);
    if (this.hub) { try { await this.hub.save(d, summary); this.hubError = null; } catch (e) { this.hubError = (e as Error).message; if (!this.device) throw e; } }
  }
  async remove(id: string): Promise<void> { for (const s of this.stores()) await s.remove(id).catch(() => undefined); }
}
export const createDocStore = <D extends Doc>(o: DocStore<D>['opts']) => new DocStore<D>(o);

/* ---------- device-only files (IndexedDB) ---------- */
const dbName = () => (config.blobs && config.blobs.db) || 'axf-docstore';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(dbName(), 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function putBlob(key: string, blob: Blob): Promise<void> {
  if (!config.blobs) throw new Error('Files on the device are switched off for this app.');
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function getBlob(key: string): Promise<Blob | null> {
  if (!config.blobs) return null;
  const d = await db();
  return new Promise((res) => { const r = d.transaction('blobs').objectStore('blobs').get(key); r.onsuccess = () => res((r.result as Blob) ?? null); r.onerror = () => res(null); });
}

export const library: AxfWebLibrary = {
  id: DOCSTORE_LIBRARY_ID,
  label: 'Document store',
  version: '0.1.0',
  provides: ['axf.docstore'],
  register(rt) { configureDocstore((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> } & Record<string, unknown>> }).libraries?.docstore); },
};

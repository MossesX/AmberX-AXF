/**
 * Where projects live. Two stores behind one interface:
 *  - DeviceStore: this browser (localStorage for projects, IndexedDB for recorded screen video).
 *  - HubStore: axHub's data server (decision #88): GET/PUT /data/walkthrough-studio/<path> with the browser's own hub
 *    session cookie, ETag / If-Match, 64 KB per document — so a project is split into a head document (settings + outline)
 *    and piece chunks under 48 KB each. Recorded video never goes to the hub (too big); it stays on the device.
 * The studio always writes the device copy first, then the hub when it is switched on, so the hub being down never
 * loses work (the app's look still waits for the hub, like every developer app).
 */
import { normalizeProject, type Piece, type Project } from './model';

export interface ProjectSummary { id: string; name: string; updatedAt: string; pieces: number; where: 'device' | 'hub' | 'both' }
export interface ProjectStore {
  readonly id: 'device' | 'hub';
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<Project | null>;
  save(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

const INDEX = 'ws:projects';
const KEY = (id: string) => `ws:project:${id}`;
const safe = <T,>(f: () => T, fallback: T): T => { try { return f(); } catch { return fallback; } };

export class DeviceStore implements ProjectStore {
  readonly id = 'device' as const;
  private index(): ProjectSummary[] { return safe(() => JSON.parse(localStorage.getItem(INDEX) ?? '[]') as ProjectSummary[], []); }
  private writeIndex(l: ProjectSummary[]) { safe(() => localStorage.setItem(INDEX, JSON.stringify(l)), undefined); }
  async list() { return this.index(); }
  async load(id: string) {
    const raw = safe(() => localStorage.getItem(KEY(id)), null);
    if (!raw) return null;
    try { return normalizeProject(JSON.parse(raw)); } catch { return null; }
  }
  async save(p: Project) {
    try { localStorage.setItem(KEY(p.id), JSON.stringify(p)); } catch (e) { throw new Error(`This device is out of room for projects (${(e as Error).message}). Export some and delete them, or keep projects on axHub.`); }
    const l = this.index().filter((x) => x.id !== p.id);
    l.unshift({ id: p.id, name: p.name, updatedAt: p.updatedAt, pieces: Object.keys(p.pieces).length, where: 'device' });
    this.writeIndex(l);
  }
  async remove(id: string) { safe(() => localStorage.removeItem(KEY(id)), undefined); this.writeIndex(this.index().filter((x) => x.id !== id)); }
}

/* ---------- axHub data server ---------- */

const HUB_PROJECT = 'walkthrough-studio';
const CHUNK = 48_000;

export class HubStore implements ProjectStore {
  readonly id = 'hub' as const;
  private etags = new Map<string, string>();
  constructor(readonly hub: string) {}
  private url(path: string) { return `${this.hub.replace(/\/+$/, '')}/data/${HUB_PROJECT}/${path}`; }
  private async get<T>(path: string): Promise<T | null> {
    const r = await fetch(this.url(path), { credentials: 'include', redirect: 'error', headers: { accept: 'application/json' } });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('Sign in to axHub to keep projects there.');
    if (!r.ok) throw new Error(`axHub answered ${r.status}.`);
    const tag = r.headers.get('etag'); if (tag) this.etags.set(path, tag);
    return (await r.json()) as T;
  }
  private async put(path: string, body: unknown): Promise<void> {
    const text = JSON.stringify(body);
    if (text.length > 64_000) throw new Error(`${path} is over axHub's 64 KB limit.`);
    const tag = this.etags.get(path);
    const r = await fetch(this.url(path), { method: 'PUT', credentials: 'include', redirect: 'error', headers: { 'content-type': 'application/json', ...(tag ? { 'if-match': tag } : {}) }, body: text });
    if (r.status === 409) { this.etags.delete(path); await this.get(path); return this.put(path, body); } // someone else saved: last save wins
    if (!r.ok) throw new Error(`axHub refused ${path} (${r.status}).`);
    const t2 = r.headers.get('etag'); if (t2) this.etags.set(path, t2);
  }
  async list(): Promise<ProjectSummary[]> {
    const idx = await this.get<{ projects: ProjectSummary[] }>('index.json');
    return (idx?.projects ?? []).map((x) => ({ ...x, where: 'hub' as const }));
  }
  async load(id: string): Promise<Project | null> {
    const head = await this.get<Omit<Project, 'pieces'> & { chunks: number }>(`projects/${id}/head.json`);
    if (!head) return null;
    const pieces: Record<string, Piece> = {};
    for (let i = 0; i < head.chunks; i++) Object.assign(pieces, (await this.get<Record<string, Piece>>(`projects/${id}/pieces-${i}.json`)) ?? {});
    return normalizeProject({ ...head, pieces });
  }
  async save(p: Project): Promise<void> {
    const chunks: Record<string, Piece>[] = [{}];
    let size = 0;
    for (const [k, v] of Object.entries(p.pieces)) {
      const n = JSON.stringify(v).length;
      if (size + n > CHUNK && Object.keys(chunks[chunks.length - 1]!).length) { chunks.push({}); size = 0; }
      chunks[chunks.length - 1]![k] = v; size += n;
    }
    for (let i = 0; i < chunks.length; i++) await this.put(`projects/${p.id}/pieces-${i}.json`, chunks[i]);
    const { pieces: _p, recordings, ...head } = p;
    // recordings keep their events but never video (that stays on the device)
    await this.put(`projects/${p.id}/head.json`, { ...head, recordings: recordings.map(({ videoKey: _v, ...r }) => r), chunks: chunks.length });
    const list = (await this.list().catch(() => [])).filter((x) => x.id !== p.id);
    list.unshift({ id: p.id, name: p.name, updatedAt: p.updatedAt, pieces: Object.keys(p.pieces).length, where: 'hub' });
    await this.put('index.json', { $format: 'walkthrough-index@1', projects: list.slice(0, 200) });
  }
  async remove(id: string): Promise<void> {
    // The data API has no delete for app documents; the project leaves the index (its files stay, versioned, on the hub).
    const list = (await this.list()).filter((x) => x.id !== id);
    await this.put('index.json', { $format: 'walkthrough-index@1', projects: list });
  }
}

/* ---------- recorded video (IndexedDB, this device only) ---------- */

const DB = 'walkthrough-studio';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('video');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function putVideo(key: string, blob: Blob): Promise<void> {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction('video', 'readwrite'); tx.objectStore('video').put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function getVideo(key: string): Promise<Blob | null> {
  const d = await db();
  return new Promise((res) => { const r = d.transaction('video').objectStore('video').get(key); r.onsuccess = () => res((r.result as Blob) ?? null); r.onerror = () => res(null); });
}

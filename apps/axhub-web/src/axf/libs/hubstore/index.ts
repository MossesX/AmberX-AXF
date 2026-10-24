/**
 * lib-hubstore — an app's settings and data on axHub's data server instead of this device (library@1 `ai.amberx.axf.hubstore`).
 *
 *   const settings = createHubSettings({ file: 'settings/voice-notes.json' })   // HubSettings
 *   await settings.load(); settings.get('beep.on', true); await settings.set('beep.on', false)
 *   const data = createHubData()                                                // HubData
 *   const lists = data.table('lists'); await lists.rows(); await lists.put('groceries', { name: 'Groceries' })
 *
 * Hub side (axHub decision #88): GET/PUT <hub>/data/<project>/<path>, ETag / If-Match (409 = someone saved first: re-read,
 * apply this change again, retry), 64 KB per file, the browser's own hub session (credentials: include, redirects
 * refused). Parts: settings {file, mirror}, data {mode all|some, tables, folder}; a table not picked stays on this
 * device. The hub down is an error plus a state (`unreachable` / `unauthorized`), never a quiet local copy.
 */
import type { AxfWebLibrary } from '../../react/library';
import type { SettingsRegistry, SettingValue } from '../../core/settings';
import {
  HUB_FILE_MAX, HUBSTORE_LIBRARY_ID, TABLE_FORMAT, chunkRows, dataUrl, emptySettings, hubOriginOf, isSafeName, isSafePath,
  mergeSettings, parseSettings, resolveHubstoreConfig, tableChunkPath, tableHeadPath, tableOnHub,
  type HubValue, type HubstoreConfig, type Row, type SettingsDoc, type TableHead,
} from './core';

export * from './core';

let config: HubstoreConfig = resolveHubstoreConfig(null);
export function configureHubstore(installed: Parameters<typeof resolveHubstoreConfig>[0], appProject = ''): HubstoreConfig {
  config = resolveHubstoreConfig(installed, appProject);
  return config;
}
export const hubstoreConfig = () => config;

export type HubState = { status: 'idle' | 'loading' | 'ready' } | { status: 'unauthorized' | 'unreachable'; reason: string };
export interface HubOptions {
  /** hub origin (https; http only for localhost) — default the installed config's */
  hub?: string;
  /** project folder on the hub — default the installed config's */
  project?: string;
  /** recorded as `updatedBy` */
  appId?: string;
  fetchImpl?: typeof fetch;
}

/** One hub data client: GET/PUT with versions, size cap, no redirects, hub session cookie. */
class HubFiles {
  readonly hub: string;
  readonly project: string;
  private readonly tags = new Map<string, string>();
  private readonly f: typeof fetch;
  constructor(o: HubOptions) {
    const hub = hubOriginOf(o.hub ?? config.hub);
    if (!hub) throw new Error('hubstore: the hub address must be https');
    const project = o.project ?? config.project;
    if (!isSafeName(project)) throw new Error('hubstore: set the hub project (library param "project")');
    this.hub = hub;
    this.project = project;
    this.f = o.fetchImpl ?? ((i, n) => fetch(i, n));
  }
  url(path: string) { return dataUrl(this.hub, this.project, path); }
  private fail(status: number, path: string): never {
    if (status === 401 || status === 403) throw new HubError('unauthorized', `Sign in to axHub (${status}) to use ${path}.`);
    throw new HubError('unreachable', `axHub answered ${status} for ${path}.`);
  }
  async get<T>(path: string): Promise<T | null> {
    let r: Response;
    try { r = await this.f(this.url(path), { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } }); }
    catch (e) { throw new HubError('unreachable', `axHub can't be reached (${(e as Error).message}).`); }
    if (r.status === 404) { this.tags.delete(path); return null; }
    if (!r.ok) this.fail(r.status, path);
    const tag = r.headers.get('etag');
    if (tag) this.tags.set(path, tag);
    return (await r.json()) as T;
  }
  /** PUT with the version last read; false = 409 (someone saved first). */
  async put(path: string, body: unknown): Promise<boolean> {
    const text = JSON.stringify(body);
    if (text.length > HUB_FILE_MAX) throw new Error(`hubstore: ${path} is over axHub's 64 KB limit`);
    const tag = this.tags.get(path);
    let r: Response;
    try { r = await this.f(this.url(path), { method: 'PUT', credentials: 'include', redirect: 'error', headers: { 'content-type': 'application/json', ...(tag ? { 'if-match': tag } : {}) }, body: text }); }
    catch (e) { throw new HubError('unreachable', `axHub can't be reached (${(e as Error).message}).`); }
    if (r.status === 409 || r.status === 412) return false;
    if (!r.ok) this.fail(r.status, path);
    const t2 = r.headers.get('etag');
    if (t2) this.tags.set(path, t2);
    return true;
  }
}

export class HubError extends Error {
  constructor(readonly kind: 'unauthorized' | 'unreachable', message: string) { super(message); }
}

const MAX_TRIES = 4;
const now = () => new Date().toISOString();

/* ====================== HubSettings ====================== */

/** One settings document on axHub: load, read, change per key (last save wins), optionally mirror the Settings screen. */
export class HubSettings {
  readonly file: string;
  private readonly files: HubFiles;
  private readonly appId: string;
  private doc: SettingsDoc = emptySettings();
  private st: HubState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(o: HubOptions & { file?: string } = {}) {
    const file = o.file ?? (config.settings ? config.settings.file : 'settings/app.json');
    if (!isSafePath(file)) throw new Error(`hubstore: "${file}" isn't a safe settings path`);
    this.file = file;
    this.files = new HubFiles(o);
    this.appId = o.appId ?? 'app';
  }
  get url() { return this.files.url(this.file); }
  state(): HubState { return this.st; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const l of this.listeners) l(); }
  private setState(s: HubState) { this.st = s; this.emit(); }
  private catchState(e: unknown): never {
    if (e instanceof HubError) this.setState({ status: e.kind, reason: e.message });
    throw e;
  }

  /** Read the document from the hub (missing = empty). Call again on focus to pick up other devices' saves. */
  async load(): Promise<Record<string, HubValue>> {
    this.setState({ status: 'loading' });
    try { this.doc = parseSettings(await this.files.get(this.file)); }
    catch (e) { this.catchState(e); }
    this.setState({ status: 'ready' });
    return this.all();
  }
  all(): Record<string, HubValue> { return { ...this.doc.values }; }
  get<T extends HubValue>(key: string, fallback: T): T { return Object.hasOwn(this.doc.values, key) ? (this.doc.values[key] as T) : fallback; }
  updatedAt() { return this.doc.updatedAt; }

  set(key: string, value: HubValue): Promise<void> { return this.patch({ [key]: value }); }
  /** Apply a change (null removes a key): shown at once, saved in order; 409 → re-read, merge again, retry. */
  patch(change: Record<string, HubValue | undefined>): Promise<void> {
    this.doc = mergeSettings(this.doc, change, this.appId, now());
    this.emit();
    const run = this.chain.then(async () => {
      try {
        for (let i = 0; i < MAX_TRIES; i++) {
          if (await this.files.put(this.file, mergeSettings(this.doc, change, this.appId, now()))) { this.setState({ status: 'ready' }); return; }
          this.doc = mergeSettings(parseSettings(await this.files.get(this.file)), change, this.appId, now());
        }
        throw new HubError('unreachable', `${this.file} kept changing on axHub; try again.`);
      } catch (e) { this.catchState(e); }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Keep the app's Settings screen values on axHub: the hub's values win at start, every save the screen makes goes
   * to the hub. `keys` limits it (default: every setting a group declares, secrets never). Returns a stop function.
   */
  mirror(registry: SettingsRegistry, keys?: (key: string) => boolean): () => void {
    const declared = (): string[] => {
      const out: string[] = [];
      for (const t of registry.listTabs()) for (const g of registry.groupsIn(t.id)) for (const s of g.settings) if (s.kind !== 'secret' && (!keys || keys(s.key))) out.push(s.key);
      for (const g of registry.groupsIn('general')) for (const s of g.settings) if (s.kind !== 'secret' && (!keys || keys(s.key)) && !out.includes(s.key)) out.push(s.key);
      return out;
    };
    let applying = false;
    const snap = new Map<string, string>();
    const apply = () => {
      applying = true;
      try {
        for (const k of declared()) if (Object.hasOwn(this.doc.values, k)) { const v = this.doc.values[k] as SettingValue; if (JSON.stringify(registry.get(k)) !== JSON.stringify(v)) registry.set(k, v); }
      } finally { applying = false; }
      for (const k of declared()) snap.set(k, JSON.stringify(registry.get(k)));
    };
    apply();
    const offDoc = this.subscribe(() => { if (this.st.status === 'ready') apply(); });
    const offReg = registry.subscribe(() => {
      if (applying) return;
      const change: Record<string, HubValue> = {};
      for (const k of declared()) { const j = JSON.stringify(registry.get(k)); if (snap.get(k) !== j) { snap.set(k, j); change[k] = registry.get(k) as HubValue; } }
      if (Object.keys(change).length) void this.patch(change).catch(() => undefined);
    });
    return () => { offDoc(); offReg(); };
  }
}

/* ====================== HubData ====================== */

export interface Table<R extends Row = Row> {
  readonly name: string;
  readonly where: 'hub' | 'device';
  rows(): Promise<Record<string, R>>;
  get(id: string): Promise<R | null>;
  put(id: string, row: R): Promise<void>;
  remove(id: string): Promise<void>;
  /** replace every row at once */
  replace(rows: Record<string, R>): Promise<void>;
}

type Op<R> = (rows: Record<string, R>) => Record<string, R>;

class HubTable<R extends Row> implements Table<R> {
  readonly where = 'hub' as const;
  private cache: Record<string, R> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly name: string, private files: HubFiles, private folder: string) {}
  private async read(): Promise<Record<string, R>> {
    const head = await this.files.get<TableHead & { rows?: Record<string, R> }>(tableHeadPath(this.folder, this.name));
    if (!head || head.$axf !== TABLE_FORMAT) return {};
    if (head.rows) return { ...head.rows };
    const out: Record<string, R> = {};
    for (let i = 0; i < head.chunks; i++) Object.assign(out, (await this.files.get<Record<string, R>>(tableChunkPath(this.folder, this.name, i))) ?? {});
    return out;
  }
  private async write(rows: Record<string, R>): Promise<boolean> {
    const base = { $axf: TABLE_FORMAT, table: this.name, count: Object.keys(rows).length, updatedAt: now() };
    const inline = { ...base, chunks: 0, rows };
    if (JSON.stringify(inline).length <= HUB_FILE_MAX - 500) return this.files.put(tableHeadPath(this.folder, this.name), inline);
    const parts = chunkRows(rows as Record<string, Row>);
    for (let i = 0; i < parts.length; i++) { const p = tableChunkPath(this.folder, this.name, i); await this.files.get(p).catch(() => null); await this.files.put(p, parts[i]); }
    return this.files.put(tableHeadPath(this.folder, this.name), { ...base, chunks: parts.length });
  }
  async rows() { this.cache = await this.read(); return { ...this.cache }; }
  async get(id: string) { return (this.cache ?? (await this.rows()))[id] ?? null; }
  private change(op: Op<R>): Promise<void> {
    const run = this.chain.then(async () => {
      let rows = this.cache ?? (await this.read());
      for (let i = 0; i < MAX_TRIES; i++) {
        const next = op(rows);
        if (await this.write(next)) { this.cache = next; return; }
        rows = await this.read(); // someone saved first: apply this change on top of theirs
      }
      throw new HubError('unreachable', `table ${this.name} kept changing on axHub; try again.`);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
  put(id: string, row: R) { if (!id) return Promise.reject(new Error('hubstore: a row needs an id')); return this.change((r) => ({ ...r, [id]: row })); }
  remove(id: string) { return this.change((r) => { const { [id]: _gone, ...rest } = r; return rest; }); }
  replace(rows: Record<string, R>) { return this.change(() => ({ ...rows })); }
}

class DeviceTable<R extends Row> implements Table<R> {
  readonly where = 'device' as const;
  constructor(readonly name: string, private key: string) {}
  private load(): Record<string, R> { try { const o = JSON.parse(globalThis.localStorage?.getItem(this.key) ?? '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }
  private save(rows: Record<string, R>) {
    try { globalThis.localStorage?.setItem(this.key, JSON.stringify(rows)); } catch (e) { throw new Error(`This device is out of room for table ${this.name} (${(e as Error).message}).`); }
  }
  async rows() { return this.load(); }
  async get(id: string) { return this.load()[id] ?? null; }
  async put(id: string, row: R) { if (!id) throw new Error('hubstore: a row needs an id'); this.save({ ...this.load(), [id]: row }); }
  async remove(id: string) { const { [id]: _gone, ...rest } = this.load(); this.save(rest); }
  async replace(rows: Record<string, R>) { this.save({ ...rows }); }
}

/** The app's tables: each one on axHub or on this device, as the library was configured (`where(name)`). */
export class HubData {
  private readonly files: HubFiles | null;
  private readonly folder: string;
  private readonly cfg: Pick<HubstoreConfig, 'data'>;
  private readonly tables = new Map<string, Table>();
  constructor(o: HubOptions & { mode?: 'all' | 'some'; tables?: string[]; folder?: string; deviceOnly?: boolean } = {}) {
    const d = config.data || { mode: 'all' as const, tables: [], folder: 'data' };
    this.folder = o.folder ?? d.folder;
    if (!isSafeName(this.folder)) throw new Error(`hubstore: "${this.folder}" isn't a safe folder name`);
    this.cfg = o.deviceOnly || (!config.data && !o.mode) ? { data: false } : { data: { mode: o.mode ?? d.mode, tables: o.tables ?? d.tables, folder: this.folder } };
    this.files = this.cfg.data ? new HubFiles(o) : null;
  }
  where(table: string): 'hub' | 'device' { return tableOnHub(this.cfg, table) ? 'hub' : 'device'; }
  table<R extends Row = Row>(name: string): Table<R> {
    if (!isSafeName(name)) throw new Error(`hubstore: "${name}" isn't a safe table name`);
    let t = this.tables.get(name);
    if (!t) {
      t = this.where(name) === 'hub' && this.files ? new HubTable<R>(name, this.files, this.folder) : new DeviceTable<R>(name, `axf-hubstore:${this.folder}:${name}`);
      this.tables.set(name, t);
    }
    return t as Table<R>;
  }
}

export const createHubSettings = (o?: ConstructorParameters<typeof HubSettings>[0]) => new HubSettings(o);
export const createHubData = (o?: ConstructorParameters<typeof HubData>[0]) => new HubData(o);

export const library: AxfWebLibrary = {
  id: HUBSTORE_LIBRARY_ID,
  label: 'axHub storage',
  version: '0.1.0',
  provides: ['axf.hubstore'],
  register(rt) {
    const m = rt.manifest as { app?: { id?: string }; project?: { name?: string }; libraries?: Record<string, Parameters<typeof resolveHubstoreConfig>[0]> };
    const cfg = configureHubstore(m.libraries?.hubstore, m.project?.name ?? '');
    if (cfg.settings && cfg.settings.mirror && cfg.project) {
      try {
        const s = new HubSettings({ appId: m.app?.id });
        void s.load().then(() => s.mirror(rt.settings)).catch((e) => rt.terminal.warn('hubstore', `settings stay on this device until axHub answers: ${(e as Error).message}`));
      } catch (e) { rt.terminal.warn('hubstore', (e as Error).message); }
    }
  },
};

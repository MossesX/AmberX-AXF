/**
 * Pure rules for the plugin store (no DOM, no runtime): reading axHub's `/plugins.json` (axHub decision 101), marking
 * each plugin against what this build has installed, and building the hub's confirm-page link. `test.mjs` runs them.
 *
 * Nothing here trusts the reply more than it has to: fields are checked one by one, unknown kinds and odd folder names
 * are dropped, and the only link ever built is `<hub>/#/plugins/install/amberx/<folder>`, from the hub address this
 * build already knows and a folder name that passed the catalog's own rule. A link inside a reply is never used.
 */

export const KIND = 'amberx';
export const FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const MAX_ITEMS = 300;
export const MAX_REPLY = 1_000_000;

export interface StoreItem {
  folder: string;
  id: string;
  name: string;
  version: string;
  description: string;
  files: number;
  bytes: number;
  publishedAt: string;
  model: string;
}

export type StoreFeed =
  | { state: 'ok'; items: StoreItem[]; reachable: boolean; updatedAt: string; target: boolean }
  | { state: 'signed-out' | 'not-admin' | 'unreachable' | 'old-hub' | 'error'; message: string };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** What a `/plugins.json` answer means. `status` 0 = the request never got an answer. */
export function interpretFeed(status: number, body: string): StoreFeed {
  if (status === 0) return { state: 'unreachable', message: "axHub didn't answer. Check the connection and try again." };
  if (status === 401) return { state: 'signed-out', message: 'Sign in to axHub to see the plugin catalog.' };
  if (status === 403) return { state: 'not-admin', message: 'Only a hub admin can install plugins.' };
  if (status === 404) return { state: 'old-hub', message: "This hub can't install plugins yet. It needs updating (axHub decision 101)." };
  if (status !== 200) return { state: 'error', message: `axHub answered ${status}. Try again in a moment.` };
  if (body.length > MAX_REPLY) return { state: 'error', message: 'The catalog reply was too large.' };
  let json: Record<string, unknown>;
  try { json = JSON.parse(body) as Record<string, unknown>; } catch { return { state: 'error', message: "The catalog reply wasn't readable." }; }
  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) return { state: 'error', message: "The catalog reply wasn't readable." };
  const targets = Array.isArray(json.targets) ? (json.targets as Array<{ kind?: unknown }>) : [];
  const seen = new Set<string>();
  const items: StoreItem[] = [];
  for (const raw of (json.items as unknown[]).slice(0, MAX_ITEMS * 2)) {
    const it = raw as Record<string, unknown> | null;
    if (!it || it.kind !== KIND || typeof it.folder !== 'string' || !FOLDER_RE.test(it.folder) || seen.has(it.folder)) continue;
    if (typeof it.id !== 'string' || !ID_RE.test(it.id) || typeof it.version !== 'string' || !VERSION_RE.test(it.version)) continue;
    seen.add(it.folder);
    const bw = it.builtWith && typeof it.builtWith === 'object' ? (it.builtWith as Record<string, unknown>) : {};
    items.push({
      folder: it.folder, id: it.id, name: text(it.name, 80) || it.folder, version: it.version,
      description: text(it.description, 400), files: num(it.files), bytes: num(it.bytes), publishedAt: text(it.publishedAt, 40), model: text(bw.model, 20),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { state: 'ok', items, reachable: json.reachable !== false, updatedAt: text(json.updatedAt, 40), target: targets.some((t) => t?.kind === KIND) };
}

/** Newer-than for plugin versions (1.10.0 > 1.9.0); prerelease tags only break ties. */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[-+]/)[0]!.split('.').map(Number);
  const pb = b.split(/[-+]/)[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

export type Mark = 'new' | 'installed' | 'update' | 'newer-here';

/** How a catalog plugin stands against what this build has (`installed`: plugin id → version). */
export function markOf(item: StoreItem, installed: ReadonlyMap<string, string>): Mark {
  const have = installed.get(item.id);
  if (have === undefined) return 'new';
  if (have === item.version) return 'installed';
  return newer(item.version, have) ? 'update' : 'newer-here';
}

export const MARK_LABEL: Record<Mark, string> = { new: 'Not installed', installed: 'Installed', update: 'Update available', 'newer-here': 'Newer here' };

/** The hub's own confirm page for one plugin. Null when the hub or the folder doesn't pass. */
export function installUrl(hub: string, folder: string): string | null {
  let u: URL;
  try { u = new URL(hub); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  if (!FOLDER_RE.test(folder)) return null;
  return `${u.origin}/#/plugins/install/${KIND}/${folder}`;
}

/** The catalog on the hub, for the "everything" link. */
export function catalogUrl(hub: string): string | null {
  let u: URL;
  try { u = new URL(hub); } catch { return null; }
  return u.protocol === 'https:' && !u.username && !u.password ? `${u.origin}/#/plugins?kind=${KIND}` : null;
}

/** Sorts what needs you first: updates, then new plugins, then the rest; by name within each. */
export function storeOrder(items: StoreItem[], installed: ReadonlyMap<string, string>): Array<StoreItem & { mark: Mark }> {
  const rank: Record<Mark, number> = { update: 0, new: 1, installed: 2, 'newer-here': 3 };
  return items.map((it) => ({ ...it, mark: markOf(it, installed) })).sort((a, b) => rank[a.mark] - rank[b.mark] || a.name.localeCompare(b.name));
}

/**
 * What the hub answers, turned into values this app can show. Pure: no fetch, no React, so the
 * rules are testable (`test.mjs`) and could be harvested into lib-hub later.
 *
 * Everything here treats the hub's replies as untrusted data: fields are capped, ids and file names
 * must match the shapes the hub itself uses, and a download link is only used when it points at the
 * hub's own `/apps/download/<project>/<file>` path (never an address the reply chose).
 */
import { HUB_MESSAGES, isHub, type HubApproval, type HubFeedStatus } from '../axf/libs/hub';

/* ---------------------------------------------------------------- the app catalog (/apps.json) */

/** Same shapes the hub's app-catalog@1 serves (`packages/server/src/apps.ts`). */
const PROJECT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE = /^[a-z0-9][a-z0-9-]{0,63}-[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}-b\d{1,9}\.apk$/;
const SHA = /^[0-9a-f]{64}$/;

export const APPS_MAX = 100;
export const VERSIONS_MAX = 5;
export const APPS_FEED_MAX_BYTES = 512 * 1024;
/** 4 GB: no APK is near this, and it keeps a silly number out of the page. */
const SIZE_MAX = 4 * 1024 * 1024 * 1024;

export interface AppBuild {
  version: string;
  build: number | null;
  file: string;
  size: number;
  sha256: string;
  builtAt: string | null;
  /** Absolute, always on the hub. */
  url: string;
}

export interface CatalogApp {
  project: string;
  name: string;
  platform: string;
  latest: AppBuild;
  /** Builds before `latest`, newest first. */
  earlier: AppBuild[];
}

export interface AppsFeed {
  status: HubFeedStatus;
  updatedAt: string | null;
  apps: CatalogApp[];
  /** Why it is unreachable or refused ('' otherwise). */
  error: string;
}

const str = (o: Record<string, unknown>, k: string, max = 200): string | null => {
  const v = o[k];
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
};

const emptyApps = (status: HubFeedStatus, error = ''): AppsFeed => ({ status, updatedAt: null, apps: [], error });

/** A build row, or null when anything about it is off (a bad name, size or link). */
function build(base: string, project: string, raw: unknown): AppBuild | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const file = str(v, 'file', 128);
  const version = str(v, 'version', 64);
  if (!file || !version || !FILE.test(file)) return null;
  const size = typeof v.size === 'number' && Number.isFinite(v.size) ? Math.floor(v.size) : -1;
  if (size < 0 || size > SIZE_MAX) return null;
  // The link is rebuilt here, then checked: only the hub's own download path is ever opened.
  const url = `${base}/apps/download/${project}/${file}`;
  if (!isHub(base, url)) return null;
  const sha = str(v, 'sha256', 64);
  const n = typeof v.build === 'number' && Number.isFinite(v.build) ? Math.floor(v.build) : null;
  return {
    version,
    build: n !== null && n >= 0 ? n : null,
    file,
    size,
    sha256: sha && SHA.test(sha) ? sha : '',
    builtAt: str(v, 'builtAt', 64),
    url,
  };
}

/**
 * `/apps.json` → the catalog. 401 → signed-out, 403 → not allowed (the account needs
 * `apps.download`), 200 → the apps, anything else → unreachable. Apps without a usable latest build
 * are left out rather than shown broken.
 */
export function interpretApps(base: string, status: number, body: string): AppsFeed {
  if (status === 401) return emptyApps('signed-out');
  if (status === 403) return emptyApps('not-admin');
  if (status !== 200) return emptyApps('unreachable', HUB_MESSAGES.answered.replace('{status}', String(status)));
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return emptyApps('unreachable', HUB_MESSAGES.unexpected);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyApps('unreachable', HUB_MESSAGES.unexpected);
  const j = parsed as Record<string, unknown>;
  const apps: CatalogApp[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(j.apps) ? j.apps : []) {
    if (apps.length >= APPS_MAX) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const a = entry as Record<string, unknown>;
    const project = str(a, 'project', 64);
    if (!project || !PROJECT.test(project) || seen.has(project)) continue;
    const rows: AppBuild[] = [];
    const files = new Set<string>();
    for (const raw of Array.isArray(a.versions) ? a.versions : []) {
      if (rows.length >= VERSIONS_MAX) break;
      const b = build(base, project, raw);
      if (!b || files.has(b.file)) continue;
      files.add(b.file);
      rows.push(b);
    }
    const latest = build(base, project, a.latest) ?? rows[0];
    if (!latest) continue;
    seen.add(project);
    apps.push({
      project,
      name: str(a, 'name', 120) ?? project,
      platform: str(a, 'platform', 32) ?? 'android',
      latest,
      earlier: rows.filter((r) => r.file !== latest.file),
    });
  }
  apps.sort((x, y) => x.name.localeCompare(y.name));
  return { status: 'ok', updatedAt: str(j, 'updatedAt', 64), apps, error: '' };
}

/* ---------------------------------------------------------------- showing it */

/** "12.4 MB", for a size the catalog gave in bytes. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** "just now", "5 min ago", "3 h ago", "Oct 18" — or '—' when the time makes no sense. */
export function formatWhen(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const secs = Math.round((now - t) / 1000);
  if (secs < 0) return 'just now';
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 7 * 86_400) return `${Math.floor(secs / 86_400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The first 12 characters of a sha256, or '' when there isn't one. */
export const shortSha = (sha: string): string => (SHA.test(sha) ? sha.slice(0, 12) : '');

export interface Expiry {
  /** "28 min left", "expired", "—". */
  text: string;
  /** Under five minutes left: worth hurrying. */
  soon: boolean;
  expired: boolean;
}

/** How long an approval still has. The hub expires them after 30 minutes. */
export function expiry(approval: Pick<HubApproval, 'expiresAt'>, now: number = Date.now()): Expiry {
  const t = Date.parse(approval.expiresAt);
  if (!Number.isFinite(t)) return { text: '—', soon: false, expired: false };
  const secs = Math.round((t - now) / 1000);
  if (secs <= 0) return { text: 'expired', soon: false, expired: true };
  if (secs < 60) return { text: `${secs}s left`, soon: true, expired: false };
  const mins = Math.floor(secs / 60);
  return { text: `${mins} min left`, soon: mins < 5, expired: false };
}

/** What to tell someone when the hub didn't give us a list. */
export function statusNote(status: HubFeedStatus, error: string): string {
  if (status === 'signed-out') return 'Sign in to the hub to see this.';
  if (status === 'not-admin') return 'This hub account may not see this. An admin can grant it on the hub’s users page.';
  if (status === 'unreachable') return error || HUB_MESSAGES.unreachable;
  return '';
}

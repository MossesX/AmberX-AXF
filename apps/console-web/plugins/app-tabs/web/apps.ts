/**
 * Which apps can be tabs. An open list, merged from three places (later ones never replace an earlier id):
 *  1. BUILT_IN: the framework's apps that live outside this repo (Build Pilot) and the console itself
 *  2. project manifests (Standards → Projects) built with or for AmberX that have a deploy.url
 *  3. apps added in Settings → Plugins → App tabs (https only)
 * The app whose address is this page's own origin is "home": its tab shows this page, not a frame.
 */
export interface AppDef { id: string; name: string; url: string; icon: string; from: 'built-in' | 'manifest' | 'custom'; note?: string }

export const BUILT_IN: AppDef[] = [
  { id: 'axf-console-web', name: 'Console', url: 'https://console.amberxai.com', icon: 'terminal', from: 'built-in', note: 'AXF Dev Console' },
  { id: 'build-pilot', name: 'Pilot', url: 'https://pilot.amberxai.com', icon: 'rocket', from: 'built-in', note: 'Build Pilot app designer' },
  { id: 'axhub', name: 'axHub', url: 'https://axhub.amberxai.com/apps', icon: 'layers', from: 'built-in', note: 'axHub: apps catalog (approvals open in a new tab)' },
  { id: 'axf-demo', name: 'Demo', url: 'https://axf.amberxai.com', icon: 'layout', from: 'built-in', note: 'AXF demo site' },
];

/** Default tabs, in order: the console, Build Pilot and axHub. */
export const DEFAULT_TABS = ['axf-console-web', 'build-pilot', 'axhub'];

/**
 * Tabs added to the defaults after people had saved their own choice: each is added once to a saved list (then
 * remembered in `seenDefaults`), so removing it later sticks.
 */
export const LATER_DEFAULTS = ['axhub'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Only https addresses (http only for localhost while developing); no credentials in the URL. */
export function safeUrl(u: string): string | null {
  try {
    const x = new URL(u.trim());
    const local = x.hostname === 'localhost' || x.hostname === '127.0.0.1';
    if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) return null;
    if (x.username || x.password) return null;
    return x.href.replace(/\/$/, '');
  } catch { return null; }
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';

interface ManifestLike { name?: unknown; displayName?: unknown; kind?: unknown; deploy?: { url?: unknown }; framework?: { relation?: unknown } }

export function fromManifests(rows: { manifest?: ManifestLike | null }[]): AppDef[] {
  const out: AppDef[] = [];
  for (const r of rows) {
    const m = r.manifest;
    if (!m || typeof m.name !== 'string' || !ID_RE.test(m.name)) continue;
    const rel = m.framework?.relation;
    if (rel !== 'built-on' && rel !== 'for' && rel !== 'core') continue;
    const url = typeof m.deploy?.url === 'string' ? safeUrl(m.deploy.url) : null;
    if (!url) continue;
    out.push({ id: m.name, name: typeof m.displayName === 'string' ? m.displayName : m.name, url, icon: 'external', from: 'manifest' });
  }
  return out;
}

/** Custom apps are saved as one string per app: "id|name|url". */
export function parseCustom(list: unknown): AppDef[] {
  if (!Array.isArray(list)) return [];
  const out: AppDef[] = [];
  for (const s of list) {
    if (typeof s !== 'string') continue;
    const [id = '', name = '', ...rest] = s.split('|');
    const url = safeUrl(rest.join('|'));
    if (!ID_RE.test(id) || !name.trim() || !url) continue;
    out.push({ id, name: name.trim().slice(0, 40), url, icon: 'external', from: 'custom' });
  }
  return out;
}

export const encodeCustom = (a: Pick<AppDef, 'id' | 'name' | 'url'>) => `${a.id}|${a.name.replace(/\|/g, ' ')}|${a.url}`;

export function mergeApps(...lists: AppDef[][]): AppDef[] {
  const seen = new Map<string, AppDef>();
  const origins = new Set<string>();
  for (const l of lists) for (const a of l) {
    const origin = new URL(a.url).origin;
    if (seen.has(a.id) || origins.has(origin)) continue; // one tab per app and per address
    seen.set(a.id, a);
    origins.add(origin);
  }
  return [...seen.values()];
}

/** The console's own entry is always home here (this plugin runs inside the console), as is any app at this page's address. */
export const isHome = (a: AppDef, here: string) => { if (a.id === 'axf-console-web') return true; try { return new URL(a.url).origin === here; } catch { return false; } };

/** The tabs to show: saved order of chosen ids that still exist; the home app always included (first if missing). */
export function tabsFor(apps: AppDef[], chosen: string[] | null, here: string): AppDef[] {
  const ids = chosen ?? DEFAULT_TABS;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const tabs = ids.map((id) => byId.get(id)).filter((a): a is AppDef => !!a);
  const home = apps.find((a) => isHome(a, here));
  if (home && !tabs.includes(home)) tabs.unshift(home);
  return tabs;
}

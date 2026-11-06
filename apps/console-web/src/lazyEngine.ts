/**
 * Plugin lazy loader: the pure part (plugin-lazy@1). Config defaults + normalizer, usage frecency, the startup order
 * (banners first, then pins, then the most used), idle picks and least-recently-used eviction. No DOM, no React, so
 * tests run it directly (scripts/lazy-loader.test.mts). The loader (src/pluginLoader.tsx) applies it.
 */

export type LazyMode = 'start' | 'open' | 'off';

export interface LazyConfig {
  $axf: 'plugin-lazy@1';
  /** how many of the most-used plugins load at startup (usage frecency), on top of banners and pins */
  preloadCount: number;
  /** "always preload" pins (plugin folders) */
  pins: string[];
  /** banner plugins load before anything else and stay loaded (Brett, Nov 3 2026: "banners need to be the very first thing to load") */
  bannersFirst: boolean;
  /** the startup list's order, set by dragging; folders not in it follow in the default order */
  order: string[];
  /** load more in the background once the app is quiet */
  idle: { on: boolean; count: number };
  /** how many plugins loaded on open stay installed (least recently used goes back to its placeholder); offline chunk cache */
  cache: { size: number; offline: boolean; offlineMb: number };
  /** per plugin: load on start / load when opened / don't load at all */
  modes: Record<string, LazyMode>;
}

export const LAZY_DEFAULTS: LazyConfig = {
  $axf: 'plugin-lazy@1',
  preloadCount: 5,
  pins: [],
  bannersFirst: true,
  order: [],
  idle: { on: true, count: 5 },
  cache: { size: 15, offline: true, offlineMb: 25 },
  modes: {},
};

/**
 * Core plugins can't be switched off. The value is their default mode: console commands keeps the stream that lets a
 * Claude session drive the open console, so it loads on start; the systems check is a banner.
 */
export const CORE_PLUGINS: Record<string, Exclude<LazyMode, 'off'>> = {
  'plugin-manager': 'open',
  'console-commands': 'start',
  'console-terminal': 'open',
  'systems-check': 'start',
};

/**
 * Plugins that paint the banner (declared `banners`, or `register` calling `setBadge` / `attachToBanner`). The loader
 * learns this from each plugin's first load; this seed makes banners load first on a first visit too, before any
 * shape is known. `scripts/lazy-loader-check.mts` fails when a plugin paints the banner and is missing here.
 */
export const KNOWN_BANNERS: readonly string[] = [
  'activity', 'agent-voice', 'ai-assistant', 'approvals-banner', 'build-manager', 'build-profiles', 'builds-page',
  'claude-accounts', 'claude-badge', 'claude-handoff', 'claude-settings', 'codebase-changes', 'follow-amber', 'plan-studio', 'plugins-menu',
  'push-banner', 'systems-check', 'token-control', 'alerts-bell', 'main-build-status', 'whats-shipped', 'console-terminal',
  'notify-control', // no chip, but its register() plays sound and pop-ups and answers the browser senders
];

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const folders = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(x)))] : []);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Any stored or posted value → a full, valid config (unknown keys dropped, numbers clamped, core plugins never off). */
export function normalizeLazyConfig(raw: unknown): LazyConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const idle = (r.idle && typeof r.idle === 'object' ? r.idle : {}) as Record<string, unknown>;
  const cache = (r.cache && typeof r.cache === 'object' ? r.cache : {}) as Record<string, unknown>;
  const modes: Record<string, LazyMode> = {};
  if (r.modes && typeof r.modes === 'object') {
    for (const [k, v] of Object.entries(r.modes as Record<string, unknown>)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(k) || (v !== 'start' && v !== 'open' && v !== 'off')) continue;
      if (v === 'off' && CORE_PLUGINS[k]) continue;
      modes[k] = v;
    }
  }
  const d = LAZY_DEFAULTS;
  return {
    $axf: 'plugin-lazy@1',
    preloadCount: clampInt(r.preloadCount, 0, 50, d.preloadCount),
    pins: folders(r.pins),
    bannersFirst: bool(r.bannersFirst, d.bannersFirst),
    order: folders(r.order),
    idle: { on: bool(idle.on, d.idle.on), count: clampInt(idle.count, 0, 100, d.idle.count) },
    cache: { size: clampInt(cache.size, 1, 200, d.cache.size), offline: bool(cache.offline, d.cache.offline), offlineMb: clampInt(cache.offlineMb, 1, 500, d.cache.offlineMb) },
    modes,
  };
}

/** The mode a plugin runs in: its own choice, else its core default, else load when opened. */
export function modeOf(cfg: LazyConfig, folder: string): LazyMode {
  return cfg.modes[folder] ?? CORE_PLUGINS[folder] ?? 'open';
}

export interface UsageStat { uses: number; lastUsed: number; score: number }

/** Frecency half-life: a use counts half as much three days later. */
export const HALF_LIFE_MS = 3 * 24 * 3600_000;

export function decayed(s: UsageStat | undefined, now: number): number {
  if (!s) return 0;
  return s.score * Math.pow(0.5, Math.max(0, now - s.lastUsed) / HALF_LIFE_MS);
}

/** One more use, now. */
export function touch(s: UsageStat | undefined, now: number): UsageStat {
  return { uses: (s?.uses ?? 0) + 1, lastUsed: now, score: decayed(s, now) + 1 };
}

/** Plugins by frecency, most used first (ties: name order). */
export function byFrecency(list: string[], stats: Record<string, UsageStat>, now: number): string[] {
  return [...list].sort((a, b) => decayed(stats[b], now) - decayed(stats[a], now) || a.localeCompare(b));
}

export type StartReason = 'banner' | 'core' | 'pin' | 'start' | 'used' | 'learn';

export interface StartItem { folder: string; reason: StartReason }

/**
 * What loads at startup, in order. Banners (when `bannersFirst`) come first, then core plugins that load on start,
 * then pins and per-plugin "load on start", then the `preloadCount` most used (frecency), then any plugin whose shape
 * isn't known yet (it must load once so its menus and views can stand in for it later). The dragged `order` re-sorts
 * the list; banners keep position 1 unless the person dragged something above them.
 */
export function startupList(opts: {
  enabled: string[]; cfg: LazyConfig; banners: string[]; stats: Record<string, UsageStat>; now: number; unknown?: string[];
}): StartItem[] {
  const { enabled, cfg, stats, now } = opts;
  const on = new Set(enabled.filter((f) => modeOf(cfg, f) !== 'off'));
  const out: StartItem[] = [];
  const add = (folder: string, reason: StartReason) => { if (on.has(folder) && !out.some((x) => x.folder === folder)) out.push({ folder, reason }); };
  if (cfg.bannersFirst) for (const f of opts.banners) add(f, 'banner');
  for (const [f, m] of Object.entries(CORE_PLUGINS)) if (modeOf(cfg, f) === 'start' && m) add(f, 'core');
  for (const f of cfg.pins) add(f, 'pin');
  for (const f of enabled) if (cfg.modes[f] === 'start') add(f, 'start');
  const lazy = enabled.filter((f) => modeOf(cfg, f) === 'open' && !out.some((x) => x.folder === f) && (stats[f]?.uses ?? 0) > 0);
  for (const f of byFrecency(lazy, stats, now).slice(0, cfg.preloadCount)) add(f, 'used');
  const head = out.length;
  for (const f of opts.unknown ?? []) add(f, 'learn');
  if (!cfg.order.length) return out;
  // the dragged order sorts the chosen list; "learn" items stay at the end (they aren't a choice)
  const rank = (f: string) => { const i = cfg.order.indexOf(f); return i < 0 ? cfg.order.length : i; };
  const chosen = out.slice(0, head).map((x, i) => ({ x, i })).sort((a, b) => rank(a.x.folder) - rank(b.x.folder) || a.i - b.i).map((y) => y.x);
  return [...chosen, ...out.slice(head)];
}

/** What to load in the background when the app is quiet: the next most-used plugins that load on open. */
export function idlePicks(opts: { enabled: string[]; cfg: LazyConfig; loaded: Set<string>; stats: Record<string, UsageStat>; now: number }): string[] {
  const { cfg } = opts;
  if (!cfg.idle.on || cfg.idle.count <= 0) return [];
  const left = opts.enabled.filter((f) => modeOf(cfg, f) === 'open' && !opts.loaded.has(f));
  return byFrecency(left, opts.stats, opts.now).slice(0, cfg.idle.count);
}

/**
 * Plugins to take out of the shell when more than `cache.size` on-open plugins are installed: the least recently used
 * first. Never `keep` (banners, pins, start, core-on-start: they're not on-open plugins) and never what's on screen.
 */
export function evictions(opts: { installed: string[]; cfg: LazyConfig; lastUsed: Record<string, number>; keep: Set<string> }): string[] {
  const lru = opts.installed.filter((f) => !opts.keep.has(f) && modeOf(opts.cfg, f) === 'open');
  const extra = lru.length - opts.cfg.cache.size;
  if (extra <= 0) return [];
  return lru.sort((a, b) => (opts.lastUsed[a] ?? 0) - (opts.lastUsed[b] ?? 0)).slice(0, extra);
}

/** A dynamic import that failed to fetch or evaluate its file (a redeploy renamed the chunks, the network dropped). */
export function isChunkLoadError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|Loading chunk|Unable to preload|is not a valid JavaScript MIME type/i.test(m);
}

/** Imports a chunk; on a chunk-load error, tries once more before giving up (a blip, or a half-finished deploy). */
export async function importOnce<T>(imp: () => Promise<T>, waitMs = 600): Promise<T> {
  try { return await imp(); } catch (e) {
    if (!isChunkLoadError(e)) throw e;
    await new Promise((r) => setTimeout(r, waitMs));
    return imp();
  }
}

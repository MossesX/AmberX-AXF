/*
 * Main build status: the pure part (no React, no console imports), shared by the web part and the plugin's self-test
 * (`widget-check.mjs` replays it against the framework runtime). Theme-free: tones are widget tone names.
 */

export const ID = 'ai.amberx.axf.console.main-build-status';
export const ASSET_ID = 'main-build';
export const COUNTERS = { known: 'build.main.known', running: 'build.main.running', failing: 'build.main.failing' } as const;

export type BuildState = 'success' | 'failure' | 'running' | 'unknown';
export interface FailedJob { name: string; url: string }
export interface BuildItem {
  repo: string; branch: string; workflow: string; state: BuildState; conclusion?: string; title: string; name: string; sha: string;
  url: string; runNumber: number | null; event: string; startedAt: string; updatedAt: string; failedJobs: FailedJob[];
  previous: { state: string; updatedAt: string; url: string } | null; error: string;
}

export const TONE: Record<BuildState, 'success' | 'danger' | 'accent' | 'muted'> = { success: 'success', failure: 'danger', running: 'accent', unknown: 'muted' };
export const WORD: Record<BuildState, string> = { success: 'passed', failure: 'failed', running: 'running', unknown: 'unknown' };

/** "12s", "4m", "3h", "2d" since an ISO time ('' when it isn't one). */
export function shortAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`;
}

/** The banner's short line: "main ✓ 2m ago" · "main ✗ 5m ago" · "main ⟳ 3m" · "main ?" (… before the first answer). */
export function bannerText(it: BuildItem | null, now = Date.now()): string {
  if (!it) return 'main …';
  const b = it.branch;
  if (it.state === 'success') return `${b} ✓ ${shortAgo(it.updatedAt, now)} ago`;
  if (it.state === 'failure') return `${b} ✗ ${shortAgo(it.updatedAt, now)} ago`;
  if (it.state === 'running') return `${b} ⟳ ${shortAgo(it.startedAt, now)}`;
  return `${b} ?`;
}

/** The plugin's `status` widget asset for one answer (framework type, no new asset type). */
export function statusAsset(it: BuildItem | null, error: string, now = Date.now()) {
  const state: BuildState = it?.state ?? 'unknown';
  const text = error && !it ? 'main ?' : bannerText(it, now);
  return {
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Main build', version: '0.1.0', author: 'Main build status plugin',
    description: 'The last CI result of the watched branch, attached to the banner by the Main build status plugin.', tags: ['ci', 'status'],
    data: { counter: COUNTERS.known, onLabel: text, offLabel: text, onTone: TONE[state], offTone: 'muted', dot: true, link: 'main-build-status.open' },
  };
}

/** What the runtime needs to offer (structural, so this file imports nothing). */
export interface BannerHost {
  registry: { register(raw: unknown, source: 'app', origin: string): unknown };
  setBadge(name: string, n: number): void;
  attachToBanner(a: { type: string; id: string; at: 'left' | 'center' | 'right'; order?: number; origin: string }): unknown;
  detachFromBanner(keyOrOrigin: string): void;
}

/** Repaint the widget and the counters; attach it on the right, just after the clock (before the alerts bell at 30), or take it off when hidden. */
export function paintBuild(rt: BannerHost, it: BuildItem | null, error: string, show: boolean, now = Date.now()): void {
  rt.registry.register(statusAsset(it, error, now), 'app', ID);
  rt.setBadge(COUNTERS.known, it ? 1 : 0);
  rt.setBadge(COUNTERS.running, it?.state === 'running' ? 1 : 0);
  rt.setBadge(COUNTERS.failing, it?.state === 'failure' ? 1 : 0);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'right', order: 25, origin: ID });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

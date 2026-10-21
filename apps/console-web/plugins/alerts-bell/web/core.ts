/*
 * Alerts bell: the pure part (no React, no console imports), shared by the web part and the plugin's self-test
 * (`widget-check.mjs` replays it against the framework runtime).
 */

export const ID = 'ai.amberx.axf.console.alerts-bell';
export const ASSET_ID = 'alerts-bell';
/** The alerts library's unread counter (framework/libs/alerts → ALERTS_BADGE). */
export const COUNTER = 'alerts.unread';
export const SIDES = ['right', 'left'] as const;
export type Side = (typeof SIDES)[number];

/** Two framework widgets (no new asset type): the bell button and the unread counter next to it. */
export const ASSETS = [
  {
    $axf: 'asset@1', type: 'action-button', id: ASSET_ID, name: 'Alerts bell', version: '0.1.0', author: 'Alerts bell plugin',
    description: 'Opens the developer alerts view; attached to the banner by the Alerts bell plugin.', tags: ['alerts', 'bell'],
    data: { icon: 'bell', label: 'Alerts', action: 'alerts.open', show: 'icon', tone: 'neutral', tooltip: 'Alerts' },
  },
  {
    $axf: 'asset@1', type: 'counter', id: ASSET_ID, name: 'Unread alerts', version: '0.1.0', author: 'Alerts bell plugin',
    description: 'Unread developer alerts (counter alerts.unread), hidden at zero; attached next to the bell by the Alerts bell plugin.', tags: ['alerts', 'counter'],
    data: { counter: COUNTER, tone: 'danger', hideAtZero: true, max: 99, link: 'alerts.open' },
  },
] as const;

/** The side the bell sits on; anything else stored falls back to the right. */
export const sideOf = (v: unknown): Side => (v === 'left' ? 'left' : 'right');
/** Shown unless switched off (missing / unreadable settings = shown). */
export const showOf = (v: unknown) => v !== false;

/** What the runtime needs to offer (structural, so this file imports nothing). */
export interface BannerHost {
  registry: { register(raw: unknown, source: 'app', origin: string): unknown };
  attachToBanner(a: { type: string; id: string; at: 'left' | 'center' | 'right'; order?: number; origin: string }): unknown;
  detachFromBanner(keyOrOrigin: string): void;
}

/** Register the two assets and put them on the banner after the clock (or take them off when hidden). */
export function placeBell(rt: BannerHost, show: boolean, side: Side): void {
  for (const a of ASSETS) rt.registry.register(a, 'app', ID);
  rt.detachFromBanner(ID);
  if (!show) return;
  rt.attachToBanner({ type: 'action-button', id: ASSET_ID, at: side, order: 30, origin: ID });
  rt.attachToBanner({ type: 'counter', id: ASSET_ID, at: side, order: 31, origin: ID });
}

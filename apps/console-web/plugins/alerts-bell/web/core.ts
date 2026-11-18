/*
 * Alerts bell: the pure part (no React, no console imports), shared by the web part and the plugin's self-test
 * (`widget-check.mjs` replays it against the framework runtime).
 */

export const ID = 'ai.amberx.axf.console.alerts-bell';
export const ASSET_ID = 'alerts-bell';
/** The alerts library's unread counter (framework/libs/alerts → ALERTS_BADGE). */
export const COUNTER = 'alerts.unread';

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


/** Hands a banner widget its data (the console's banner data service, axf.banner-data@1); null = nothing to show. */
export type Supply = (widget: string, s: { type: 'status' | 'counter' | 'badge' | 'action-button'; name?: string; description?: string; tags?: string[]; data: Record<string, unknown> } | null) => void;
/** An asset's envelope as banner data: the banner widgets plugin registers and draws it. */
const asData = (a: { type: string; name: string; description: string; tags: string[]; data: Record<string, unknown> }) => ({ type: a.type as 'status', name: a.name, description: a.description, tags: a.tags, data: a.data });
/** The banner data ids of the bell and its count. */
export const WIDGETS = { bell: 'alerts-bell', count: 'alerts-count' } as const;

/** Hand the bell and its count to the banner widgets plugin, which draws them and owns their show and side settings. */
export function supplyBell(supply: Supply): void {
  supply(WIDGETS.bell, asData(ASSETS[0] as never));
  supply(WIDGETS.count, asData(ASSETS[1] as never));
}

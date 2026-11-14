/**
 * Start / stop of the plugin's live parts: the host (swaps), the switch sync and the API. `register` may run several
 * times (the console re-installs its libraries when plugins change): the first call starts everything, later calls
 * do nothing while it runs; when the console takes the plugin away (its settings tab goes) everything stops and every
 * control is native again, and a later register (switched back on) starts it afresh.
 */
import type { AxfRuntime } from '@console/axf/core';
import { registerApi } from './api';
import { ELEMENT_FAMILIES, GLOBAL_FAMILIES } from './families';
import { liveHost, startHost } from './host';
import { startSync } from './sync';
import { recentColors } from './families/color';
import { TOKEN_SETTINGS, tokenValue } from './tokens';

let running: (() => void) | null = null;

export function boot(rt: AxfRuntime): void {
  if (running || typeof document === 'undefined') return;
  const offApi = registerApi(rt);
  const offSync = startSync(rt, () => ({ ...(liveHost()?.report() ?? {}), recentColors: recentColors(), tokens: Object.fromEntries(TOKEN_SETTINGS.map((t) => [t.path, tokenValue(rt, t.path)])) }));
  let offHost: () => void = () => undefined;
  const stop = () => { offHost(); offSync(); offApi(); running = null; };
  running = stop;
  const go = () => { if (running === stop) offHost = startHost(rt, { elements: ELEMENT_FAMILIES, globals: GLOBAL_FAMILIES }, stop); };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
}

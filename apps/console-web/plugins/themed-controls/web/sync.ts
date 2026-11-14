/**
 * Switches in step with the server (themed-controls@1 → API). The switches are the console's own settings; the
 * plugin's server keeps the desired values with a revision number so REST / MCP / the CLI can read and change them
 * with no console open. Here: on start, on focus and every half minute the console reads /state and takes a newer
 * revision; a change made on this screen is reported (with the revision it was made on, so an older screen never
 * overwrites a newer API change). The live report (what is themed, what is open) rides the same call, throttled.
 */
import type { AxfRuntime } from '@console/axf/core';
import { TC_KEYS, THEMED_FAMILIES } from '@console/axf/core/engines/themed-controls';
import { pluginApi } from '@console/plugins';
import { FOLDER } from './settings';

const REV_KEY = 'axf.themedControls.rev';
const POLL_MS = 30_000;
const LIVE_MS = 4_000;
export const api = pluginApi(FOLDER, 'Themed controls');

export interface ServerState {
  rev: number;
  on: boolean;
  sheet: boolean;
  families: Record<string, boolean>;
}

const KEYS = [TC_KEYS.on, TC_KEYS.sheet, ...THEMED_FAMILIES.map((f) => TC_KEYS.family(f))];
const readRev = (): number => Number(globalThis.localStorage?.getItem(REV_KEY)) || 0;
const writeRev = (n: number) => { try { globalThis.localStorage?.setItem(REV_KEY, String(n)); } catch { /* private mode */ } };

export function localValues(rt: AxfRuntime): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of KEYS) out[k] = rt.settings.get(k) !== false;
  return out;
}

function serverValues(s: ServerState): Record<string, boolean> {
  const out: Record<string, boolean> = { [TC_KEYS.on]: s.on, [TC_KEYS.sheet]: s.sheet };
  for (const f of THEMED_FAMILIES) out[TC_KEYS.family(f)] = s.families?.[f] !== false;
  return out;
}

/** Start syncing; returns the stopper. `live()` is the host's current report. */
export function startSync(rt: AxfRuntime, live: () => Record<string, unknown>): () => void {
  let applying = false;
  let stopped = false;
  let lastLive = '';

  const pull = async () => {
    if (stopped) return;
    try {
      const s = await api.call<ServerState>('state');
      if (s.rev > readRev()) {
        applying = true;
        try { for (const [k, v] of Object.entries(serverValues(s))) if ((rt.settings.get(k) !== false) !== v) rt.settings.set(k, v); } finally { applying = false; }
        writeRev(s.rev);
      }
    } catch { /* server part off or no token: the local switches stand */ }
  };

  const report = async (withSettings: boolean) => {
    if (stopped) return;
    const l = live();
    const liveText = JSON.stringify(l);
    if (!withSettings && liveText === lastLive) return;
    lastLive = liveText;
    try {
      const r = await api.post<{ rev: number }>('report', { ...(withSettings ? { settings: localValues(rt), rev: readRev() } : {}), live: l });
      if (withSettings && typeof r.rev === 'number') writeRev(r.rev);
    } catch { /* nothing to do: the next pull settles it */ }
  };

  const offChange = rt.settings.onAnyChange((key) => {
    if (applying || !KEYS.includes(key)) return;
    void report(true);
  });
  const onFocus = () => { if (globalThis.document?.visibilityState !== 'hidden') void pull(); };
  globalThis.addEventListener?.('focus', onFocus);
  globalThis.document?.addEventListener('visibilitychange', onFocus);
  const poll = globalThis.setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') void pull(); }, POLL_MS);
  const liveTimer = globalThis.setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') void report(false); }, LIVE_MS);
  void pull();

  return () => {
    stopped = true;
    offChange();
    globalThis.removeEventListener?.('focus', onFocus);
    globalThis.document?.removeEventListener('visibilitychange', onFocus);
    globalThis.clearInterval(poll);
    globalThis.clearInterval(liveTimer);
  };
}

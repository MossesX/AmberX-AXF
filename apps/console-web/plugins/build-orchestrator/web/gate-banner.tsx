import { useEffect, useSyncExternalStore } from 'react';
import { Button, Chip, Note, SelectField, useKnownBanners, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import { loadGateLog, type GateEntry } from './gate-log';

/*
 * Server gate log widget (build server-gate-one-session-per-build-no-duplicate-launches, s5, Nov 12 2026): a count badge
 * of the server gate hits in the last day and the latest one; a tap opens the Server gate log page. It is a snappable
 * asset: the counter asset `server-gate-hits` (badge `server-gate.hits`) plus this widget. Where it shows is one setting
 * kept on the server (framework/cli/server-gate.mjs banner), so the console, REST (GET / POST gate-banner), the MCP
 * commands gate-banner / gate-banner-set, the CLI (`server-gate.mjs banner --place …`) and voice switch the same one:
 *   own   its own banner strip across the top (slot app.frame.banners), drawn only while it has hits (default)
 *   bar   the app banner bar, beside the other banner widgets
 *   off   nowhere
 *   <id>  snapped into an existing banner (the framework's banner.extras slot in every banner frame)
 * Every open console re-reads it every 30 s, and at once after a change made here or through the console action
 * build-orchestrator.gate-banner:<place>.
 */

export const OWN_BANNER = 'server-gate';
export const BADGE = 'server-gate.hits';
const ASSET = 'server-gate-hits';
const ORIGIN = 'ai.amberx.axf.console.build-orchestrator.gate';
const POLL_MS = 30_000;
const DAY_MS = 24 * 3600e3;

type Snap = { place: string; recent: number; latest: GateEntry | null; error: string };
let snap: Snap = { place: 'own', recent: 0, latest: null, error: '' };
const subs = new Set<() => void>();
const emit = (next: Partial<Snap>) => { snap = { ...snap, ...next }; subs.forEach((f) => f()); };
const useSnap = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap, () => snap);

const api = pluginApi('build-orchestrator', 'Server gate log widget', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

let rtRef: AxfRuntime | null = null;
function paint() {
  const rt = rtRef; if (!rt) return;
  rt.setBadge(BADGE, snap.recent);
  if (snap.place === 'bar') rt.attachToBanner({ type: 'counter', id: ASSET, at: 'right', order: 26, origin: ORIGIN, widget: { label: 'Server gate hits', icon: 'shield', size: 'compact', priority: 3, aliases: ['gate log', 'server gates', 'gate hits'] } });
  else rt.detachFromBanner(`counter:${ASSET}`);
}

export async function refreshGateBanner(): Promise<void> {
  try {
    const [log, place] = await Promise.all([loadGateLog('', 100), api.call<{ place: string }>('gate-banner')]);
    const since = new Date(Date.now() - DAY_MS).toISOString();
    emit({ recent: log.entries.filter((e) => e.at > since).length, latest: log.entries[0] ?? null, place: place.place || 'own', error: '' });
  } catch (e) { emit({ error: (e as Error).message }); }
  paint();
}

export async function setGatePlace(place: string): Promise<string> {
  const r = await api.post<{ place: string }>('gate-banner', { place });
  emit({ place: r.place }); paint();
  return r.place;
}

let started = false;
/** Register the counter asset and start the poll (once per page). */
export function startGateBanner(rt: AxfRuntime) {
  rtRef = rt;
  if (started) return; started = true;
  rt.registry.register({
    $axf: 'asset@1', type: 'counter', id: ASSET, name: 'Server gate hits', version: '0.1.0', author: 'Build orchestrator',
    description: 'Server gate hits on the VPS in the last day (duplicate launches refused, duplicates reaped, slot limit, dispatch gate, main gate). Tap: the Server gate log.', tags: ['builds', 'server gate'],
    data: { counter: BADGE, tone: 'warning', hideAtZero: true, label: 'gate hits', link: 'nav:server-gate-log', icon: 'shield' },
  }, 'app', ORIGIN);
  void refreshGateBanner();
  setInterval(() => void refreshGateBanner(), POLL_MS);
}

/** The widget: count badge + the latest hit; a tap opens the Server gate log. */
function GateWidget() {
  const rt = useRuntime();
  const s = useSnap();
  const e = s.latest;
  return (
    <div className="fx-row fx-row--wrap" data-axf-widget="server-gate-hits">
      <Button size="sm" tone="ghost" icon="shield" onClick={() => rt.dispatch('build-orchestrator.gate-log')} aria-label={`Server gate log: ${s.recent} hit${s.recent === 1 ? '' : 's'} in the last day. Open it`}>
        Server gates <Chip tone="warning">{s.recent}</Chip>
      </Button>
      {e && <span className="fx-small fx-muted">Latest: {e.action}{e.build ? ` · ${e.build}` : ''}</span>}
    </div>
  );
}

/** Its own banner: drawn only while it is the chosen place and there were hits in the last day. */
export function GateOwnBanner() {
  const s = useSnap();
  if (s.place !== 'own' || !s.recent) return null;
  return <div className="fx-banner-frame" data-fx-banner-id={OWN_BANNER} role="region" aria-label="Server gate log"><GateWidget /></div>;
}

/** banner.extras: inside the banner the person picked. */
export function GateInBanner({ banner }: { banner: string }) {
  const s = useSnap();
  if (!banner || banner === OWN_BANNER || s.place !== banner || !s.recent) return null;
  return <GateWidget />;
}

/** Settings → Plugins → Build orchestrator: where the widget shows (live). */
export function GateBannerPanel() {
  const rt = useRuntime();
  const s = useSnap();
  const banners = useKnownBanners();
  useEffect(() => { void refreshGateBanner(); }, []);
  const options = [
    { value: 'own', label: 'Its own banner (only when there are hits)' },
    { value: 'bar', label: 'The app banner bar' },
    ...banners.filter((b) => b.id !== OWN_BANNER).map((b) => ({ value: b.id, label: `In the ${b.label || b.id} banner` })),
    { value: 'off', label: 'Nowhere' },
  ];
  if (!options.some((o) => o.value === s.place)) options.push({ value: s.place, label: `In the ${s.place} banner (not on this page)` });
  return (
    <div className="fx-stack">
      <SelectField label="Where the Server gate log widget shows" value={s.place} options={options}
        onChange={(v) => void setGatePlace(v).then((p) => rt.toast(`Server gate log widget: ${options.find((o) => o.value === p)?.label ?? p}`, 'success')).catch((err: Error) => rt.toast(err.message, 'danger'))} />
      <p className="fx-small fx-muted">{s.recent} gate hit{s.recent === 1 ? '' : 's'} in the last day. Also: REST gate-banner, MCP gate-banner-set, <code>server-gate.mjs banner --place …</code>, or say "put the gate log in the approvals banner".</p>
      {s.error && <Note tone="warning">{s.error}</Note>}
    </div>
  );
}

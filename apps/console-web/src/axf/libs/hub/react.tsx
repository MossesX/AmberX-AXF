/**
 * lib-hub (web) — React pieces every AXF web app can use to show axHub (harvested Oct 23 2026, Opus, out of the AXHub
 * web app `apps/axhub-web`). Kept apart from `index.ts` so the rules stay framework-agnostic (Node tests import those).
 *
 *   import { useHubApprovals, useHubApps, useHubBannerCount, HubApprovalList, HubStatusNote } from '<app>/axf/libs/hub/react';
 *
 * - {@link useHubApprovals}: one shared {@link HubWatcher} per hub address, polled while the page is visible.
 * - {@link useHubApps}: the app catalog, read when the view opens and on {@link HUB_CHECK_EVENT}.
 * - {@link useHubBannerCount}: mirrors the waiting count into a runtime counter (default `approvals.waiting`) and,
 *   when asked, attaches a counter asset to the banner (badge widgets, app-menu badges and toolbars read it).
 * - {@link HubApprovalList} / {@link HubStatusNote}: the approvals cards and the "why is this empty" note.
 *
 * Nothing here holds a token or can approve: reads use the browser's own hub session and Review opens the hub's page.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Icon, Note, useRuntime } from '../../react';
import { HubWatcher, accountUrl, loginUrl, normalizeHub, HUB_DEFAULT, type HubWatchState } from './index';
import { expiry, fetchHubApps, formatWhen, statusNote, type AppsFeed } from './apps';
import { HUB_SOURCE_ICON, HUB_SOURCE_TONE, sourceText, type HubSource } from './source';

/** Window event that asks every open hub view to read the hub again (an app's "Check now" action fires it). */
export const HUB_CHECK_EVENT = 'axf:hub-check';
export const checkHubNow = (): void => { globalThis.dispatchEvent?.(new Event(HUB_CHECK_EVENT)); };

const watchers = new Map<string, HubWatcher>();
/** The one watcher for this hub address (shared by every view and the banner count). */
export function hubWatcher(hub: string, everyMs = 5_000): HubWatcher {
  const key = normalizeHub(hub) ?? HUB_DEFAULT;
  let w = watchers.get(key);
  if (!w) { w = new HubWatcher({ hub: key, everyMs }); watchers.set(key, w); }
  return w;
}

/** The approvals feed for `hub`, live while at least one component uses it. */
export function useHubApprovals(hub: string): { state: HubWatchState; refresh: () => void } {
  const w = hubWatcher(hub);
  const state = useSyncExternalStore(w.subscribe, () => w.state, () => w.state);
  useEffect(() => {
    users.set(w, (users.get(w) ?? 0) + 1);
    w.start();
    const again = () => void w.check();
    globalThis.addEventListener?.(HUB_CHECK_EVENT, again);
    return () => {
      globalThis.removeEventListener?.(HUB_CHECK_EVENT, again);
      // Other users of the same watcher keep it running; the last one out stops it.
      const left = (users.get(w) ?? 1) - 1;
      users.set(w, left);
      if (left <= 0) w.stop();
    };
  }, [w]);
  return { state, refresh: useCallback(() => void w.check(), [w]) };
}
const users = new Map<HubWatcher, number>();

/** The app catalog for `hub`: read once when mounted, again on refresh or {@link HUB_CHECK_EVENT}. */
export function useHubApps(hub: string): { feed: AppsFeed | null; loading: boolean; refresh: () => void } {
  const [feed, setFeed] = useState<AppsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(() => {
    setLoading(true);
    void fetchHubApps(hub).then((f) => { if (alive.current) { setFeed(f); setLoading(false); } });
  }, [hub]);
  useEffect(() => {
    alive.current = true;
    load();
    globalThis.addEventListener?.(HUB_CHECK_EVENT, load);
    return () => { alive.current = false; globalThis.removeEventListener?.(HUB_CHECK_EVENT, load); };
  }, [load]);
  return useMemo(() => ({ feed, loading, refresh: load }), [feed, loading, load]);
}

export interface HubBannerCountOptions {
  /** Runtime counter to keep in step with the waiting count (default `approvals.waiting`). */
  counter?: string;
  /** Attach this counter asset to the banner while mounted (e.g. `{ id: 'approvals', at: 'right', order: 29 }`). */
  banner?: { id: string; at?: 'left' | 'center' | 'right'; order?: number };
  /** Origin for the banner attachment (removed with it). */
  origin?: string;
}

/**
 * Keeps a runtime counter equal to the number of approvals waiting (0 while signed out or unreachable), and optionally
 * puts a counter widget on the banner. Mount it once near the root (it polls through the shared watcher).
 */
export function useHubBannerCount(hub: string, opts: HubBannerCountOptions = {}): void {
  const rt = useRuntime();
  const { state } = useHubApprovals(hub);
  const counter = opts.counter ?? 'approvals.waiting';
  const n = state.status === 'ok' ? state.count : 0;
  useEffect(() => { rt.setBadge(counter, n); }, [rt, counter, n]);
  const b = opts.banner;
  const origin = opts.origin ?? 'ai.amberx.axf.hub';
  useEffect(() => {
    if (!b || !rt.registry.has('counter', b.id)) return undefined;
    return rt.attachToBanner({ type: 'counter', id: b.id, at: b.at ?? 'right', order: b.order, origin });
  }, [rt, b?.id, b?.at, b?.order, origin]);
}

const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

/** Why a hub list is empty: sign in, ask for a permission, or the hub can't be reached. Nothing when all is well. */
export function HubStatusNote({ hub, state, what = 'this' }: { hub: string; state: Pick<HubWatchState, 'status' | 'error'> & { phase?: string }; what?: string }) {
  if (state.status === 'signed-out') {
    return (
      <Note tone="warning" icon="shield">
        {statusNote('signed-out', '').replace('this', what)}{' '}
        <a href={loginUrl(hub)} target="_blank" rel="noopener noreferrer">Sign in to axHub</a>
      </Note>
    );
  }
  if (state.status === 'not-admin') {
    return (
      <Note tone="warning" icon="shield">
        {statusNote('not-admin', '').replace('this', what)}{' '}
        <a href={accountUrl(hub)} target="_blank" rel="noopener noreferrer">Your hub account</a>
      </Note>
    );
  }
  if (state.status === 'unreachable' && state.phase !== 'idle') return <Note tone="danger" icon="alert">{statusNote('unreachable', state.error)}</Note>;
  return null;
}

/**
 * Who asked (axHub decision 108): the source badge (Claude.ai / Claude Code / Headless / Console / Agent / System) and
 * the session, build or agent name. Nothing when the hub didn't say (an older hub). Framework Chip + Icon only.
 */
export function HubSourceBadge({ source, who = true }: { source: HubSource | null | undefined; who?: boolean }) {
  if (!source) return null;
  const name = who && source.who && source.who !== source.label ? source.who : '';
  return (
    <span className="fx-row axf-hub-source" title={[sourceText(source), source.client].filter(Boolean).join(' · ')} data-source={source.kind}>
      <Chip tone={HUB_SOURCE_TONE[source.kind]}><Icon name={HUB_SOURCE_ICON[source.kind]} size={12} /> {source.label}</Chip>
      {name && <strong className="axf-hub-source__who">{name}</strong>}
    </span>
  );
}

/**
 * The approvals waiting, one card each (tool, what it runs, when it was asked, time left) with **Review on the hub**.
 * Shows an "All clear" card when nothing waits and a "more than shown" note when the hub has more than the feed lists.
 */
export function HubApprovalList({ state }: { state: HubWatchState }) {
  const checked = state.phase === 'checked';
  if (state.status !== 'ok') return null;
  return (
    <div className="fx-stack">
      {checked && state.pending.length === 0 && (
        <Container title="All clear" icon="check">
          <p className="fx-muted">
            No call is waiting. Reads run on their own; anything that writes, deletes or runs a command shows up here within
            a few seconds.
          </p>
        </Container>
      )}
      {state.pending.map((a) => {
        const left = expiry(a);
        return (
          <Container key={a.id} title={a.title || a.tool} icon="shield">
            <div className="fx-stack">
              {/* Who asked (axHub 108), then the tool as a small chip under the reason title. */}
              <div className="fx-row fx-row--wrap">
                <HubSourceBadge source={a.source} />
                {a.title && <Chip>{a.tool}</Chip>}
              </div>
              {a.summary && <p className="fx-mono">{a.summary}</p>}
              <div className="fx-row fx-row--wrap fx-muted">
                <span><Icon name="clock" /> asked {formatWhen(a.createdAt)}</span>
                <Chip tone={left.expired ? 'danger' : left.soon ? 'warning' : undefined}>{left.text}</Chip>
              </div>
              <div className="fx-row">
                <Button tone="primary" icon="external" disabled={left.expired} onClick={() => open(a.url)}>Review on the hub</Button>
              </div>
            </div>
          </Container>
        );
      })}
      {checked && state.count > state.pending.length && (
        <Note tone="info" icon="list">
          {state.count - state.pending.length} more are waiting than this list shows.{' '}
          <a href={state.approvalsUrl} target="_blank" rel="noopener noreferrer">See them all on the hub</a>
        </Note>
      )}
    </div>
  );
}

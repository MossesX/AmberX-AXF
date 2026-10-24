/*
 * axHub status badge: the pure part (no React, no DOM), shared by the library and its self-test
 * (`framework/spec/check-hubstatus.mts`).
 *
 * The rule (Brett, Oct 24 2026): the badge is **red** unless this app is reading its settings **live** from axHub right
 * now, and **green** only while it is. So it starts red ("checking") and turns green after the first live read; it goes
 * red again the moment a read fails, the answer is too old, the browser is signed out of the hub, or the app's own
 * hub settings source (the runtime's appearance source) isn't ready. A cached copy, a repo copy or local settings never
 * count as live.
 */

import { stateLookFor, type StateLook } from '../../core/engines/iconpick';

export const ID = 'ai.amberx.axf.hubstatus';
export const ASSET_ID = 'axhub';
export const COUNTER = 'hub.live';
/** The settings document every developer app reads (engines/appearance.ts). */
export const SETTINGS_PATH = 'shared/settings/appearance.json';

export type HubLive = 'checking' | 'live' | 'not-live';

/** One live read of the settings document on axHub. */
export interface HubProbe {
  /** The hub answered with the document (200) or said nothing is saved yet (404): settings come from the hub. */
  ok: boolean;
  /** Epoch ms of the read. */
  at: number;
  /** How long the read took. */
  ms: number;
  /** HTTP status, 0 when the hub wasn't reached. */
  status: number;
  /** Why it isn't live (empty when ok). */
  reason: string;
  /** The document's version (ETag) when the hub sent one. */
  version?: string;
}

/** What the runtime says about the app's own hub settings source (AppearanceSourceState, structural). */
export type SourceState = { status: 'connecting' | 'ready' | 'unauthorized' | 'unreachable'; reason?: string } | null;

export interface HubStatus {
  live: HubLive;
  /** One line for the badge's tooltip and the details panel. */
  why: string;
}

/** The decision. `staleMs`: a read older than this no longer counts as live (default 2 × the check period). */
export function hubLive(probe: HubProbe | null, source: SourceState, now: number, staleMs: number): HubStatus {
  if (source && source.status !== 'ready') {
    if (source.status === 'connecting') return { live: probe ? 'not-live' : 'checking', why: 'Connecting to axHub for this app’s settings…' };
    return { live: 'not-live', why: source.reason || (source.status === 'unauthorized' ? 'Not signed in to axHub.' : 'axHub is unreachable.') };
  }
  if (!probe) return { live: 'checking', why: 'Checking axHub…' };
  if (!probe.ok) return { live: 'not-live', why: probe.reason || 'axHub didn’t answer.' };
  if (now - probe.at > staleMs) return { live: 'not-live', why: `No live read from axHub for ${Math.round((now - probe.at) / 1000)} s.` };
  return { live: 'live', why: 'Settings are coming live from axHub.' };
}

/** Map one HTTP answer (or a network failure) to a probe. */
export function probeFrom(status: number, at: number, ms: number, hub: string, error = '', version?: string): HubProbe {
  const host = hostOf(hub);
  if (status === 0) return { ok: false, at, ms, status, reason: `Can’t reach ${host}${error ? ` (${error})` : ''}.` };
  if (status === 200 || status === 404) return { ok: true, at, ms, status, reason: '', ...(version ? { version } : {}) };
  if (status === 401) return { ok: false, at, ms, status, reason: `Not signed in to ${host}.` };
  if (status === 403) return { ok: false, at, ms, status, reason: `${host} doesn’t let this site or account read settings.` };
  if (status >= 300 && status < 400) return { ok: false, at, ms, status, reason: `${host} redirected (refused, so no session follows it).` };
  return { ok: false, at, ms, status, reason: `${host} answered ${status}.` };
}

export function hostOf(hub: string): string {
  try { return new URL(hub).host; } catch { return hub; }
}

/** The settings document's URL on a hub. */
export const settingsUrl = (hub: string) => `${new URL(hub).origin}/data/${SETTINGS_PATH}`;

export interface BadgeLook {
  /** Words on the badge in each state. */
  liveLabel: string;
  notLiveLabel: string;
  checkingLabel: string;
  /** Show the dot. */
  dot: boolean;
  /** Icon before the words: a name or an icon pick (`name@anim`, `name@anim:still`); empty = none. */
  icon?: string;
  /** Per-state icon / colours (two icons, or one icon in two colours); wins over `icon` when set. */
  state?: StateLook;
}
export const DEFAULT_LOOK: BadgeLook = { liveLabel: 'axHub', notLiveLabel: 'axHub off', checkingLabel: 'axHub …', dot: true };

/** The badge = the framework's `status` widget (no new asset type): green while live, red otherwise. */
export function statusAsset(s: HubStatus, look: BadgeLook = DEFAULT_LOOK) {
  const off = s.live === 'checking' ? look.checkingLabel : look.notLiveLabel;
  const per = look.state ? stateLookFor(look.state, s.live === 'live') : null;
  const icon = per ? per.icon : look.icon;
  const tones = look.state ? { onTone: look.state.onTone, offTone: look.state.offTone } : { onTone: 'success', offTone: 'danger' };
  return {
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'axHub', version: '0.1.0', author: 'axHub status library',
    description: 'Green only while this app reads its settings live from axHub; red otherwise (also while checking).', tags: ['axhub', 'status'],
    data: { counter: COUNTER, onLabel: look.liveLabel || DEFAULT_LOOK.liveLabel, offLabel: off || DEFAULT_LOOK.notLiveLabel, ...tones, dot: look.dot, ...(icon ? { icon } : {}), link: 'hubstatus.open' },
  };
}

/** Pop-up text when the state changes (null = no pop-up: the first check that comes back live stays quiet). */
export function changeNote(prev: HubLive | null, next: HubLive): string | null {
  if (prev === next || next === 'checking') return null;
  if (next === 'live') return prev === 'not-live' ? 'axHub is back: settings are live again.' : null;
  return 'axHub isn’t live: settings aren’t coming from axHub right now.';
}

/** Check period in seconds, kept within 10 s – 10 min. */
export const clampEvery = (s: unknown) => { const n = Math.round(Number(s)); return Number.isFinite(n) ? Math.min(600, Math.max(10, n)) : 30; };
/** Pop-up seconds, 1 – 60. */
export const clampSeconds = (s: unknown) => { const n = Math.round(Number(s)); return Number.isFinite(n) ? Math.min(60, Math.max(1, n)) : 5; };

/** "12s", "4m", "3h" since `at`. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

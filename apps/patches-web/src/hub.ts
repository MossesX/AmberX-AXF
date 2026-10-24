/**
 * axHub connection badge (Brett, Oct 24 2026): the Claude badge's twin for the hub. On every load Patches asks its
 * server (GET /api/hub → the Dev Console's hub-connection plugin) whether the console's axHub token connects, and
 * repaints its attachable badge `badge/hub-connection` (top left of the `patches` banner, after the Claude badge):
 * green + the hub account (or the hub's host), or red + "No axHub connection · check keys" (tap opens the console).
 */
import { normalizeStateLook, stateLookFor, type AxfRuntime } from './axf/core';
import { api, type Me } from './api';
import base from './assets/badge/hub-connection.json';

export interface HubStatus { at?: number; ok: boolean; hub?: string; account?: string; error?: string; look?: unknown }

export const NO_HUB = 'No axHub connection · check keys';

const host = (u?: string) => { try { return u ? new URL(u).host : ''; } catch { return ''; } };

/** The badge's data for a check result (null = still checking); `who` = the signed-in hub account. Pure. */
export function hubBadgeData(s: HubStatus | null, who = '') {
  if (!s) return { ...base.data };
  const { icon, tone } = stateLookFor(normalizeStateLook(s.look, base.data.icon), s.ok);
  if (s.ok) return { ...base.data, icon, tone, label: s.account || who || host(s.hub) || 'axHub', tooltip: `axHub connected${s.hub ? ` · ${host(s.hub)}` : ''}`, link: 'patches.hub.check' };
  return { ...base.data, icon, tone, label: NO_HUB, tooltip: `No axHub connection${s.error ? `: ${s.error}` : ''}. Tap to check the keys.`, link: 'patches.hub.keys' };
}

export function paintHub(rt: AxfRuntime, s: HubStatus | null, who = '') {
  rt.registry.register({ ...base, data: hubBadgeData(s, who) }, 'app', 'patches-web.hub');
  rt.attachToBanner({ type: 'badge', id: base.id, at: 'left', order: 1, origin: 'patches-web.hub' });
}

let running: Promise<HubStatus> | null = null;

/** Check the hub connection and repaint the badge (one check at a time). */
export function checkHub(rt: AxfRuntime, refresh = false): Promise<HubStatus> {
  if (running) return running;
  paintHub(rt, null);
  running = Promise.all([
    api<HubStatus>(`/hub${refresh ? '?refresh=true' : ''}`),
    api<Me>('/me').catch(() => null),
  ]).then(([r, me]) => {
    const s: HubStatus = r.ok && r.data ? r.data : { ok: false, error: r.error || `Patches' server answered ${r.status}` };
    paintHub(rt, s, me && me.ok && me.data?.user ? me.data.user.name : '');
    return s;
  }).finally(() => { running = null; });
  return running;
}

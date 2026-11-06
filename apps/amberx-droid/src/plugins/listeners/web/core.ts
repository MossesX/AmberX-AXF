/**
 * Listeners plugin, the pure part (no React, no network; checked by apps/amberx-droid/test.mjs): the page's own rows
 * added to the native ones, the device's name and id, which listener should get the mic lease's holder label, and the
 * settings the plugin declares (every policy of every listener, so they sync through axHub).
 */
import { LISTENERS, deviceDoc, normalizeInfo, policySettings, type DeviceListeners, type ListenerInfo, type ListenerSide } from '../../../axf/libs/listeners';
import type { ListenersStatus } from '../../../native';

export const DEVICE_KEY = 'amberx.listeners.device';

/** The mic lease's holder names (miclease.ts HOLDER_LABEL keys) as listener ids. */
export const LEASE_TO_LISTENER: Record<string, string> = { dictation: 'dictation', 'voice-command': 'voice-command', 'agent-voice': 'agent-voice', notes: 'notes', companion: 'talk' };

/** A stable id for this installed app (made once, kept on the device). */
export function deviceIdOf(store: { getItem(k: string): string | null; setItem(k: string, v: string): void }, native: boolean, random = () => Math.random().toString(36).slice(2, 10)): string {
  const have = store.getItem(DEVICE_KEY);
  if (have && /^[a-z]+-[a-z0-9]{4,}$/.test(have)) return have;
  const id = `${native ? 'phone' : 'browser'}-${random()}`;
  try { store.setItem(DEVICE_KEY, id); } catch { /* storage off: a new id each load */ }
  return id;
}

/** "AmberX on Android", "Chrome on Windows", … from the user agent. */
export function deviceNameOf(userAgent: string, native: boolean): string {
  if (native) return 'AmberX on Android';
  const ua = userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export interface PageScene {
  /** who holds the page's mic lease (mic-lease@1 holder), or null */
  leaseHolder: string | null;
  /** this page is the device's sound owner (listeners.ts) */
  soundOwner: boolean;
  quiet: boolean;
}

/**
 * The page's own rows: whoever holds the mic lease (dictation, Speak a command, voice notes, the Assistant microphone)
 * is `on` and holds the mic; in a browser the voice plugin's page listeners show as off when idle. Pure.
 */
export function pageRows(scene: PageScene, native: boolean): (Partial<ListenerInfo> & { id: string })[] {
  const rows: (Partial<ListenerInfo> & { id: string })[] = [];
  const holding = scene.leaseHolder ? LEASE_TO_LISTENER[scene.leaseHolder] ?? scene.leaseHolder : null;
  for (const id of ['dictation', 'voice-command', 'agent-voice', 'notes']) {
    const on = holding === id;
    rows.push({ id, side: 'page', state: on ? 'on' : 'off', detail: on ? 'Using the microphone' : '', holdsMic: on });
  }
  if (!native) rows.push({ id: 'veto-alarm', side: 'page', state: scene.quiet ? 'paused' : scene.soundOwner ? 'on' : 'off', detail: scene.quiet ? 'Quiet is on' : scene.soundOwner ? '' : 'another AmberX tab rings' });
  return rows;
}

/**
 * Everything on one device: the native rows (the phone's services) + the page's, each row filled from the registry and
 * the policies (`get` = settings getter), as the listener-state@1 document the hub and the panel show. Pure.
 */
export function combine(native: ListenersStatus | null, page: (Partial<ListenerInfo> & { id: string })[], d: { device: string; name: string; side: ListenerSide; now: number }, get: (key: string) => unknown): DeviceListeners {
  const rows = new Map<string, Partial<ListenerInfo> & { id: string }>();
  for (const r of native?.listeners ?? []) { const x = r as Partial<ListenerInfo> & { id?: unknown }; if (typeof x.id === 'string') rows.set(x.id, { ...x, id: x.id, side: 'native' }); }
  for (const r of page) { const have = rows.get(r.id); if (!have || (r.state === 'on' && have.state !== 'on')) rows.set(r.id, { ...(have ?? {}), ...r }); }
  // Every known listener shows, even one nobody reported yet (off), so the panel always has the same rows.
  for (const l of LISTENERS) if (!rows.has(l.id) && (d.side === 'native' ? l.side === 'native' || l.side === 'page' : l.side === 'page' || l.id === 'talk')) rows.set(l.id, { id: l.id, side: l.side, state: 'off' });
  const list = [...rows.values()].map((r) => normalizeInfo(r, get));
  const micHolder = native?.micHolder ?? page.find((p) => p.holdsMic)?.id ?? null;
  return deviceDoc({ device: d.device, name: d.name, app: 'amberx-droid', at: d.now, side: d.side, micOff: native?.micOff === true, micHolder, listeners: list }, get);
}

/** The synced key the Dev Console writes to ask this device to restart a listener (an ISO time; a new value = one restart). */
export const restartKey = (id: string) => `amberx.listeners.${id}.restart`;

type Declared = { key: string; label: string; kind: 'toggle' | 'choice' | 'text'; default: boolean | string; options?: { value: string; label: string }[]; description?: string };
/** The settings this plugin declares: one group per listener with its policy fields (+ the console's restart request). */
export function settingsGroups(): { id: string; label: string; icon: string; tab: string; order: number; description: string; settings: Declared[] }[] {
  return LISTENERS.map((l, i) => ({
    id: `amberx.listeners.${l.id}`, label: l.label, icon: l.kind === 'mic' ? 'mic' : l.kind === 'poll' ? 'eye' : 'bell', tab: 'listeners', order: 10 + i, description: l.about,
    settings: [
      ...(policySettings(l.id) as Declared[]),
      ...(l.side === 'native' && !(l.without ?? []).includes('on') ? [{ key: restartKey(l.id), label: `${l.label}: last restart asked from the Dev Console`, kind: 'text' as const, default: '', description: 'Set by the console\'s AmberX listeners page (Restart); the phone restarts the listener when it changes.' }] : []),
    ],
  }));
}

/** Listener ids whose console restart request changed to a new, non-empty value. Pure. */
export function restartRequests(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(after)) {
    const m = /^amberx\.listeners\.([a-z0-9-]+)\.restart$/.exec(k);
    if (m && typeof v === 'string' && v && before[k] !== v) out.push(m[1]!);
  }
  return out;
}

/** The settings keys whose change means a policy must be pushed to the native side: { id → [keys] }. */
export function changedPolicies(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k]) || k.endsWith('.restart')) continue;
    const m = /^amberx\.listeners\.([a-z0-9-]+)\./.exec(k);
    if (m) ids.add(m[1]!);
  }
  return [...ids];
}

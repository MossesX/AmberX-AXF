/** Phone Connect's REST client and shapes (server/routes.py). Every screen reads and acts through these routes only. */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'phone-connect';
export const api = pluginApi(FOLDER, 'Phone Connect');
/** The waiting code's QR as an object URL (the route needs the console token), or '' when the QR engine is missing. */
export async function qrObjectUrl(): Promise<string> {
  try { return URL.createObjectURL(await api.blob('pair/qr.svg', undefined, /svg/)); } catch { return ''; }
}

export interface Device {
  deviceId: string; name: string; app: string; appVersion: string; capabilities: string[]; state: 'unpaired' | 'pending' | 'paired' | 'revoked';
  owner: string; pairedAt: string; lastSeenAt: string; revokedAt: string; online: boolean; presence: string; capabilityState: Record<string, Record<string, unknown>>;
}
export interface Pairing { code: string; expiresAt: string; by: string; qr?: string }
export interface Status { device: Device | null; online: boolean; presence: string; pairing: Pairing | null; devices: number }
export type NotifyKind = 'fyi' | 'fix-update' | 'alert' | 'approval';
export interface Settings { browser: 'chrome' | 'default'; notify: Record<NotifyKind, boolean>; monitor: boolean; recorderMic: boolean }
export interface Rule { id: string; what: string; scope: string; expiresAt: string; state: 'on' | 'proposed'; note: string; createdBy: string; createdAt: string; active: boolean }
export interface RecorderStatus {
  device: string; online: boolean; presence: string; running: boolean; since: string; session: string; group: string; part: number;
  parts: { name?: string; at?: string; uploaded?: boolean }[]; queue: number; mic: boolean; partMinutes: number;
  transcripts: { on: boolean; engine: boolean; waiting: number; failed: { id: string; name?: string; error?: string }[] };
}

export const NOTIFY_KINDS: { id: NotifyKind; label: string; hint: string }[] = [
  { id: 'fyi', label: 'FYI', hint: 'Worth knowing, nothing to do. Quiet.' },
  { id: 'fix-update', label: 'Fix updates', hint: 'A fix landed or a build moved on.' },
  { id: 'alert', label: 'Alerts', hint: 'Something broke or needs a look. With sound.' },
  { id: 'approval', label: 'Approvals', hint: 'A held call waits for you. Pops up with Approve and Deny.' },
];

/** The error text a failed call carries (the server answers {error: {message}}). */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

/** Automated Browser: calls to the plugin's server part and the live view socket. */
import * as consoleApi from '@console/api';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'auto-browser';

export type Device = 'desktop' | 'tablet' | 'phone';
export interface Tab { id: string; url: string; title: string; active: boolean }
export interface BrowserState { session: string; device: Device; active: string; tabs: Tab[]; url: string }
export interface Config { hostUrl: string; hostUrlFromEnv: boolean; workspace: string; device: Device; quality: number; homeUrl: string; tokenSet: boolean }
export interface Status { reachable: boolean; error?: string; health?: { sessions: number; max: number; rssMb: number; startedAt: string }; config: Config }
export interface Download { name: string; size: number; at: string }

const api = pluginApi(FOLDER, 'The Automated Browser');
export const get = <T,>(path: string) => api.call<T>(path);
export const post = <T,>(path: string, body: unknown = {}) => api.call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => api.call<T>(path, { method: 'PUT', body: JSON.stringify(body) });

/** The live view socket URL with a one-time ticket (the console token never goes in a URL). */
export async function liveUrl(workspace: string, device: Device): Promise<string> {
  const path = `/api/plugins/${FOLDER}/live`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = consoleApi.getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const r = await fetch('/api/ws-ticket', { method: 'POST', headers, body: JSON.stringify({ path }), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as { ticket?: string; detail?: string };
  if (!r.ok || !j.ticket) throw new Error(j.detail ?? `no ticket (${r.status})`);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = new URLSearchParams({ ticket: j.ticket, workspace, device });
  return `${proto}//${location.host}${path}?${q}`;
}

/** Keyboard event → the key name the VPS browser understands ("Control+a", "Enter", "ArrowLeft"). */
export function keyName(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  const mods = [e.ctrlKey && 'Control', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && e.key.length > 1 && 'Shift'].filter(Boolean);
  const key = e.key === ' ' ? 'Space' : e.key;
  return [...mods, key].join('+');
}

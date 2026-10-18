/* Terminal — web API layer, the xterm loader (vendored UMD builds, loaded once) and the per-tab session registry. */
import { pluginFetch } from '@console/plugins';
import * as consoleApi from '@console/api';
import xtermUrl from './vendor/xterm.js?url';
import fitUrl from './vendor/xterm-addon-fit.js?url';
import searchUrl from './vendor/xterm-addon-search.js?url';
import linksUrl from './vendor/xterm-addon-web-links.js?url';
import './vendor/xterm.css';

export const FOLDER = 'console-terminal';
export const ID = 'ai.amberx.axf.console.terminal';

export type Kind = 'console' | 'container' | 'vps' | 'claude';
export interface Open { kind: Kind; container?: string; cwd?: string; confirmProtected?: boolean; title?: string }
export interface SessionInfo { id: string; kind: Kind; title: string; target: string; cwd: string; mosh: boolean; badge: string | null; protected: boolean; createdAt: number; attached: number; closed: boolean }
export interface Settings {
  idleMinutes: number; moshKeepMinutes: number; fontSize: number; copyOnSelect: boolean; pasteWarn: boolean; mouseDefault: boolean; moshDefault: boolean; user: string;
  vps: { host: string; port: number; user: string }; sshKey: boolean; claudeToken: boolean; publicKey?: string;
}
export interface Status { containers: boolean; claude: boolean; ssh: boolean; vps: { ready: boolean; host: string }; settings: Settings; sessions: SessionInfo[] }
export interface Target { name: string; image: string; state: string; protected: string | null; reachable: boolean }

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (r.status === 404 && !j.detail) throw new Error('The terminal plugin is disabled or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });

/** A WebSocket URL for a session, with a one-time ticket (the console token never goes in a URL). */
export async function socketUrl(sid: string, have: number): Promise<string> {
  const path = `/api/plugins/${FOLDER}/sessions/${sid}/ws`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = consoleApi.getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const r = await fetch('/api/ws-ticket', { method: 'POST', headers, body: JSON.stringify({ path }), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as { ticket?: string; detail?: string };
  if (!r.ok || !j.ticket) throw new Error(j.detail ?? `no ticket (${r.status})`);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}?ticket=${encodeURIComponent(j.ticket)}&have=${have}`;
}

/* ---------------- xterm (vendored, MIT) ---------------- */
export interface XTerm {
  open(el: HTMLElement): void; write(d: string | Uint8Array): void; reset(): void; clear(): void; focus(): void; dispose(): void; paste(t: string): void;
  loadAddon(a: unknown): void; onData(f: (d: string) => void): { dispose(): void }; onBinary(f: (d: string) => void): { dispose(): void };
  onSelectionChange(f: () => void): { dispose(): void }; onResize(f: (s: { cols: number; rows: number }) => void): { dispose(): void };
  attachCustomKeyEventHandler(f: (e: KeyboardEvent) => boolean): void; getSelection(): string; hasSelection(): boolean; selectAll(): void; clearSelection(): void;
  cols: number; rows: number; options: Record<string, unknown>; buffer: { active: { cursorX: number; cursorY: number; baseY: number; viewportY: number } };
  modes: { mouseTrackingMode: string; bracketedPasteMode: boolean };
}
interface Lib { Terminal: new (o: Record<string, unknown>) => XTerm; FitAddon: new () => { fit(): void; proposeDimensions(): { cols: number; rows: number } | undefined }; SearchAddon: new () => { findNext(t: string, o?: unknown): boolean; findPrevious(t: string, o?: unknown): boolean; clearDecorations(): void }; WebLinksAddon: new (h?: (e: MouseEvent, uri: string) => void) => unknown }
let lib: Promise<Lib> | null = null;
function script(src: string): Promise<void> {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = () => res(); s.onerror = () => rej(new Error(`couldn't load ${src}`)); document.head.appendChild(s); });
}
export function loadXterm(): Promise<Lib> {
  if (!lib) {
    lib = (async () => {
      const w = globalThis as unknown as Record<string, Record<string, unknown> & { [k: string]: unknown }>;
      if (!w.Terminal) await script(xtermUrl);
      await Promise.all([w.FitAddon ? null : script(fitUrl), w.SearchAddon ? null : script(searchUrl), w.WebLinksAddon ? null : script(linksUrl)]);
      const pick = (g: string) => ((w[g] as Record<string, unknown>)?.[g] ?? w[g]) as never;
      return { Terminal: (w.Terminal as unknown as { Terminal?: never }).Terminal ?? (w.Terminal as never), FitAddon: pick('FitAddon'), SearchAddon: pick('SearchAddon'), WebLinksAddon: pick('WebLinksAddon') };
    })();
    lib.catch(() => { lib = null; });
  }
  return lib;
}

/** Theme from the engine-compiled tokens (no colours of our own). */
export function themeFromTokens(el: HTMLElement): Record<string, string> {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { background: v('--fx-surface'), foreground: v('--fx-text'), cursor: v('--fx-accent'), cursorAccent: v('--fx-surface'), selectionBackground: v('--fx-accent-soft') };
}

/* ---------------- tab ↔ session registry (survives a tab moving between windows) ---------------- */
export const tabSessions = new Map<string, string>();
export const tabPrefs = new Map<string, { mouse: boolean; mosh: boolean }>();
let settingsCache: Settings | null = null;
export async function getSettings(force = false): Promise<Settings> {
  if (!settingsCache || force) settingsCache = await call<Settings>('settings');
  return settingsCache;
}
export const parseOpen = (payload?: string): Open => { try { return JSON.parse(payload || '{}') as Open; } catch { return { kind: 'console' }; } };

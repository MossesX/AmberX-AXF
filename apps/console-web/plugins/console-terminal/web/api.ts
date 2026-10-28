/* Terminal — web API layer, the xterm loader (vendored UMD builds, loaded once) and the per-tab session registry. */
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import xtermUrl from './vendor/xterm.js?url';
import fitUrl from './vendor/xterm-addon-fit.js?url';
import searchUrl from './vendor/xterm-addon-search.js?url';
import linksUrl from './vendor/xterm-addon-web-links.js?url';
import './vendor/xterm.css';

export const FOLDER = 'console-terminal';
export const ID = 'ai.amberx.axf.console.terminal';

export type Kind = 'console' | 'container' | 'vps' | 'claude';
export type Via = 'console' | 'vps' | 'container' | 'axhub';
/** What a tab opens. Claude Code tabs carry `via` (+ `container`) for their connection and their profile's options. */
export interface Open {
  kind: Kind; container?: string; cwd?: string; confirmProtected?: boolean; title?: string; attach?: string;
  via?: Via; profile?: string; model?: string; permissionMode?: string; flags?: string[]; prompt?: string;
}
/** A place a tab can connect to (GET connections). */
export interface Connection { id: string; via: Via; container?: string; label: string; detail: string; icon: string; badge?: string | null; ready: boolean; claude: boolean; shell?: boolean; why: string; group?: string }
export interface SessionInfo { id: string; kind: Kind; title: string; target: string; cwd: string; mosh: boolean; badge: string | null; protected: boolean; createdAt: number; attached: number; closed: boolean }
export interface Settings {
  idleMinutes: number; moshKeepMinutes: number; fontSize: number; copyOnSelect: boolean; pasteWarn: boolean; mouseDefault: boolean; moshDefault: boolean; showHubRuns: boolean; showHeadless: boolean; user: string;
  vps: { host: string; port: number; user: string }; sshKey: boolean; claudeToken: boolean; publicKey?: string;
  // Windows-style terminal (Oct 28 2026)
  windowsLook: boolean; mica: boolean; toolbar: boolean; scheme: string; fontFamily: string; lineHeight: number; cursorStyle: 'bar' | 'block' | 'underline';
  cursorBlink: boolean; scrollback: number; padding: number; bell: 'none' | 'visual' | 'sound'; closeConfirm: boolean;
  startup: 'claude' | 'console' | 'picker' | 'none'; newTab: 'picker' | 'same'; tabWidth: 'equal' | 'compact' | 'title';
  claudeProfiles: ClaudeProfile[]; defaultClaudeProfile: string;
}
/** A Claude Code profile: how a Claude Code tab starts (Oct 28 2026). */
export interface ClaudeProfile { id: string; name: string; model: string; permissionMode: string; flags: string[]; cwd: string; prompt: string; icon: string; color: string; connection: string }
export interface Status { containers: boolean; claude: boolean; ssh: boolean; vps: { ready: boolean; host: string }; settings: Settings; sessions: SessionInfo[] }
export interface Target { name: string; image: string; state: string; protected: string | null; reachable: boolean }

const api = pluginApi(FOLDER, 'The terminal plugin');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
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

import schemesData from './schemes.json';
export const SCHEMES = (schemesData as { schemes: Record<string, Record<string, string>> }).schemes;
/** The terminal colours: a Windows Terminal scheme (schemes.json), or 'app' = the app's theme tokens. */
export function schemeColors(scheme: string | undefined, el: HTMLElement): Record<string, string> {
  const s = scheme && scheme !== 'app' ? SCHEMES[scheme] : null;
  if (!s) return themeFromTokens(el);
  const { name: _n, ...colors } = s; return colors;
}
/** xterm options from the terminal settings (look + behaviour). */
export function lookOptions(s: Settings | null, el: HTMLElement): Record<string, unknown> {
  const mono = getComputedStyle(el).getPropertyValue('--fx-font-mono').trim() || 'monospace';
  const family = (s?.fontFamily || "'Cascadia Mono', 'Cascadia Code', Consolas, 'Lucida Console'") + `, ${mono}`;
  return { theme: schemeColors(s?.scheme, el), fontFamily: family, lineHeight: s?.lineHeight ?? 1.15, cursorStyle: s?.cursorStyle ?? 'bar',
    cursorBlink: s?.cursorBlink ?? true, scrollback: s?.scrollback ?? 10000 };
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
const settingsListeners = new Set<(s: Settings) => void>();
export async function getSettings(force = false): Promise<Settings> {
  if (!settingsCache || force) { const s = await call<Settings>('settings'); settingsCache = s; settingsListeners.forEach((f) => f(s)); return s; }
  return settingsCache;
}
/** Every open terminal follows a settings save (each session re-reads its look). */
export const onSettings = (f: (s: Settings) => void) => { settingsListeners.add(f); return () => { settingsListeners.delete(f); }; };
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> { await put('settings', patch); return getSettings(true); }
export const parseOpen = (payload?: string): Open => { try { return JSON.parse(payload || '{}') as Open; } catch { return { kind: 'console' }; } };

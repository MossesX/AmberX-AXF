/**
 * The native side of AmberX, one seam for every plugin.
 *
 * Inside the Android shell (`android/`, Capacitor) these calls go to the `AmberxNative` plugin
 * (`android/app/src/main/java/ai/amberx/droid/AmberxNativePlugin.kt`): native speech recognition and text to speech, a
 * foreground service that watches axHub with the screen off (approval alerts, auto-approval, the wake phrase), and a
 * hub web view locked to the hub's address for signing in and deciding approvals. In a plain browser the same calls fall
 * back to the Web Speech API, `speechSynthesis`, an in-page timer and `window.open`, so the app runs anywhere.
 *
 * Plugins never import Capacitor themselves: they call `native`.
 */
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface MonitorConfig {
  hub: string;
  /** seconds between checks, 15–300 */
  intervalSec: number;
  /** auto-approval (off by default); same rules as the AXHub app: see plugins/monitor/web/core.ts */
  autoApprove: { on: boolean; all: boolean; tools: string };
  /** wake phrases heard by the service while the app isn't on screen; empty = no background listening */
  wakePhrases: string[];
  /** BCP-47 language for recognition, e.g. en-US */
  lang: string;
}

export interface MonitorStatus {
  running: boolean;
  listening: boolean;
  lastCheck: string | null;
  status: string;
  waiting: number;
}

export interface NativeApi {
  /** GET a hub page or feed with the hub session. No redirects, capped. */
  hubGet(opts: { url: string }): Promise<{ status: number; body: string; etag?: string }>;
  /** Open a hub page (sign-in, an approval) in a web view locked to the hub. Resolves when it closes. */
  hubOpen(opts: { url: string }): Promise<{ closed: boolean }>;
  hubSignOut(opts: { hub: string }): Promise<void>;
  /** One utterance; resolves with what was heard ('' when nothing). */
  listen(opts: { lang: string; prompt?: string }): Promise<{ text: string }>;
  speak(opts: { text: string; lang: string }): Promise<void>;
  monitorStart(opts: MonitorConfig): Promise<MonitorStatus>;
  monitorStop(): Promise<MonitorStatus>;
  monitorStatus(): Promise<MonitorStatus>;
  /** Ask for the microphone + notifications (Android 13+) permissions. */
  permissions(): Promise<{ microphone: boolean; notifications: boolean }>;
  addListener(event: 'wake', fn: (e: { phrase: string; text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'monitor', fn: (e: MonitorStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: 'open', fn: (e: { url: string }) => void): Promise<PluginListenerHandle>;
}

export const isNative = (): boolean => Capacitor.isNativePlatform();

/* ---------------------------------------------------------------- browser fallback */

type Listener = (e: never) => void;
const listeners = new Map<string, Set<Listener>>();
const emit = (event: string, e: unknown) => listeners.get(event)?.forEach((fn) => (fn as (x: unknown) => void)(e));

type Rec = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const Recognition = (globalThis as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

let webMonitor: { timer: ReturnType<typeof setInterval> | null; status: MonitorStatus } = {
  timer: null,
  status: { running: false, listening: false, lastCheck: null, status: 'off', waiting: 0 },
};

const web: NativeApi = {
  async hubGet({ url }) {
    const r = await fetch(url, { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
    return { status: r.status, body: await r.text(), etag: r.headers.get('ETag') ?? undefined };
  },
  async hubOpen({ url }) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { closed: true };
  },
  async hubSignOut({ hub }) { window.open(`${hub}/auth/logout`, '_blank', 'noopener,noreferrer'); },
  listen({ lang }) {
    return new Promise((resolve, reject) => {
      if (!Recognition) { reject(new Error('This browser has no speech recognition.')); return; }
      const rec = new Recognition();
      rec.lang = lang; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
      let text = '';
      rec.onresult = (e) => { text = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim(); };
      rec.onerror = (e) => (e.error === 'no-speech' ? resolve({ text: '' }) : reject(new Error(e.error)));
      rec.onend = () => resolve({ text });
      rec.start();
    });
  },
  async speak({ text, lang }) {
    const synth = globalThis.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    await new Promise<void>((done) => { u.onend = () => done(); u.onerror = () => done(); synth.speak(u); });
  },
  async monitorStart() {
    // In a browser the page itself is the monitor (plugins/monitor/web polls while it's open); this only records it.
    webMonitor = { ...webMonitor, status: { ...webMonitor.status, running: true, status: 'in this tab' } };
    emit('monitor', webMonitor.status);
    return webMonitor.status;
  },
  async monitorStop() {
    if (webMonitor.timer) clearInterval(webMonitor.timer);
    webMonitor = { timer: null, status: { ...webMonitor.status, running: false, listening: false, status: 'off' } };
    emit('monitor', webMonitor.status);
    return webMonitor.status;
  },
  async monitorStatus() { return webMonitor.status; },
  async permissions() {
    let microphone = false;
    try { (await navigator.mediaDevices?.getUserMedia({ audio: true }))?.getTracks().forEach((t) => t.stop()); microphone = true; } catch { /* refused */ }
    let notifications = false;
    try { notifications = (await Notification.requestPermission()) === 'granted'; } catch { /* no API */ }
    return { microphone, notifications };
  },
  async addListener(event: string, fn: Listener) {
    const set = listeners.get(event) ?? new Set();
    set.add(fn);
    listeners.set(event, set);
    return { remove: async () => { set.delete(fn); } };
  },
} as NativeApi;

/** Used by the browser monitor to report what it saw, so the Monitor view reads one status either way. */
export function reportWebMonitor(patch: Partial<MonitorStatus>): void {
  webMonitor = { ...webMonitor, status: { ...webMonitor.status, ...patch } };
  emit('monitor', webMonitor.status);
}

export const native: NativeApi = isNative() ? registerPlugin<NativeApi>('AmberxNative') : web;

/**
 * Inside the shell the page runs at https://localhost, so a browser fetch to the hub would be cross-site (no session
 * cookie, CORS). lib-hub's feeds call `fetch` themselves; this routes GETs to the hub's origin through the native
 * `hubGet` (the hub session in Android's cookie store, redirects refused, replies capped) and leaves every other request
 * alone. Writes (PUT) to the hub aren't routed yet: in the shell, appearance changes stay on the phone (known gap).
 * Installed once from main.tsx; does nothing in a browser.
 */
export function routeHubFetch(hub: string): void {
  if (!isNative()) return;
  const origin = new URL(hub).origin;
  const plain = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let target: URL | null = null;
    try { target = new URL(url, location.href); } catch { /* not a URL */ }
    if (!target || target.origin !== origin || method !== 'GET') return plain(input, init);
    const { status, body, etag } = await native.hubGet({ url: target.href });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) headers.ETag = etag;
    return new Response(status === 204 || status === 304 ? null : body, { status: status || 502, headers });
  };
  // Hub pages (Review, sign in, the hub's own pages) open in the native hub view, where the session lives, not in an
  // outside browser that has none.
  const open = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    let u: URL | null = null;
    try { u = url ? new URL(String(url), location.href) : null; } catch { /* not a URL */ }
    if (u && u.origin === origin) { void native.hubOpen({ url: u.href }); return null; }
    return open(url, target, features);
  };
}

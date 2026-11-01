/**
 * The native side of AmberX, one seam for every plugin.
 *
 * Inside the Android shell (`android/`, Capacitor) these calls go to the `AmberxNative` plugin
 * (`android/app/src/main/java/ai/amberx/droid/AmberxNativePlugin.java`): native speech recognition and text to speech, a
 * foreground service that watches axHub with the screen off (approval alerts, auto-approval, the wake phrase), and a
 * hub web view locked to the hub's address for signing in and deciding approvals. In a plain browser the same calls fall
 * back to the Web Speech API, `speechSynthesis`, an in-page timer and `window.open`, so the app runs anywhere.
 *
 * Plugins never import Capacitor themselves: they call `native`.
 */
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { unmask } from './plugins/voice/web/speech';
import { sharesHubSite } from './hosted';
import { dbfs, type VoiceConfig } from './plugins/voice/web/handsfree';
import { setVetoHost, type VetoState } from './axf/libs/hub/veto';

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
  /** Dev Console alerts (errors + warnings) as notifications too (Brett, Oct 28 2026: every push comes from AmberX) */
  consoleAlerts: boolean;
}

export interface MonitorStatus {
  running: boolean;
  listening: boolean;
  lastCheck: string | null;
  status: string;
  waiting: number;
  /** open console alerts (errors + warnings); -1 = the console can't be read (not signed in there); absent = off */
  alerts?: number;
}

export interface VoiceStatus {
  listening: boolean;
  microphone: boolean;
  /** Android: "Display over other apps" allowed (the detection overlay); always false in a browser */
  overlayAllowed: boolean;
  /** Android: which hands-free engine runs: `wake` (silent offline wake listener) or `classic` */
  engine?: 'wake' | 'classic';
  /** Android wake engine: wake | armed | listening | loading | downloading | no-model | paused | stopped */
  phase?: string;
  /** download percentage ("42%") or why there's no model */
  phaseDetail?: string;
}

/** An owner action on a held veto call (axHub decision 102 Deny, 104 Approve now + Shelve). */
export type VetoActionName = 'deny' | 'approve-now' | 'shelve';

export interface NativeApi {
  /** GET a hub page or feed with the hub session. No redirects, capped. */
  hubGet(opts: { url: string }): Promise<{ status: number; body: string; etag?: string }>;
  /** PUT a JSON document to the hub's data server (`<hub>/data/…`) with the hub session. If-Match kept, no redirects. */
  hubPut(opts: { url: string; body: string; ifMatch?: string }): Promise<{ status: number; body: string; etag?: string }>;
  /** Open a hub page (sign-in, an approval) in a web view locked to the hub. Resolves when it closes. */
  hubOpen(opts: { url: string }): Promise<{ closed: boolean }>;
  hubSignOut(opts: { hub: string }): Promise<void>;
  /** One utterance; resolves with what was heard ('' when nothing). */
  listen(opts: { lang: string; prompt?: string }): Promise<{ text: string }>;
  /** Say something. Agent voice (Oct 29 2026) adds the voice, rate, pitch, volume, an utterance id (a `spoken` event
   * follows when it ends), `queue` and `holdMic` (hands-free steps aside while it talks). Older callers: text + lang. */
  speak(opts: { text: string; lang: string; voice?: string; rate?: number; pitch?: number; volume?: number; id?: string; queue?: boolean; holdMic?: boolean }): Promise<void>;
  stopSpeaking(): Promise<void>;
  /** Screen capture (Oct 31 2026, `securescreen.ts`): hidden from recordings only when `hide` (the opt-in setting) and
   * `sensitive` (a password / key / vault screen is showing). Browser: nothing to do. */
  secureScreen(opts: { hide: boolean; sensitive: boolean }): Promise<{ secure: boolean }>;
  /** The phone's text-to-speech voices (Android); the browser's voices in the fallback. */
  ttsVoices(): Promise<{ voices: { id: string; name: string; lang: string; quality?: number; network?: boolean }[] }>;
  /** Microphone permission without asking: granted / denied / prompt. */
  micPermission(): Promise<{ state: 'granted' | 'denied' | 'prompt' }>;
  monitorStart(opts: MonitorConfig): Promise<MonitorStatus>;
  monitorStop(): Promise<MonitorStatus>;
  monitorStatus(): Promise<MonitorStatus>;
  /** Hands-free listening + the detection overlay (plugins/voice/web/handsfree.ts). Asks for the microphone if needed. */
  voiceSet(opts: VoiceConfig): Promise<VoiceStatus>;
  voiceStatus(): Promise<VoiceStatus>;
  /** Android: opens "Display over other apps" for AmberX; resolves with whether it's allowed when the user returns. */
  overlayPermission(): Promise<{ allowed: boolean }>;
  /** Ask for the microphone + notifications (Android 13+) permissions. */
  permissions(): Promise<{ microphone: boolean; notifications: boolean }>;
  /**
   * Veto calls (the veto banner plugin, console `plugins/approvals-banner`, through lib-hub's `setVetoHost`): Deny,
   * Approve now or Shelve with the phone's hub session (POST /auth/api/approvals/<id>/<action>, hub Origin + CSRF; Java
   * `VetoAlerts`). Browser: ok false (the plugin opens the call on the hub).
   */
  vetoAction(opts: { id: string; action: VetoActionName }): Promise<{ ok: boolean; state?: string; error?: string }>;
  /** The banner plugin's alarm settings (Java `VetoAlarm`: alarm audio stream, rings through silent mode). */
  vetoAlarm(opts: Record<string, unknown>): Promise<void>;
  /** Ring the alarm once now with these settings (Settings → Test). */
  vetoAlarmTest(opts: Record<string, unknown>): Promise<void>;
  vetoAlarmStop(): Promise<void>;
  /** A veto notification was tapped (`open`: the veto screen) or one of its Deny / Approve / Shelve buttons ran. */
  addListener(event: 'veto', fn: (e: { id: string; action: 'open' | 'denied' | 'approved' | 'shelved' | 'failed'; error?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'wake', fn: (e: { phrase: string; text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'monitor', fn: (e: MonitorStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: 'open', fn: (e: { url: string }) => void): Promise<PluginListenerHandle>;
  /** what hands-free is hearing (only while AmberX is on screen) */
  addListener(event: 'spoken', fn: (e: { id: string; done: boolean; error?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'heard', fn: (e: { text: string; final: boolean; source?: 'listen' }) => void): Promise<PluginListenerHandle>;
  /** input level in dB (Android: recognizer RMS dB; browser: dBFS), about ten a second while on screen */
  addListener(event: 'level', fn: (e: { db: number; source?: 'android' | 'web' }) => void): Promise<PluginListenerHandle>;
  /** a quick setting changed on the overlay */
  addListener(event: 'voiceSettings', fn: (e: Partial<VoiceConfig>) => void): Promise<PluginListenerHandle>;
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

/**
 * Browser hands-free: while the page is open and visible, continuous Web Speech recognition (restarted when it stops)
 * reports what it hears; every final result goes out as `wake` (the voice plugin decides whether it held a wake phrase or
 * is armed). An analyser on the microphone reports the level in dBFS. No overlay in a browser.
 */
const webVoice: { cfg: VoiceConfig | null; rec: Rec | null; stream: MediaStream | null; ctx: AudioContext | null; timer: ReturnType<typeof setInterval> | null; listening: boolean } =
  { cfg: null, rec: null, stream: null, ctx: null, timer: null, listening: false };

function webVoiceStop() {
  const v = webVoice;
  try { v.rec?.abort(); } catch { /* already stopped */ }
  v.rec = null;
  if (v.timer) clearInterval(v.timer);
  v.timer = null;
  v.stream?.getTracks().forEach((t) => t.stop());
  v.stream = null;
  void v.ctx?.close().catch(() => undefined);
  v.ctx = null;
  v.listening = false;
}

async function webVoiceStart(cfg: VoiceConfig) {
  webVoiceStop();
  webVoice.cfg = cfg;
  if (!cfg.handsFree || !Recognition) return;
  const rec = new Recognition();
  rec.lang = cfg.lang; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    const raw = (last?.[0]?.transcript ?? '').trim();
    const text = cfg.swears === false ? raw : unmask(raw);
    if (!last || !text) return;
    emit('heard', { text, final: last.isFinal });
    if (last.isFinal) emit('wake', { phrase: '', text });
  };
  rec.onerror = () => undefined;
  rec.onend = () => { if (webVoice.rec === rec && document.visibilityState === 'visible') { try { rec.start(); } catch { /* starting */ } } };
  webVoice.rec = rec;
  try { rec.start(); webVoice.listening = true; } catch { webVoice.listening = false; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (webVoice.rec !== rec) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    webVoice.stream = stream; webVoice.ctx = ctx;
    webVoice.timer = setInterval(() => { an.getFloatTimeDomainData(buf); emit('level', { db: dbfs(buf), source: 'web' }); }, 100);
  } catch { /* no microphone level, recognition may still work */ }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!webVoice.cfg) return;
    if (document.visibilityState === 'visible') void webVoiceStart(webVoice.cfg); else webVoiceStop();
  });
}

let webMonitor: { timer: ReturnType<typeof setInterval> | null; status: MonitorStatus } = {
  timer: null,
  status: { running: false, listening: false, lastCheck: null, status: 'off', waiting: 0 },
};

const web: NativeApi = {
  async hubGet({ url }) {
    const r = await fetch(url, { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
    return { status: r.status, body: await r.text(), etag: r.headers.get('ETag') ?? undefined };
  },
  async hubPut({ url, body, ifMatch }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const r = await fetch(url, { method: 'PUT', credentials: 'include', redirect: 'error', cache: 'no-store', headers, body });
    return { status: r.status, body: await r.text(), etag: r.headers.get('ETag') ?? undefined };
  },
  async hubOpen({ url }) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { closed: true };
  },
  async hubSignOut({ hub }) { window.open(`${hub}/auth/logout`, '_blank', 'noopener,noreferrer'); },
  listen({ lang }) {
    // Hands-free lets go of the recognizer while the Speak button listens, and comes back afterwards.
    const resume = webVoice.cfg;
    if (webVoice.rec) webVoiceStop();
    const back = <T,>(v: T) => { if (resume) void webVoiceStart(resume); return v; };
    return new Promise<{ text: string }>((resolve, reject) => {
      if (!Recognition) { reject(new Error('This browser has no speech recognition.')); return; }
      const rec = new Recognition();
      rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      let text = '';
      rec.onresult = (e) => {
        const all = Array.from(e.results);
        text = unmask(all.map((r) => r[0]?.transcript ?? '').join(' ').trim());
        // Live text while you talk (the Android side sends the same 'heard' partials from its recognizer).
        if (!all[all.length - 1]?.isFinal && text) emit('heard', { text, final: false, source: 'listen' });
      };
      rec.onerror = (e) => (e.error === 'no-speech' ? resolve({ text: '' }) : reject(new Error(e.error)));
      rec.onend = () => resolve({ text });
      rec.start();
    }).then(back, (e) => { back(null); throw e; });
  },
  async speak({ text, lang, voice, rate, pitch, volume, id, queue }) {
    const synth = globalThis.speechSynthesis;
    if (!synth || !text) return;
    if (!queue) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (voice) { const v = synth.getVoices().find((x) => x.voiceURI === voice || x.name === voice); if (v) u.voice = v; }
    if (rate) u.rate = rate;
    if (pitch) u.pitch = pitch;
    if (volume !== undefined) u.volume = volume;
    await new Promise<void>((done) => { u.onend = () => done(); u.onerror = () => done(); synth.speak(u); });
    if (id) emit('spoken', { id, done: true });
  },
  async stopSpeaking() { globalThis.speechSynthesis?.cancel(); },
  async secureScreen() { return { secure: false }; },
  async ttsVoices() {
    const synth = globalThis.speechSynthesis;
    return { voices: (synth?.getVoices() ?? []).map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, network: !v.localService })) };
  },
  async micPermission() {
    try {
      const p = await (navigator as Navigator & { permissions?: { query(o: { name: string }): Promise<{ state: string }> } }).permissions?.query({ name: 'microphone' });
      return { state: (p?.state === 'granted' || p?.state === 'denied' ? p.state : 'prompt') as 'granted' | 'denied' | 'prompt' };
    } catch { return { state: 'prompt' as const }; }
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
  async voiceSet(cfg) {
    await webVoiceStart(cfg);
    return { listening: webVoice.listening, microphone: webVoice.stream !== null, overlayAllowed: false };
  },
  async voiceStatus() { return { listening: webVoice.listening, microphone: webVoice.stream !== null, overlayAllowed: false }; },
  async overlayPermission() { return { allowed: false }; },
  // Veto calls in a browser: the banner plugin rings its own alarm and opens the hub page for Deny / Approve / Shelve
  // (the hub only takes them under its own Origin).
  async vetoAction() { return { ok: false, error: 'browser' }; },
  async vetoAlarm() { /* the plugin rings in the page */ },
  async vetoAlarmTest() { /* the plugin rings in the page */ },
  async vetoAlarmStop() { /* nothing rings natively */ },
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
 * alone. PUTs to the hub's data server (`/data/…`, e.g. the appearance document) go through the native `hubPut`; any
 * other write to the hub is refused rather than sent without the session.
 * Installed once from main.tsx; does nothing in a browser.
 */
export function routeHubFetch(hub: string): void {
  if (!isNative()) return;
  const origin = new URL(hub).origin;
  // The shell normally loads the hosted app (capacitor.config.json `server.url` = https://amberx.amberxai.com), which
  // sits under the hub's cookie domain: the WebView sends the hub session itself (fetch and the live SSE feed), so
  // only a bundled copy (https://localhost) needs its hub reads routed natively.
  if (!sharesHubSite(location.href, hub)) routeFetch(origin);
  routeOpen(origin);
}

function routeFetch(origin: string): void {
  const plain = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let target: URL | null = null;
    try { target = new URL(url, location.href); } catch { /* not a URL */ }
    if (!target || target.origin !== origin) return plain(input, init);
    let reply: { status: number; body: string; etag?: string };
    if (method === 'GET') reply = await native.hubGet({ url: target.href });
    else if (method === 'PUT' && target.pathname.startsWith('/data/')) {
      const raw = init?.body ?? (input instanceof Request ? await input.text() : '');
      if (typeof raw !== 'string') return new Response(null, { status: 400 });
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      reply = await native.hubPut({ url: target.href, body: raw, ifMatch: h.get('If-Match') ?? undefined });
    } else return new Response(null, { status: 405 });
    const { status, body, etag } = reply;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) headers.ETag = etag;
    return new Response(status === 204 || status === 304 ? null : body, { status: status || 502, headers });
  };
}

function routeOpen(origin: string): void {
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

/**
 * Lends the veto banner plugin (console `plugins/approvals-banner`, loaded here because its `targets` list AmberX) the
 * phone's side through lib-hub's `setVetoHost`: Deny / Approve now / Shelve with the phone's hub session, the alarm on
 * the alarm stream (through silent mode), notices raised by the watch service with Deny / Approve / Shelve buttons (with
 * the app closed too), and notification taps that open the veto screen. In a browser it lends nothing: the plugin works
 * from the page. Installed once from main.tsx.
 */
export function installVetoHost(): void {
  if (!isNative()) return;
  const done: Record<string, 'deny' | 'approve-now' | 'shelve'> = { denied: 'deny', approved: 'approve-now', shelved: 'shelve' };
  setVetoHost({
    notifiesNatively: true,
    act: async (id, action) => {
      const r = await native.vetoAction({ id, action });
      const state = r.state === 'approved-now' ? 'approved-now' : (r.state as VetoState | undefined);
      return { ok: r.ok, ...(state ? { state } : {}), ...(r.error ? { error: r.error } : {}) };
    },
    alarm: (cfg) => { void native.vetoAlarm(cfg).catch(() => undefined); },
    testAlarm: (cfg) => { void native.vetoAlarmTest(cfg).catch(() => undefined); },
    stopAlarm: () => { void native.vetoAlarmStop().catch(() => undefined); },
    open: (url) => { void native.hubOpen({ url }).catch(() => undefined); },
    onEvent: (fn) => {
      const h = native.addListener('veto', (e) => {
        if (e.action === 'open') fn({ id: e.id, action: 'open' });
        else if (done[e.action]) fn({ id: e.id, action: done[e.action]!, ok: true });
        else fn({ id: e.id, action: 'failed', ...(e.error ? { error: e.error } : {}) });
      });
      return () => { void h.then((x) => x.remove()).catch(() => undefined); };
    },
  });
}

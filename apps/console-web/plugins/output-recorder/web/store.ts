/**
 * Audio Output Recorder controller: the recorder's state (from the native side), the phone's queue and the recordings
 * on axHub. No React; the page subscribes, test.mts drives it with a fake bridge and a fake hub.
 */
import type { LocalChunk, OutputRecorderBridge, Handle } from './bridge';
import { HubRecordings, REC_IDLE, recReduce, type NativeEvent, type RecState, type Recording, type Settings } from './core.ts';

export interface State {
  rec: RecState;
  /** chunks on the phone waiting for axHub */
  queue: LocalChunk[];
  hub: { loaded: boolean; loading: boolean; error: string | null; items: Recording[] };
  /** id → what's happening to it (fetching, deleting…) */
  busy: Record<string, string>;
  /** the recording playing in the page, as an object URL */
  playing: { id: string; url: string } | null;
}

export interface Hooks {
  settings(): Settings;
  hub(): string;
  toast?(text: string, tone?: 'info' | 'success' | 'warning' | 'danger'): void;
  /** object URLs (the page's; tests pass a stub) */
  objectUrl?(bytes: Uint8Array, mime: string): string;
  revokeUrl?(url: string): void;
  fetchImpl?: typeof fetch;
}

export interface Controller {
  get(): State;
  subscribe(fn: () => void): () => void;
  /** the native recorder is here (AmberX on Android) */
  native(): boolean;
  attach(): Promise<void>;
  detach(): Promise<void>;
  refreshStatus(): Promise<void>;
  refreshQueue(): Promise<void>;
  refreshHub(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  toggle(on: boolean): Promise<void>;
  retry(): Promise<void>;
  discard(id: string): Promise<void>;
  configure(s: Partial<Settings>): Promise<void>;
  play(r: Recording): Promise<void>;
  stopPlaying(): void;
  share(r: Recording): Promise<void>;
  toExtract(r: Recording): Promise<void>;
  remove(r: Recording): Promise<void>;
  onEvent(e: NativeEvent): void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createController(bridge: OutputRecorderBridge | null, hooks: Hooks): Controller {
  let st: State = { rec: REC_IDLE, queue: [], hub: { loaded: false, loading: false, error: null, items: [] }, busy: {}, playing: null };
  const subs = new Set<() => void>();
  const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
  const busy = (id: string, what: string | null) => {
    const b = { ...st.busy };
    if (what) b[id] = what; else delete b[id];
    set({ busy: b });
  };
  const toast = (t: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info') => hooks.toast?.(t, tone);
  const client = () => new HubRecordings({ hub: hooks.hub(), project: hooks.settings().project, fetchImpl: hooks.fetchImpl });
  let handles: Handle[] = [];

  const c: Controller = {
    get: () => st,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    native: () => !!bridge,

    async attach() {
      if (!bridge) return;
      handles.push(await bridge.addListener('recorder', (e) => c.onEvent(e)));
      await c.refreshStatus();
      await c.refreshQueue();
      await c.configure({}); // the phone gets the page's settings (the tile uses them too)
    },
    async detach() { for (const h of handles) await h.remove(); handles = []; },

    onEvent(e) {
      set({ rec: recReduce(st.rec, { type: 'native', e }) });
      if (e.state === 'stopped' && typeof e.reason === 'string' && e.reason) toast(e.reason, 'warning');
      if (e.state === 'error') toast(String(e.message ?? 'The recorder stopped.'), 'danger');
      if (e.state === 'uploaded') void c.refreshHub();
      if (['chunk', 'uploaded', 'dropped', 'queue'].includes(e.state)) void c.refreshQueue();
    },

    async refreshStatus() {
      if (!bridge) return;
      try { const s = await bridge.status(); set({ rec: recReduce(st.rec, { type: 'status', status: s as unknown as Partial<RecState> }) }); }
      catch (e) { toast(`Couldn’t read the recorder: ${msg(e)}`, 'warning'); }
    },
    async refreshQueue() {
      if (!bridge) return;
      try { set({ queue: (await bridge.queue()).chunks ?? [] }); } catch { /* keep the last list */ }
    },
    async refreshHub() {
      set({ hub: { ...st.hub, loading: true } });
      try { set({ hub: { loaded: true, loading: false, error: null, items: await client().list() } }); }
      catch (e) { set({ hub: { ...st.hub, loaded: true, loading: false, error: msg(e) } }); }
    },

    async start() {
      if (!bridge) { toast('Recording runs in the AmberX app on Android.', 'warning'); return; }
      if (st.rec.running) return;
      set({ rec: recReduce(st.rec, { type: 'start' }) });
      try { await bridge.start(); }
      catch (e) { set({ rec: { ...st.rec, starting: false, note: msg(e) } }); toast(msg(e), 'danger'); }
    },
    async stop() {
      if (!bridge) return;
      try { await bridge.stop(); } catch (e) { toast(msg(e), 'danger'); }
    },
    toggle: (on) => (on ? c.start() : c.stop()),
    async retry() { if (bridge) await bridge.retry(); },
    async discard(id) {
      if (!bridge) return;
      try { await bridge.discard({ id }); await c.refreshQueue(); } catch (e) { toast(msg(e), 'danger'); }
    },
    async configure(s) {
      if (!bridge) return;
      try { await bridge.configure({ ...hooks.settings(), ...s }); } catch { /* applies at the next start anyway */ }
    },

    async play(r) {
      c.stopPlaying();
      busy(r.id, 'Loading');
      try {
        const bytes = await client().download(r);
        const url = hooks.objectUrl ? hooks.objectUrl(bytes, r.mime) : URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: r.mime }));
        set({ playing: { id: r.id, url } });
      } catch (e) { toast(msg(e), 'danger'); }
      finally { busy(r.id, null); }
    },
    stopPlaying() {
      if (!st.playing) return;
      (hooks.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u)))(st.playing.url);
      set({ playing: null });
    },
    async share(r) {
      busy(r.id, 'Getting it');
      try {
        if (bridge) { const { uri } = await bridge.fetch({ id: r.id }); await bridge.share({ uri }); return; }
        // the console: download the file
        const bytes = await client().download(r);
        const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: r.mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${r.name}.m4a`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch (e) { toast(msg(e), 'danger'); }
      finally { busy(r.id, null); }
    },
    async toExtract(r) {
      if (!bridge) { toast('Audio Extract runs in the AmberX app.', 'warning'); return; }
      busy(r.id, 'Getting it');
      try {
        const { uri } = await bridge.fetch({ id: r.id });
        await bridge.toExtract({ uri });
        toast(`${r.name} sent to Audio Extract.`, 'success');
      } catch (e) { toast(msg(e), 'danger'); }
      finally { busy(r.id, null); }
    },
    async remove(r) {
      if (st.playing?.id === r.id) c.stopPlaying();
      busy(r.id, 'Deleting');
      try {
        await client().remove(r);
        set({ hub: { ...st.hub, items: st.hub.items.filter((x) => x.id !== r.id) } });
        toast(`${r.name} deleted from axHub.`, 'success');
      } catch (e) { toast(msg(e), 'danger'); }
      finally { busy(r.id, null); }
    },
  };
  return c;
}

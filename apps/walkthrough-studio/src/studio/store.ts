/**
 * The studio store: the open project, the project list, selection, undo/redo, autosave, and the compiler's output.
 * Workspace layout (panes, toolbars) lives in ui.ts. Components read slices with `useStudio(sel)`; only a changed slice
 * re-renders. Every edit goes through `edit(label, fn)` so it lands on the undo stack and is autosaved.
 */
import { useSyncExternalStore } from 'react';
import { duplicateProject, newProject, normalizeProject, type DragItem, type Project } from './model';
import { DeviceStore, HubStore, type ProjectStore, type ProjectSummary } from './persist';
import { compile, type Compiled } from './compiler';
import { seedProject } from './seed';

export interface LogLine { at: string; level: 'info' | 'ok' | 'warn' | 'error'; text: string }
export interface Selection { piece: string | null; section: string | null; multi: string[] }

export interface StudioState {
  projects: ProjectSummary[];
  project: Project | null;
  selection: Selection;
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  undo: number;
  redo: number;
  compiled: Compiled | null;
  log: LogLine[];
  /** the piece the preview / browser is showing */
  playing: { at: number; running: boolean } | null;
  recording: { startedAt: number; events: number } | null;
  hub: { on: boolean; address: string; error: string | null };
}

type Listener = () => void;

const LAST = 'ws:last-project';
const HUB_ON = 'ws:hub-store';
const safe = <T,>(f: () => T, fb: T): T => { try { return f(); } catch { return fb; } };

export class StudioStore {
  private s: StudioState;
  private listeners = new Set<Listener>();
  private past: Project[] = [];
  private future: Project[] = [];
  private lastLabel = '';
  private lastAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly device = new DeviceStore();
  hubStore: HubStore | null = null;

  constructor(hubAddress: string) {
    const on = safe(() => localStorage.getItem(HUB_ON) === '1', false);
    this.s = { projects: [], project: null, selection: { piece: null, section: null, multi: [] }, dirty: false, saving: false, savedAt: null, undo: 0, redo: 0, compiled: null, log: [], playing: null, recording: null, hub: { on, address: hubAddress, error: null } };
    if (on && hubAddress) this.hubStore = new HubStore(hubAddress);
  }

  /* ---- subscription ---- */
  get = () => this.s;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<StudioState>) { this.s = { ...this.s, ...patch }; this.listeners.forEach((l) => l()); }

  log(text: string, level: LogLine['level'] = 'info') {
    this.set({ log: [...this.s.log.slice(-499), { at: new Date().toISOString(), level, text }] });
  }

  /* ---- projects ---- */
  private stores(): ProjectStore[] { return [this.device, ...(this.hubStore ? [this.hubStore] : [])]; }

  private booting: Promise<void> | null = null;
  /** load the project list and open the last project (once, however many callers ask) */
  boot(): Promise<void> { return (this.booting ??= this.doBoot()); }
  private async doBoot() {
    await this.refreshList();
    if (!this.s.projects.length) {
      const seed = seedProject();
      await this.device.save(seed);
      this.log(`Created the seed project "${seed.name}" with ${Object.keys(seed.pieces).length} pieces.`, 'ok');
      await this.refreshList();
    }
    const last = safe(() => localStorage.getItem(LAST), null);
    await this.open(last && this.s.projects.some((p) => p.id === last) ? last : this.s.projects[0]!.id);
  }

  async refreshList() {
    const lists = await Promise.all(this.stores().map((st) => st.list().catch((e) => { this.set({ hub: { ...this.s.hub, error: (e as Error).message } }); return [] as ProjectSummary[]; })));
    const map = new Map<string, ProjectSummary>();
    for (const l of lists) for (const x of l) {
      const had = map.get(x.id);
      map.set(x.id, had ? { ...(had.updatedAt >= x.updatedAt ? had : x), where: 'both' } : x);
    }
    this.set({ projects: [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  }

  async open(id: string) {
    await this.flush();
    let best: Project | null = null;
    for (const st of this.stores()) {
      const p = await st.load(id).catch(() => null);
      if (p && (!best || p.updatedAt > best.updatedAt)) best = p;
    }
    if (!best) { this.log(`Project ${id} could not be loaded.`, 'error'); return; }
    this.past = []; this.future = [];
    safe(() => localStorage.setItem(LAST, id), undefined);
    const first = Object.keys(best.pieces)[0] ?? null;
    this.set({ project: best, dirty: false, undo: 0, redo: 0, compiled: null, selection: { piece: this.s.project?.id === id ? this.s.selection.piece : first, section: null, multi: [] } });
    this.log(`Opened "${best.name}".`);
  }

  async create(name = 'Untitled walkthrough', from?: 'seed' | 'blank') {
    const p = from === 'seed' ? { ...seedProject(), name } : newProject(name);
    await this.persist(p);
    await this.refreshList();
    await this.open(p.id);
    this.log(`Created "${p.name}".`, 'ok');
  }
  async duplicate(id = this.s.project?.id) {
    if (!id) return;
    const src = id === this.s.project?.id ? this.s.project : await this.device.load(id);
    if (!src) return;
    const copy = duplicateProject(src);
    await this.persist(copy); await this.refreshList(); await this.open(copy.id);
    this.log(`Duplicated "${src.name}" as "${copy.name}".`, 'ok');
  }
  async rename(id: string, name: string) {
    if (this.s.project?.id === id) return this.edit('Rename project', (p) => ({ ...p, name, root: { ...p.root, title: name } }));
    const p = await this.device.load(id); if (!p) return;
    await this.persist({ ...p, name, updatedAt: new Date().toISOString() }); await this.refreshList();
  }
  async remove(id: string) {
    for (const st of this.stores()) await st.remove(id).catch(() => undefined);
    await this.refreshList();
    if (this.s.project?.id === id) { if (this.s.projects[0]) await this.open(this.s.projects[0].id); else await this.create(); }
    this.log('Project deleted.', 'warn');
  }
  async importJson(text: string) {
    const p = normalizeProject(JSON.parse(text));
    if (this.s.projects.some((x) => x.id === p.id)) p.id = `${p.id}-imported-${Date.now().toString(36)}`;
    await this.persist(p); await this.refreshList(); await this.open(p.id);
    this.log(`Imported "${p.name}".`, 'ok');
  }

  /* ---- editing ---- */
  /** apply an edit to the open project; edits with the same label within 1.2 s share one undo step (typing) */
  edit(label: string, fn: (p: Project) => Project) {
    const cur = this.s.project; if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    const t = Date.now();
    if (label !== this.lastLabel || t - this.lastAt > 1200) { this.past.push(cur); if (this.past.length > 200) this.past.shift(); }
    this.lastLabel = label; this.lastAt = t;
    this.future = [];
    this.set({ project: next, dirty: true, undo: this.past.length, redo: 0 });
    this.scheduleSave();
  }
  undoEdit() {
    const prev = this.past.pop(); if (!prev || !this.s.project) return;
    this.future.push(this.s.project); this.lastLabel = '';
    this.set({ project: prev, dirty: true, undo: this.past.length, redo: this.future.length }); this.scheduleSave();
  }
  redoEdit() {
    const nxt = this.future.pop(); if (!nxt || !this.s.project) return;
    this.past.push(this.s.project); this.lastLabel = '';
    this.set({ project: nxt, dirty: true, undo: this.past.length, redo: this.future.length }); this.scheduleSave();
  }

  select(sel: Partial<Selection>) { this.set({ selection: { ...this.s.selection, ...sel } }); }
  toggleMulti(id: string) { const m = this.s.selection.multi; this.select({ multi: m.includes(id) ? m.filter((x) => x !== id) : [...m, id] }); }

  /* ---- saving ---- */
  private scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.flush(), 700); }
  private async persist(p: Project) {
    await this.device.save(p);
    if (this.hubStore) {
      try { await this.hubStore.save(p); if (this.s.hub.error) this.set({ hub: { ...this.s.hub, error: null } }); }
      catch (e) { this.set({ hub: { ...this.s.hub, error: (e as Error).message } }); this.log(`axHub: ${(e as Error).message}`, 'warn'); }
    }
  }
  async flush() {
    clearTimeout(this.saveTimer);
    const p = this.s.project; if (!p || !this.s.dirty) return;
    this.set({ saving: true });
    try { await this.persist(p); this.set({ dirty: false, savedAt: new Date().toISOString() }); await this.refreshList(); }
    catch (e) { this.log((e as Error).message, 'error'); }
    finally { this.set({ saving: false }); }
  }
  setHub(on: boolean) {
    safe(() => localStorage.setItem(HUB_ON, on ? '1' : '0'), undefined);
    this.hubStore = on && this.s.hub.address ? new HubStore(this.s.hub.address) : null;
    this.set({ hub: { ...this.s.hub, on, error: null } });
    if (on && this.s.project) { this.set({ dirty: true }); void this.flush(); }
    void this.refreshList();
  }

  /* ---- compiling ---- */
  compileNow(full = false) {
    const p = this.s.project; if (!p) return null;
    const out = compile(p, full ? undefined : p.compiled?.hashes);
    this.set({ compiled: out });
    this.edit('Compile', (q) => ({ ...q, compiled: { at: out.at, hashes: out.hashes, durationSec: out.durationSec } }));
    this.log(`Compiled ${out.segments.length} segments, ${out.reused} reused, ${out.rebuilt} rebuilt, ${out.skipped.length} left out — ${Math.round(out.durationSec)} s.`, 'ok');
    for (const w of out.warnings) this.log(w, 'warn');
    return out;
  }

  setPlaying(v: StudioState['playing']) { this.set({ playing: v }); }
  setRecording(v: StudioState['recording']) { this.set({ recording: v }); }

  /** drag-and-drop helpers used by every pane */
  selectedItem(): DragItem | null {
    const { piece, section } = this.s.selection;
    return piece ? { kind: 'piece', id: piece } : section ? { kind: 'section', id: section } : null;
  }
}

let store: StudioStore | null = null;
export function initStore(hub: string): StudioStore { store ??= new StudioStore(hub); return store; }
export function studio(): StudioStore { if (!store) throw new Error('studio store not initialised'); return store; }

/** read a slice of the studio state; re-renders only when the slice changes (by Object.is) */
export function useStudio<T>(sel: (s: StudioState) => T): T {
  const st = studio();
  return useSyncExternalStore(st.subscribe, () => sel(st.get()), () => sel(st.get()));
}

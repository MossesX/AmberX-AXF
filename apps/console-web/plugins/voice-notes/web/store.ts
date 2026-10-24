/**
 * Voice notes — where its data lives: everything on axHub through lib-hubstore (no copy on this device).
 * Settings: HubSettings `settings/voice-notes.json`; lists: HubData table `lists`; saved notes: table `notes` (folder `voice-notes`,
 * written by the listener, Voice Vault). Notes are read only when the notes page asks (`loadNotes`).
 */
import { HubData, HubSettings, type HubState, type HubValue, type Row } from '@console/axf/libs/hubstore';
import { hubOrigin } from '@console/hubAppearance';
import { DATA_FOLDER, HUB_PROJECT, ID, LISTS_TABLE, NOTES_TABLE, SETTINGS_FILE, normalizeList, normalizeNote, normalizeSettings, sortLists, type NoteList, type SavedNote, type VoiceNotesSettings } from './core';

export interface Snapshot {
  hub: string; state: HubState; settings: VoiceNotesSettings; lists: NoteList[]; error: string | null; loaded: boolean;
  notes: SavedNote[]; notesLoaded: boolean; notesAt: number; notesBusy: boolean;
}

let settingsDoc: HubSettings | null = null;
let data: HubData | null = null;
let hub = '';
let snap: Snapshot = { hub: '', state: { status: 'idle' }, settings: normalizeSettings({}), lists: [], error: null, loaded: false, notes: [], notesLoaded: false, notesAt: 0, notesBusy: false };
const subs = new Set<() => void>();
const emit = (p: Partial<Snapshot>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };

export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const snapshot = () => snap;

function connect(): boolean {
  const h = hubOrigin();
  if (!h || h === 'off') { emit({ hub: 'off', state: { status: 'unreachable', reason: 'This console runs without axHub (AXF_APPEARANCE_HUB=off), so voice notes have nowhere to live.' } }); return false; }
  if (settingsDoc && hub === h) return true;
  hub = h;
  try {
    settingsDoc = new HubSettings({ hub: h, project: HUB_PROJECT, file: SETTINGS_FILE, appId: ID });
    data = new HubData({ hub: h, project: HUB_PROJECT, folder: DATA_FOLDER, mode: 'all' });
    settingsDoc.subscribe(() => emit({ state: settingsDoc!.state(), settings: normalizeSettings(settingsDoc!.all()) }));
    emit({ hub: h });
    return true;
  } catch (e) { emit({ error: (e as Error).message }); return false; }
}

/** Read settings and lists from axHub (also on focus, so another device's edits show). */
export async function load(): Promise<void> {
  if (!connect()) return;
  try {
    await settingsDoc!.load();
    const rows = await data!.table(LISTS_TABLE).rows();
    const lists = Object.entries(rows).map(([id, r]) => normalizeList(r, id)).filter((x): x is NoteList => !!x);
    emit({ lists: sortLists(lists), error: null, loaded: true, settings: normalizeSettings(settingsDoc!.all()), state: settingsDoc!.state() });
  } catch (e) { emit({ error: (e as Error).message, state: settingsDoc?.state() ?? snap.state }); }
}

export async function saveSetting<K extends keyof VoiceNotesSettings>(key: K, value: VoiceNotesSettings[K]): Promise<void> {
  if (!settingsDoc) return;
  try { await settingsDoc.set(key, value as unknown as HubValue); emit({ error: null }); }
  catch (e) { emit({ error: (e as Error).message }); }
}

export async function saveList(list: NoteList): Promise<boolean> {
  if (!data) return false;
  try {
    await data.table(LISTS_TABLE).put(list.id, list as unknown as Row);
    emit({ lists: sortLists([...snap.lists.filter((l) => l.id !== list.id), list]), error: null });
    return true;
  } catch (e) { emit({ error: (e as Error).message }); return false; }
}

export async function removeList(id: string): Promise<void> {
  if (!data) return;
  try { await data.table(LISTS_TABLE).remove(id); emit({ lists: snap.lists.filter((l) => l.id !== id), error: null }); }
  catch (e) { emit({ error: (e as Error).message }); }
}

/** Fetch the saved notes (and the lists, so each note can say where it went). */
export async function loadNotes(): Promise<void> {
  if (!connect() || snap.notesBusy) return;
  emit({ notesBusy: true });
  try {
    if (!snap.loaded) await load();
    const rows = await data!.table(NOTES_TABLE).rows();
    const notes = Object.entries(rows).map(([id, r]) => normalizeNote(r, id)).filter((x): x is SavedNote => !!x);
    emit({ notes, notesLoaded: true, notesAt: Date.now(), notesBusy: false, error: null });
  } catch (e) { emit({ error: (e as Error).message, notesBusy: false }); }
}

export async function removeNote(id: string): Promise<void> {
  if (!data) return;
  try { await data.table(NOTES_TABLE).remove(id); emit({ notes: snap.notes.filter((n) => n.id !== id), error: null }); }
  catch (e) { emit({ error: (e as Error).message }); }
}

const tableUrl = (t: string) => (hub && hub !== 'off' ? `${hub}/data/${HUB_PROJECT}/${DATA_FOLDER}/${t}/head.json` : '');
export const where = () => ({ settings: settingsDoc?.url ?? '', lists: tableUrl(LISTS_TABLE), notes: tableUrl(NOTES_TABLE) });

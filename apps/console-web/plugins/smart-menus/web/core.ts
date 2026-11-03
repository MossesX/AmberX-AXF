/**
 * Menus plugin — client side (smart-menu@1). Plugs the smart-menu engine (framework/core/engines/smartmenu.ts) into
 * every context menu and app menu through `rt.setMenuSections`, keeps this person's settings, pins and pick log in step
 * with the server part, polls the Talking-about topics, and reports what each menu suggested. No React here.
 */
import type { AxfRuntime } from '@console/axf/core';
import {
  composeMenu, contextKey, filterWhen, menuCandidates, pickId, prunePicks, resetPicks, MENU_LOOK_KEY,
  type MenuItem, type MenuOpen, type MenuPick, type MenuSectionSpec, type MenuTopic, type MenuTopicTemplate, type MenuLook,
} from '@console/axf/core';
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'smart-menus';
export const MODULE = 'ai.amberx.axf.console.smart-menus';
export const VIEW = 'smart-menus';

export interface MenusSettings {
  enabled: boolean;
  learning: boolean;
  suggestions: number;
  showWhy: boolean;
  topicTtlMin: number;
  sections: MenuSectionSpec[];
  perMenu: Record<string, { sections?: MenuSectionSpec[]; off?: boolean }>;
  behavior: { openOnHover: boolean; longPressMs: number; keyboard: boolean };
}

export const DEFAULT_SETTINGS: MenusSettings = {
  enabled: true, learning: true, suggestions: 4, showWhy: true, topicTtlMin: 30,
  sections: [
    { kind: 'talking', on: true, max: 4, label: 'Talking about', icon: 'message-circle' },
    { kind: 'pinned', on: true, max: 8, label: 'Pinned', icon: 'pin' },
    { kind: 'suggested', on: true, max: 4, label: 'Suggested', icon: 'sparkles' },
    { kind: 'context', on: true, max: 8, label: 'For this', icon: 'target' },
    { kind: 'static', on: true },
  ],
  perMenu: {},
  behavior: { openOnHover: false, longPressMs: 0, keyboard: true },
};

/** What each topic kind brings into a menu's Talking-about section (other plugins add theirs with `when: { topic }`). */
export const TOPIC_TEMPLATES: MenuTopicTemplate[] = [
  { kind: 'build', menus: ['app:builds', 'ctx:*'], items: [
    { id: 'topic.build.open', label: 'Open build: {label}', icon: 'hammer', action: 'smart-menus.topic:build:{id}' },
    { id: 'topic.build.orchestrator', label: 'In the orchestrator', icon: 'git-branch', action: 'nav:build-orchestrator' },
    { id: 'topic.build.review', label: 'Its UI Review', icon: 'image', action: 'ui-review.open' },
    { id: 'topic.build.agent', label: 'Its agent (Breakroom)', icon: 'users', action: 'nav:agent-swarm' },
  ] },
  { kind: 'pr', menus: ['app:builds', 'ctx:*'], items: [{ id: 'topic.pr.open', label: 'Open PR #{id}', icon: 'git-pull-request', action: 'smart-menus.topic:pr:{id}' }] },
  { kind: 'plugin', menus: ['app:plugins', 'ctx:*'], items: [
    { id: 'topic.plugin.open', label: '{label} in Plugin manager', icon: 'package', action: 'plugin-manager.open:{id}' },
    { id: 'topic.plugin.settings', label: '{label} settings', icon: 'settings', action: 'settings.open:{id}' },
  ] },
  { kind: 'screen', menus: ['app:view', 'app:console', 'ctx:*'], items: [{ id: 'topic.screen.open', label: 'Open {label}', icon: 'layout', action: 'nav:{id}' }] },
  { kind: 'setting', menus: ['app:console', 'app:view', 'ctx:*'], items: [{ id: 'topic.setting.open', label: 'Settings: {label}', icon: 'settings', action: 'settings.open:{id}' }] },
  { kind: 'agent', menus: ['app:builds', 'ctx:*'], items: [{ id: 'topic.agent.open', label: '{label} in the Breakroom', icon: 'users', action: 'nav:agent-swarm' }] },
  { kind: 'profile', menus: ['app:builds', 'ctx:*'], items: [{ id: 'topic.profile.open', label: 'Builds: {label}', icon: 'layers', action: 'builds.open' }] },
  { kind: 'note', menus: ['ctx:*'], items: [{ id: 'topic.note.open', label: 'Note: {label}', icon: 'file-text', action: 'smart-menus.topic:note:{id}' }] },
];

export interface MenusState {
  ready: boolean;
  user: string;
  settings: MenusSettings;
  pins: Record<string, string[]>;
  picks: MenuPick[];
  topics: MenuTopic[];
  suggestions: Record<string, { key: string; items: { id: string; label: string; section: string; why: string }[]; at: number } | null>;
  repo: string;
  /** menus seen this session: their key and pickable items (for pinning in settings) */
  seen: Record<string, { label: string; items: { id: string; label: string }[] }>;
  /** the menu the page opens on (Menu settings in a menu) */
  focus?: string;
}

const state: MenusState = { ready: false, user: 'owner', settings: DEFAULT_SETTINGS, pins: {}, picks: [], topics: [], suggestions: {}, repo: '', seen: {} };
const listeners = new Set<() => void>();
let runtime: AxfRuntime | null = null;

export const menusState = (): MenusState => state;
/** Open the page on one menu's settings (the Menu settings hook in every menu). */
export function focusMenu(menu: string | undefined) { state.focus = menu; changed(); }
export function subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function changed() { for (const l of listeners) l(); runtime?.menuSectionsChanged(); }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return (await r.json()) as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function load(): Promise<void> {
  try {
    const s = await api<Omit<MenusState, 'ready' | 'seen'>>('state');
    Object.assign(state, { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings, behavior: { ...DEFAULT_SETTINGS.behavior, ...s.settings?.behavior } }, ready: true });
  } catch (e) {
    runtime?.terminal.warn('menus', `smart menus: could not load (${String(e)}); menus stay as they are`);
  }
  changed();
}

export async function saveSettings(patch: Partial<MenusSettings>): Promise<void> {
  state.settings = { ...state.settings, ...patch, ...(patch.behavior ? { behavior: { ...state.settings.behavior, ...patch.behavior } } : {}) };
  changed();
  const r = await api<{ settings: MenusSettings }>('settings', json('PUT', patch));
  state.settings = { ...DEFAULT_SETTINGS, ...r.settings };
  changed();
}

export async function setPin(menu: string, item: string, on: boolean): Promise<void> {
  const list = (state.pins[menu] ?? []).filter((x) => x !== item);
  state.pins = { ...state.pins, [menu]: on ? [...list, item] : list };
  changed();
  const r = await api<{ pins: string[] }>('pins', json('POST', { menu, item, on }));
  state.pins = { ...state.pins, [menu]: r.pins };
  changed();
}

export async function resetLearning(scope: { menu?: string; key?: string } = {}): Promise<number> {
  state.picks = resetPicks(state.picks, scope);
  if (!scope.key) state.suggestions = scope.menu ? { ...state.suggestions, [scope.menu]: null } : {};
  changed();
  const r = await api<{ forgot: number }>('reset', json('POST', scope));
  return r.forgot;
}

export async function setTopics(topics: Omit<MenuTopic, 'at'>[], replace = false): Promise<void> {
  const r = await api<{ topics: MenuTopic[] }>('topics', json('POST', { topics, replace }));
  state.topics = r.topics; changed();
}
export async function clearTopics(): Promise<void> {
  await api('topics/clear', json('POST', {}));
  state.topics = []; changed();
}

/* ---------------- picks: kept locally at once, sent in small batches ---------------- */

let outbox: MenuPick[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function queuePick(p: MenuPick) {
  outbox.push(p);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const batch = outbox; outbox = [];
    void api('picks', json('POST', { picks: batch })).catch(() => { outbox = [...batch, ...outbox].slice(-200); });
  }, 1500);
}

/* ---------------- suggestions snapshot: what each menu showed (REST / MCP / CLI "get suggestions") ---------------- */

const reported = new Map<string, string>();
let reportTimer: ReturnType<typeof setTimeout> | undefined;
const pendingReports = new Map<string, unknown>();
function report(open: MenuOpen, items: MenuItem[]) {
  const dyn = items.filter((i) => i.section && !i.heading).map((i) => ({ id: pickId(i), label: i.label ?? '', section: i.section ?? '', why: i.section === 'suggested' ? i.hint ?? '' : '' }));
  const sig = JSON.stringify(dyn);
  if (reported.get(open.menu) === sig) return;
  reported.set(open.menu, sig);
  pendingReports.set(open.menu, { menu: open.menu, key: contextKey(open), items: dyn });
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const all = [...pendingReports.values()]; pendingReports.clear();
    for (const body of all) void api('suggestions', json('POST', body)).catch(() => undefined);
  }, 3000);
}

/* ---------------- the provider ---------------- */

/** Sections for one menu: the person's per-menu override, else what the menu asset declares, else the plugin's. */
export function sectionsFor(rt: AxfRuntime, open: MenuOpen): MenuSectionSpec[] {
  const own = state.settings.perMenu[open.menu]?.sections;
  if (own?.length) return own;
  if (open.kind === 'context') {
    const cm = rt.asset('context-menu').data as { sections?: MenuSectionSpec[]; targetSections?: Record<string, MenuSectionSpec[]> };
    const decl = cm.targetSections?.[open.target ?? ''] ?? cm.sections;
    if (decl?.length) return decl;
  } else {
    const am = rt.asset('app-menu').data as { menus?: { id: string; sections?: MenuSectionSpec[] }[] };
    const decl = am.menus?.find((m) => m.id === open.target)?.sections;
    if (decl?.length) return decl;
  }
  return state.settings.sections;
}

export function compose(rt: AxfRuntime, open: MenuOpen, items: MenuItem[], now = Date.now()): MenuItem[] {
  const s = state.settings;
  state.seen[open.menu] = { label: open.target ?? open.menu, items: menuCandidates(filterWhen(items, open, state.topics)).map((i) => ({ id: i.id, label: i.label ?? i.id })) };
  if (!s.enabled || s.perMenu[open.menu]?.off) return filterWhen(items, open, state.topics);
  const out = composeMenu({
    items, open, now, picks: state.picks, pins: state.pins[open.menu] ?? [], topics: state.topics, templates: TOPIC_TEMPLATES,
    sections: sectionsFor(rt, open), tzOffsetMin: new Date(now).getTimezoneOffset(),
    options: { learning: s.learning, suggestions: s.suggestions, showWhy: s.showWhy, topicTtlMin: s.topicTtlMin },
  }).items;
  report(open, out);
  return out;
}

export function picked(open: MenuOpen, item: MenuItem, now = Date.now()) {
  if (!state.settings.learning || !state.settings.enabled || item.heading || item.separator) return;
  const p = { key: contextKey(open), item: pickId(item), at: now };
  state.picks = prunePicks([...state.picks, p], now);
  queuePick(p);
}

/* ---------------- topics: polled while the page is visible, and on focus ---------------- */

let topicTimer: ReturnType<typeof setInterval> | undefined;
async function pollTopics() {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const r = await api<{ topics: MenuTopic[] }>('topics');
    if (JSON.stringify(r.topics) !== JSON.stringify(state.topics)) { state.topics = r.topics; changed(); }
  } catch { /* offline: keep the last ones (they still fade by time) */ }
}

/** Start: load, plug in, poll. Called once from the plugin's register(). */
export function start(rt: AxfRuntime): void {
  runtime = rt;
  rt.setMenuSections({
    module: MODULE,
    compose: (open, items) => compose(rt, open, items),
    picked: (open, item) => picked(open, item),
    behavior: () => (state.settings.enabled ? state.settings.behavior : {}),
  });
  void load();
  clearInterval(topicTimer);
  topicTimer = setInterval(() => void pollTopics(), 15_000);
  if (typeof window !== 'undefined') window.addEventListener('focus', () => void pollTopics());
}

/* ---------------- the look (axf.menus.look: an appearance setting, shared through axHub) ---------------- */

export const lookOf = (rt: AxfRuntime): MenuLook => (rt.settings.get(MENU_LOOK_KEY) as MenuLook | undefined) ?? {};
export function setLook(rt: AxfRuntime, look: MenuLook): void { rt.settings.set(MENU_LOOK_KEY, look as never); }

/** A look as a shareable file (menu-look@1): export / import between apps or people. */
export const LOOK_FRAME = 'menu-look@1';
export function exportLook(look: MenuLook): string { return JSON.stringify({ $axf: LOOK_FRAME, look }, null, 2); }
export function importLook(text: string): MenuLook {
  const j = JSON.parse(text) as { $axf?: string; look?: MenuLook; data?: MenuLook };
  const look = j.$axf === LOOK_FRAME ? j.look : j.data ?? (j as MenuLook);
  if (!look || typeof look !== 'object' || Array.isArray(look)) throw new Error('not a menu look (menu-look@1)');
  return look;
}

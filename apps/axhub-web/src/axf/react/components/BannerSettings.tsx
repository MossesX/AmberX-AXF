/*
 * Banner settings (Brett, Oct 22 2026): "right clicking on any banner and selecting Banner settings opens a settings
 * interface with tabs for all installed banner plugins; every banner has its own settings for its look and behaviour."
 *
 * Every banner a library contributes (AxfWebLibrary.banners) is wrapped in a frame that applies the person's choices
 * for it, the same for every banner, whatever plugin drew it:
 *   look      tone (accent / info / success / warning / danger / neutral, or the banner's own), density, icon, icon +
 *             animation while working (BannerIcon), max height
 *   behaviour shown or not, launches expanded or minimized, hides itself after N seconds with nothing new, its place
 *             among the banners, hidden inside a host app (embed@1)
 * The frame is a context-menu target (`axf-banner`, payload = banner id): right-click / long-press → Banner settings opens
 * dialog `axf.banners.settings` on that banner's tab. The banner's own settings (its plugin's settings tab) are a button
 * away on the same tab. Choices are one setting, `axf.banners.prefs` ({ <banner id>: prefs }), per browser like any setting.
 *
 * Hide (Oct 23 2026, plugin@1 `banner`): every banner's tab starts with Hide (the banner stays mounted, hidden, so its
 * plugin keeps working; what it would have shown is logged to the terminal, channel `banners`), an indented Hide all
 * banners (tooltip lists them) and a timer (a hide lasts N minutes). One state, `axf.banners.hide`
 * (core/engines/bannerhide.ts), the same in every interface and every frame of the app (storage events), last change wins.
 *
 * Quick hide (Oct 23 2026): right-click / long-press a banner → an entry named after that banner (only that one) with
 * Hide for 1 / 5 / 10 minutes. While hidden that way the banner leaves a one-line note in its place (its name, when it's
 * back, Unhide) carrying the same menu, so it is unhidden the same way. Actions `banners.hide:<id>:<minutes>`,
 * `banners.unhide:<id>`.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../core';
import type { BannerDef, SlotDef } from '../library';
import type { MenuEntry } from '../../core/engines/windows';
import { FRAMEWORK_MODULE } from '../../core/engines/actions';
import type { DialogMap } from './Overlays';
import { Button } from './Controls';
import { Checkbox, Section, SelectField, Switch } from './Forms';
import {
  BANNER_HIDE_KEY, QUICK_HIDE_MINUTES, TIMER_DEFAULT, allBannersHidden, hideBannerFor, hideEndsAt, bannerHidden, minutesFrom, minutesInput, nextHideEnd, parseBannerHide,
  setAllBannersHidden, setBannerHidden, setBannerTimer, showAllBanners, anyBannerHide, type BannerHideState,
} from '../../core/engines/bannerhide';
import { Icon } from './Icon';
import { useAxfState, useRuntime } from '../AxfProvider';

export type BannerTone = 'own' | 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type BannerDensity = 'compact' | 'regular' | 'roomy';
export interface BannerPrefs {
  tone: BannerTone;
  density: BannerDensity;
  icon: boolean;
  /** max height in rows (0 = the banner's own) */
  maxRows: number;
  show: boolean;
  launch: 'expanded' | 'minimized';
  /** seconds with nothing new before it hides itself (0 = never); anything new brings it back */
  autoHide: number;
  /** place among the banners (lower = higher up); null = the banner's own order */
  order: number | null;
  hideInHost: boolean;
  /** icon shown while the banner is doing work ('' = the banner's own working icon) */
  workIcon: string;
  /** how that icon moves while working ('' = the banner's own, else spin) */
  workAnim: BannerWorkAnim | '';
}
export type BannerWorkAnim = 'spin' | 'pulse' | 'bounce' | 'blink' | 'off';
const WORK_ANIMS: BannerWorkAnim[] = ['spin', 'pulse', 'bounce', 'blink', 'off'];
/** icons offered for "While working" (any Icon name works) */
export const BANNER_WORK_ICONS = ['refresh', 'zap', 'hammer', 'sparkles', 'rocket', 'branch', 'upload', 'download', 'clock', 'cloud', 'terminal', 'star', 'sun', 'shuffle'];
export const BANNER_PREFS_KEY = 'axf.banners.prefs';
export const BANNER_SETTINGS_DIALOG = 'axf.banners.settings';
export const BANNER_CTX_TARGET = 'axf-banner';
export const DEFAULT_BANNER_PREFS: BannerPrefs = { tone: 'own', density: 'regular', icon: true, maxRows: 0, show: true, launch: 'expanded', autoHide: 0, order: null, hideInHost: false, workIcon: '', workAnim: '' };
const TONES: BannerTone[] = ['own', 'accent', 'info', 'success', 'warning', 'danger', 'neutral'];
const DENSITIES: BannerDensity[] = ['compact', 'regular', 'roomy'];

function allPrefs(rt: AxfRuntime): Record<string, Partial<BannerPrefs>> {
  const v = rt.settings.get(BANNER_PREFS_KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Partial<BannerPrefs>>) : {};
}

/** One banner's choices, every field checked (anything odd = the default). */
export function bannerPrefs(rt: AxfRuntime, id: string): BannerPrefs {
  const p = allPrefs(rt)[id] ?? {};
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  return {
    tone: TONES.includes(p.tone as BannerTone) ? (p.tone as BannerTone) : 'own',
    density: DENSITIES.includes(p.density as BannerDensity) ? (p.density as BannerDensity) : 'regular',
    icon: p.icon !== false,
    maxRows: num(p.maxRows, 0, 60, 0),
    show: p.show !== false,
    launch: p.launch === 'minimized' ? 'minimized' : 'expanded',
    autoHide: num(p.autoHide, 0, 3600, 0),
    order: typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : null,
    hideInHost: p.hideInHost === true,
    workIcon: typeof p.workIcon === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(p.workIcon) ? p.workIcon : '',
    workAnim: WORK_ANIMS.includes(p.workAnim as BannerWorkAnim) ? (p.workAnim as BannerWorkAnim) : '',
  };
}

export function setBannerPrefs(rt: AxfRuntime, id: string, patch: Partial<BannerPrefs>): void {
  const all = allPrefs(rt);
  rt.settings.set(BANNER_PREFS_KEY, { ...all, [id]: { ...all[id], ...patch } } as never);
}

export function resetBannerPrefs(rt: AxfRuntime, id: string): void {
  const { [id]: _drop, ...rest } = allPrefs(rt);
  rt.settings.set(BANNER_PREFS_KEY, rest as never);
}

/** Re-renders when any banner's choices change (settings don't go through the runtime state); returns the raw value. */
export function useBannerPrefsTick(): unknown {
  const rt = useRuntime();
  const sub = useCallback((fn: () => void) => rt.settings.onChange(BANNER_PREFS_KEY, fn), [rt]);
  const get = useCallback(() => rt.settings.get(BANNER_PREFS_KEY), [rt]);
  return useSyncExternalStore(sub, get, get);
}

/* ---------------- hide / hide all / timer (one state for every interface) ---------------- */

export function bannerHideState(rt: AxfRuntime): BannerHideState { return parseBannerHide(rt.settings.get(BANNER_HIDE_KEY)); }
function saveHide(rt: AxfRuntime, next: BannerHideState): void { rt.settings.set(BANNER_HIDE_KEY, next as never); }
/** Hide or show one banner (everywhere this app runs in this browser; the last switch touched wins). */
export function setBannerHide(rt: AxfRuntime, id: string, on: boolean): void { saveHide(rt, setBannerHidden(bannerHideState(rt), id, on, Date.now())); }
/** Hide or show every banner the app has. */
export function setAllBannersHide(rt: AxfRuntime, on: boolean): void { saveHide(rt, setAllBannersHidden(bannerHideState(rt), knownBanners(rt).map((b) => b.id), on, Date.now())); }
/** Show every banner and reset every hide timer (one tap, in every interface). */
export function showAllBannersNow(rt: AxfRuntime): void { saveHide(rt, showAllBanners(bannerHideState(rt), knownBanners(rt).map((b) => b.id), Date.now())); }
export function setBannerHideTimer(rt: AxfRuntime, patch: { on?: boolean; minutes?: number }): void { saveHide(rt, setBannerTimer(bannerHideState(rt), patch, Date.now())); }
/** Hide one banner for N minutes (its right-click menu). */
export function hideBannerForMinutes(rt: AxfRuntime, id: string, minutes: number): void { saveHide(rt, hideBannerFor(bannerHideState(rt), id, minutes, Date.now())); }
/** Is this banner hidden right now (its Hide, Hide all, the timer not run out)? */
export function isBannerHidden(rt: AxfRuntime, id: string): boolean { return bannerHidden(bannerHideState(rt), id, Date.now()); }

/** Re-renders when the hide state changes, and again when a timed hide runs out. */
export function useBannerHideTick(): BannerHideState {
  const rt = useRuntime();
  const sub = useCallback((fn: () => void) => rt.settings.onChange(BANNER_HIDE_KEY, fn), [rt]);
  const get = useCallback(() => rt.settings.get(BANNER_HIDE_KEY), [rt]);
  const raw = useSyncExternalStore(sub, get, get);
  const s = parseBannerHide(raw);
  const [, setNow] = useState(0);
  const next = nextHideEnd(s, Object.keys(s.banners), Date.now());
  useEffect(() => {
    if (next === null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(2 ** 31 - 1, Math.max(0, next - Date.now()) + 50));
    return () => clearTimeout(t);
  }, [next]);
  return s;
}

/* ---------------- the banners an app has (for the dialog's tabs) ---------------- */

const known = new WeakMap<AxfRuntime, BannerDef[]>();
const installed = new WeakSet<AxfRuntime>();

/** The banners every app has registered (all of them, including ones not on this page, e.g. inside a host). */
export function knownBanners(rt: AxfRuntime): BannerDef[] { return known.get(rt) ?? []; }
const knownSubs = new Set<() => void>();
const EMPTY: BannerDef[] = [];
/** knownBanners that re-renders when the app's banner list changes (plugins load after the first render). */
export function useKnownBanners(): BannerDef[] {
  const rt = useRuntime();
  const get = () => known.get(rt) ?? EMPTY;
  return useSyncExternalStore((f) => { knownSubs.add(f); return () => { knownSubs.delete(f); }; }, get, get);
}

export const bannerLabel = (b: Pick<BannerDef, 'id' | 'label'>) => b.label ?? b.id.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function install(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  rt.actions.withModule(FRAMEWORK_MODULE, () => installActions(rt));
}

function installActions(rt: AxfRuntime): void {
  rt.actions.register('banners.settings', ([id], ctx) => {
    const pick = id || (typeof ctx?.payload === 'string' ? ctx.payload : '');
    // Shown as a page on its own (a host's Banners settings tab, embed@1 page `banners`): switch the page's tab instead.
    if (rt.embedded?.page === 'banners') { setWantTab(pick); return; }
    rt.openDialog(BANNER_SETTINGS_DIALOG, pick ? { id: pick } : {});
  }, { label: 'Banner settings' });
  // Every frame of this app (a host's Banners tab, its banner strip, the app's own tab) shows the same choices at once:
  // the runtime re-reads settings when another frame saves (storage events) and re-renders on any settings change.
  rt.actions.register('banners.hide', ([id, min]) => {
    const m = Number(min);
    if (id && Number.isFinite(m) && m > 0) hideBannerForMinutes(rt, id, m);
  }, { label: 'Hide banner for a while' });
  rt.actions.register('banners.unhide', ([id]) => { if (id) setBannerHide(rt, id, false); }, { label: 'Unhide banner' });
  rt.actions.register('banners.show-all', () => showAllBannersNow(rt), { label: 'Show all banners (reset hide timers)' });
  // One entry, named after the banner that was right-clicked (payload = its id), never the others.
  rt.contextExtras.set(BANNER_CTX_TARGET, (_t, id) => (id ? [bannerMenu(rt, id)] : []));
  rt.addContextItems({ id: 'axf.banners.ctx', module: 'axf', target: BANNER_CTX_TARGET, order: 1, items: [{ id: 'axf-banner-settings', label: 'Banner settings', icon: 'settings', action: 'banners.settings' }] });
}

function bannerMenu(rt: AxfRuntime, id: string): MenuEntry {
  const b = knownBanners(rt).find((x) => x.id === id);
  const hidden = isBannerHidden(rt, id);
  const hides: MenuEntry[] = QUICK_HIDE_MINUTES.map((m) => ({ id: `axf-banner-hide-${m}`, label: `Hide for ${m} minute${m === 1 ? '' : 's'}`, icon: 'clock', action: `banners.hide:${id}:${m}` }));
  const showAll: MenuEntry[] = anyBannerHide(bannerHideState(rt), Date.now()) ? [{ id: 'axf-banner-show-all', label: 'Show all banners', icon: 'eye', action: 'banners.show-all' }] : [];
  const items = hidden ? [{ id: 'axf-banner-unhide', label: 'Unhide', icon: 'eye', action: `banners.unhide:${id}` }, ...showAll, { id: 'axf-banner-hide-sep', separator: true }, ...hides] : [...hides, ...(showAll.length ? [{ id: 'axf-banner-hide-sep', separator: true }, ...showAll] : [])];
  return { id: 'axf-banner-quick', label: b ? bannerLabel(b) : bannerLabel({ id }), icon: b?.icon ?? 'eye', items };
}

/**
 * The slot entries for app.frame.banners: every banner wrapped in its frame, filtered (hidden, hidden inside a host) and
 * ordered by the person's choices. `all` is every banner the app has (the dialog lists them), `shown` the ones this page
 * draws (default: all).
 */
export function bannerSlotDefs(rt: AxfRuntime, all: BannerDef[], shown: BannerDef[] = all): SlotDef[] {
  install(rt);
  const before = known.get(rt) ?? EMPTY;
  if (before.length !== all.length || before.some((b, i) => b.id !== all[i]?.id)) {
    known.set(rt, all);
    queueMicrotask(() => { migrateShow(rt); knownSubs.forEach((f) => f()); });
  }
  return shown
    .map((b) => ({ b, p: bannerPrefs(rt, b.id) }))
    .filter(({ p }) => !(p.hideInHost && rt.embedded))
    .map(({ b, p }) => ({ id: b.id, order: p.order ?? b.order, render: () => <BannerFrame id={b.id}>{b.render()}</BannerFrame> }))
    .sort((x, y) => (x.order ?? 100) - (y.order ?? 100));
}

/** Before Oct 23 2026 a banner was switched off with "Show this banner" (`show: false`, dropped from the page); that is
 * Hide now (still mounted, still logging). Moved over once; the old field is dropped. */
function migrateShow(rt: AxfRuntime): void {
  const all = allPrefs(rt);
  const off = Object.entries(all).filter(([, p]) => p && p.show === false).map(([id]) => id);
  if (!off.length) return;
  let h = bannerHideState(rt);
  for (const id of off) h = setBannerHidden(h, id, true, Date.now());
  saveHide(rt, h);
  const next = { ...all };
  for (const id of off) { const { show: _s, ...rest } = next[id]!; next[id] = rest; }
  rt.settings.set(BANNER_PREFS_KEY, next as never);
}

/* ---------------- the frame around each banner ---------------- */

const LaunchCtx = createContext<'expanded' | 'minimized'>('expanded');
const IdCtx = createContext('');

/**
 * A banner's corner icon (Brett, Oct 23 2026: "whenever a banner is doing any work, animate its icon"). Pass `working`
 * while the banner's plugin is doing anything (a push, a pull, a fix, a headless session on the VPS ...): the icon swaps to
 * the working icon picked in its Banner settings (default: the banner's `workIcon`, else refresh) and moves as picked
 * (default: the banner's `workAnim`, else spin; still under reduced motion). Every banner plugin draws its icon with this.
 */
export function BannerIcon({ icon, working = false, size = 18, className = '' }: { icon: string; working?: boolean; size?: number; className?: string }) {
  const rt = useRuntime();
  const id = useContext(IdCtx);
  useBannerPrefsTick();
  const p = bannerPrefs(rt, id);
  const def = knownBanners(rt).find((b) => b.id === id);
  const how = p.workAnim || def?.workAnim || 'spin';
  const anim = working && how !== 'off' ? how : undefined;
  return (
    <span className={`fx-banner-icon${className ? ` ${className}` : ''}`} data-fx-working={working ? anim ?? 'still' : undefined} aria-hidden>
      <Icon name={working ? p.workIcon || def?.workIcon || 'refresh' : icon} size={size} />
    </span>
  );
}

/** For a banner that can fold to one line: whether it starts open, as its Banner settings say (default open). */
export function useBannerLaunchOpen(): [boolean, (v: boolean) => void] {
  const launch = useContext(LaunchCtx);
  return useState(launch === 'expanded');
}

function BannerFrame({ id, children }: { id: string; children: ReactNode }) {
  const rt = useRuntime();
  useBannerPrefsTick();
  const p = bannerPrefs(rt, id);
  const hide = useBannerHideTick();
  const hiddenNow = bannerHidden(hide, id, Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const [asleep, setAsleep] = useState(false);
  // Hidden (Hide / Hide all): still mounted, so its plugin keeps working; what it would show is logged instead.
  useEffect(() => {
    const el = ref.current;
    if (!el || !hiddenNow) return;
    let last = (el.textContent ?? '').trim();
    let at = 0;
    const obs = new MutationObserver(() => {
      const now = (el.textContent ?? '').trim();
      if (now === last || Date.now() - at < 10_000) return;
      last = now; at = Date.now();
      rt.terminal.log('banners', `${id} (hidden): ${now.slice(0, 160) || 'empty'}`);
    });
    obs.observe(el, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [hiddenNow, id, rt]);
  // Hides itself after `autoHide` seconds with nothing new; any change in what it shows brings it back.
  useEffect(() => {
    const el = ref.current;
    if (!el || !p.autoHide) { setAsleep(false); return; }
    let timer = setTimeout(() => setAsleep(true), p.autoHide * 1000);
    let last = el.textContent ?? '';
    const obs = new MutationObserver(() => {
      const now = el.textContent ?? '';
      if (now === last) return;
      last = now;
      setAsleep(false);
      clearTimeout(timer);
      timer = setTimeout(() => setAsleep(true), p.autoHide * 1000);
    });
    obs.observe(el, { subtree: true, childList: true, characterData: true });
    return () => { clearTimeout(timer); obs.disconnect(); };
  }, [p.autoHide]);
  const until = hiddenNow ? hide.banners[id]?.until : undefined;
  const frame = (
    <div
      ref={ref}
      className="fx-banner-frame"
      hidden={asleep || hiddenNow}
      data-fx-banner-hidden={hiddenNow ? 'on' : undefined}
      data-fx-ctx-target={BANNER_CTX_TARGET}
      data-fx-ctx-payload={id}
      data-fx-banner-id={id}
      data-tone={p.tone === 'own' ? undefined : p.tone}
      data-density={p.density === 'regular' ? undefined : p.density}
      data-icon={p.icon ? undefined : 'off'}
      style={p.maxRows ? { maxHeight: `calc(var(--fx-row-h) * ${p.maxRows})`, overflow: 'auto' } : undefined}
    >
      <IdCtx.Provider value={id}><LaunchCtx.Provider value={p.launch}>{children}</LaunchCtx.Provider></IdCtx.Provider>
    </div>
  );
  if (until === undefined) return frame;
  return <>{frame}<QuickHideNote id={id} until={hideEndsAt(hide, id) ?? until} /></>;
}

/**
 * Banners hidden with Hide / Hide all (no end time) leave one line under the banners: how many, and Show them. Without it
 * a Hide all leaves nothing on screen to right-click, so the banners look broken (Oct 24 2026).
 */
export function HiddenBannersNote() {
  const rt = useRuntime();
  const hide = useBannerHideTick();
  const ids = useKnownBanners().map((b) => b.id).filter((id) => hideEndsAt(hide, id) === Infinity);
  if (!ids.length) return null;
  const show = () => { for (const id of ids) setBannerHide(rt, id, false); };
  return (
    <div className="fx-banner-snoozed fx-row" data-fx-banners-hidden="">
      <Icon name="eye" />
      <span className="fx-muted">{ids.length === 1 ? '1 banner is hidden' : `${ids.length} banners are hidden`}</span>
      <Button size="sm" tone="quiet" onClick={show}>Show {ids.length === 1 ? 'it' : 'them'}</Button>
    </div>
  );
}

/** What a banner hidden from its right-click menu leaves in its place: its name, when it's back, Unhide (same menu). */
function QuickHideNote({ id, until }: { id: string; until: number }) {
  const rt = useRuntime();
  const b = useKnownBanners().find((x) => x.id === id);
  const at = new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="fx-banner-snoozed fx-row" data-fx-ctx-target={BANNER_CTX_TARGET} data-fx-ctx-payload={id} data-fx-banner-id={id}>
      <Icon name="clock" />
      <span className="fx-muted">{b ? bannerLabel(b) : bannerLabel({ id })} hidden until {at}</span>
      <Button size="sm" tone="quiet" onClick={() => setBannerHide(rt, id, false)}>Unhide</Button>
    </div>
  );
}

/* ---------------- the banner a page was asked to show; each banner's own settings ---------------- */

let wantTab = '';
const wantSubs = new Set<() => void>();
function setWantTab(id: string): void { wantTab = id; wantSubs.forEach((f) => f()); }
/** Show this banner's tab wherever Banner settings is open (a settings page asked for a banner plugin's own tab). */
export function askBannerTab(rt: AxfRuntime, idOrSettingsTab: string): void {
  const b = knownBanners(rt).find((x) => x.id === idOrSettingsTab) ?? knownBanners(rt).find((x) => x.settingsTab === idOrSettingsTab);
  if (b) setWantTab(b.id);
}
function useWantTab(): string {
  return useSyncExternalStore((f) => { wantSubs.add(f); return () => { wantSubs.delete(f); }; }, () => wantTab, () => wantTab);
}

/**
 * Renders a settings tab's own content (its panels and groups) inside Banner settings, so each banner's tab holds its
 * plugin's settings too: one interface for every banner (Brett, Oct 22 2026). The settings library installs it.
 */
let ownSettings: ((settingsTab: string) => ReactNode) | null = null;
export function setBannerOwnSettingsRenderer(fn: ((settingsTab: string) => ReactNode) | null): void { ownSettings = fn; }

/** Settings tabs that belong to a banner: shown inside Banner settings instead of on their own. */
export function bannerSettingsTabs(rt: AxfRuntime): Set<string> {
  return new Set(knownBanners(rt).map((b) => b.settingsTab).filter((t): t is string => !!t));
}

/* ---------------- the dialog: one tab per banner ---------------- */

const TONE_LABEL: Record<BannerTone, string> = { own: 'Its own colour', accent: 'Accent', info: 'Info (blue)', success: 'Success (green)', warning: 'Warning (amber)', danger: 'Danger (red)', neutral: 'Neutral (grey)' };
const WORK_ANIM_LABEL: Record<BannerWorkAnim, string> = { spin: 'Spin', pulse: 'Pulse', bounce: 'Bounce', blink: 'Blink', off: 'Still (no animation)' };
const AUTO_HIDE = [0, 10, 30, 60, 300, 900];
const autoHideLabel = (s: number) => (s === 0 ? 'Never' : s < 60 ? `After ${s} s with nothing new` : `After ${s / 60} min with nothing new`);

/** Every banner's settings, one tab each: its look, its behaviour and its plugin's own settings. Dialog, settings tab or page. */
export function BannerSettingsPanel({ initial }: { initial?: string }) {
  const rt = useRuntime();
  useAxfState();
  useBannerPrefsTick();
  const hide = useBannerHideTick();
  const list = useKnownBanners();
  const asked = useWantTab();
  const [tab, setTab] = useState(() => (initial && list.some((b) => b.id === initial) ? initial : list[0]?.id ?? ''));
  useEffect(() => { if (asked && list.some((b) => b.id === asked)) setTab(asked); }, [asked]);
  // the list fills in after the plugins load (a page opened straight on Banners)
  useEffect(() => { if (!list.some((b) => b.id === tab) && list[0]) setTab(initial && list.some((b) => b.id === initial) ? initial : list[0].id); }, [list.length]);
  const b = list.find((x) => x.id === tab);
  if (!list.length) return <p className="fx-muted">This app has no banners.</p>;
  const p = bannerPrefs(rt, tab);
  const set = (patch: Partial<BannerPrefs>) => setBannerPrefs(rt, tab, patch);
  const shownOrder = [...list].map((x) => ({ id: x.id, order: bannerPrefs(rt, x.id).order ?? x.order ?? 100 })).sort((x, y) => x.order - y.order);
  const at = shownOrder.findIndex((x) => x.id === tab);
  const move = (d: -1 | 1) => {
    const other = shownOrder[at + d];
    if (!other) return;
    setBannerPrefs(rt, tab, { order: other.order + d * 0.01 });
  };
  return (
    <div className="fx-banner-settings">
      <div className="fx-banner-settings__tabs" role="tablist" aria-label="Banners">
        {list.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} className={`fx-banner-settings__tab${x.id === tab ? ' is-on' : ''}`} onClick={() => setTab(x.id)}>
            <Icon name={x.icon ?? 'bell'} size={14} />{bannerLabel(x)}
          </button>
        ))}
      </div>
      {b && (
        <div className="fx-stack">
          <Section title="Hide">
            <HideControls id={b.id} label={bannerLabel(b)} list={list} hide={hide} />
          </Section>
          <Section title="Look">
            <SelectField label="Colour" value={p.tone} options={TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))} onChange={(v) => set({ tone: v as BannerTone })} />
            <SelectField label="Density" value={p.density} options={DENSITIES.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) }))} onChange={(v) => set({ density: v as BannerDensity })} />
            <Switch label="Show its icon" checked={p.icon} onChange={(v) => set({ icon: v })} />
            <SelectField label="Icon while working" value={p.workIcon} options={[{ value: '', label: `Its own (${b.workIcon ?? 'refresh'})` }, ...BANNER_WORK_ICONS.map((i) => ({ value: i, label: i[0]!.toUpperCase() + i.slice(1) }))]} onChange={(v) => set({ workIcon: v })} />
            <SelectField label="Working animation" value={p.workAnim} options={[{ value: '', label: `Its own (${WORK_ANIM_LABEL[b.workAnim ?? 'spin']})` }, ...WORK_ANIMS.map((a) => ({ value: a, label: WORK_ANIM_LABEL[a] }))]} onChange={(v) => set({ workAnim: v as BannerWorkAnim | '' })} />
            <SelectField label="Maximum height" value={String(p.maxRows)} options={[0, 4, 6, 8, 12, 18].map((n) => ({ value: String(n), label: n === 0 ? 'Its own' : `${n} rows (scrolls past that)` }))} onChange={(v) => set({ maxRows: Number(v) })} />
          </Section>
          <Section title="Behaviour">
            <SelectField label="When it appears" value={p.launch} options={[{ value: 'expanded', label: 'Open, with its list' }, { value: 'minimized', label: 'Minimized to one line' }]} onChange={(v) => set({ launch: v === 'minimized' ? 'minimized' : 'expanded' })} />
            <SelectField label="Hide itself" value={String(p.autoHide)} options={AUTO_HIDE.map((s) => ({ value: String(s), label: autoHideLabel(s) }))} onChange={(v) => set({ autoHide: Number(v) })} />
            <div className="fx-row fx-row--wrap">
              <span className="fx-grow">Place among the banners: {at + 1} of {shownOrder.length}</span>
              <Button tone="ghost" icon="chevron-up" disabled={at <= 0} onClick={() => move(-1)}>Up</Button>
              <Button tone="ghost" icon="chevron-down" disabled={at >= shownOrder.length - 1} onClick={() => move(1)}>Down</Button>
            </div>
            <Switch label="Hide it inside a host app (Patches)" checked={p.hideInHost} onChange={(v) => set({ hideInHost: v })} />
          </Section>
          {b.settingsTab && ownSettings && (
            <Section title={`${bannerLabel(b)} settings`}>{ownSettings(b.settingsTab)}</Section>
          )}
          <div className="fx-row fx-row--wrap">
            <Button tone="ghost" icon="refresh" onClick={() => resetBannerPrefs(rt, tab)}>Look and behaviour back to defaults</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hide, Hide all banners (indented under it, tooltip = every banner it hides) and the timer (a tick box enabling two
 * digits of minutes). The same state wherever it is shown; the last switch touched wins.
 */
function HideControls({ id, label, list, hide }: { id: string; label: string; list: BannerDef[]; hide: BannerHideState }) {
  const rt = useRuntime();
  const now = Date.now();
  const ids = list.map((x) => x.id);
  const all = allBannersHidden(hide, ids, now);
  const names = list.map(bannerLabel).join(', ');
  const [text, setText] = useState(String(hide.timer.minutes));
  useEffect(() => { setText(String(hide.timer.minutes)); }, [hide.timer.minutes]);
  const commit = () => { const m = minutesFrom(text); if (m !== null && m !== hide.timer.minutes) setBannerHideTimer(rt, { minutes: m }); else setText(String(hide.timer.minutes)); };
  return (
    <>
      <Switch label={`Hide the ${label} banner`} checked={bannerHidden(hide, id, now)} onChange={(v) => setBannerHide(rt, id, v)} hint="It keeps working and logging its activity (terminal, banners); it just isn't shown." />
      <div className="fx-banner-settings__indent">
        <Switch label="Hide all banners" checked={all} onChange={(v) => setAllBannersHide(rt, v)} title={`Hides: ${names}`} hint={`${list.length} banner${list.length === 1 ? '' : 's'}: ${names}`} />
      </div>
      <div className="fx-banner-settings__timer">
        <Checkbox label="Hide for" checked={hide.timer.on} onChange={(v) => setBannerHideTimer(rt, { on: v, minutes: minutesFrom(text) ?? TIMER_DEFAULT })} />
        <input
          className="fx-input fx-banner-settings__minutes" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2}
          aria-label="Minutes" value={text} disabled={!hide.timer.on}
          onChange={(e) => setText(minutesInput(e.target.value))} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        />
        <span>minutes, then show again</span>
      </div>
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="eye" disabled={!anyBannerHide(hide, now)} onClick={() => showAllBannersNow(rt)} title={`Shows: ${names}`}>Show all banners and reset timers</Button>
      </div>
    </>
  );
}

/** The page a host shows on its own (embed@1 page `banners`) and the app's own Banners view. */
export const BANNERS_VIEW = 'banners';

export const bannerSettingsDialog: DialogMap = {
  [BANNER_SETTINGS_DIALOG]: { title: 'Banner settings', icon: 'bell', searchable: false, render: (props) => <BannerSettingsPanel initial={typeof props.id === 'string' ? props.id : undefined} /> },
};

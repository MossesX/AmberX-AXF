/*
 * Banner settings (Brett, Oct 22 2026): "right clicking on any banner and selecting Banner settings opens a settings
 * interface with tabs for all installed banner plugins; every banner has its own settings for its look and behaviour."
 *
 * Every banner a library contributes (AxfWebLibrary.banners) is wrapped in a frame that applies the person's choices
 * for it, the same for every banner, whatever plugin drew it:
 *   look      tone (accent / info / success / warning / danger / neutral, or the banner's own), density, icon, max height
 *   behaviour shown or not, launches expanded or minimized, hides itself after N seconds with nothing new, its place
 *             among the banners, hidden inside a host app (embed@1)
 * The frame is a context-menu target (`axf-banner`, payload = banner id): right-click / long-press → Banner settings opens
 * dialog `axf.banners.settings` on that banner's tab. The banner's own settings (its plugin's settings tab) are a button
 * away on the same tab. Choices are one setting, `axf.banners.prefs` ({ <banner id>: prefs }), per browser like any setting.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../core';
import type { BannerDef, SlotDef } from '../library';
import type { DialogMap } from './Overlays';
import { Button } from './Controls';
import { Section, SelectField, Switch } from './Forms';
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
}
export const BANNER_PREFS_KEY = 'axf.banners.prefs';
export const BANNER_SETTINGS_DIALOG = 'axf.banners.settings';
export const BANNER_CTX_TARGET = 'axf-banner';
export const DEFAULT_BANNER_PREFS: BannerPrefs = { tone: 'own', density: 'regular', icon: true, maxRows: 0, show: true, launch: 'expanded', autoHide: 0, order: null, hideInHost: false };
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

/* ---------------- the banners an app has (for the dialog's tabs) ---------------- */

const known = new WeakMap<AxfRuntime, BannerDef[]>();
const installed = new WeakSet<AxfRuntime>();

/** The banners every app has registered (all of them, including ones not on this page, e.g. inside a host). */
export function knownBanners(rt: AxfRuntime): BannerDef[] { return known.get(rt) ?? []; }

export const bannerLabel = (b: Pick<BannerDef, 'id' | 'label'>) => b.label ?? b.id.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function install(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  rt.actions.register('banners.settings', ([id], ctx) => {
    const pick = id || (typeof ctx?.payload === 'string' ? ctx.payload : '');
    rt.openDialog(BANNER_SETTINGS_DIALOG, pick ? { id: pick } : {});
  }, { label: 'Banner settings' });
  rt.addContextItems({ id: 'axf.banners.ctx', module: 'axf', target: BANNER_CTX_TARGET, order: 1, items: [{ id: 'axf-banner-settings', label: 'Banner settings', icon: 'settings', action: 'banners.settings' }] });
}

/**
 * The slot entries for app.frame.banners: every banner wrapped in its frame, filtered (hidden, hidden inside a host) and
 * ordered by the person's choices. `all` is every banner the app has (the dialog lists them), `shown` the ones this page
 * draws (default: all).
 */
export function bannerSlotDefs(rt: AxfRuntime, all: BannerDef[], shown: BannerDef[] = all): SlotDef[] {
  install(rt);
  known.set(rt, all);
  return shown
    .map((b) => ({ b, p: bannerPrefs(rt, b.id) }))
    .filter(({ p }) => p.show && !(p.hideInHost && rt.embedded))
    .map(({ b, p }) => ({ id: b.id, order: p.order ?? b.order, render: () => <BannerFrame id={b.id}>{b.render()}</BannerFrame> }))
    .sort((x, y) => (x.order ?? 100) - (y.order ?? 100));
}

/* ---------------- the frame around each banner ---------------- */

const LaunchCtx = createContext<'expanded' | 'minimized'>('expanded');

/** For a banner that can fold to one line: whether it starts open, as its Banner settings say (default open). */
export function useBannerLaunchOpen(): [boolean, (v: boolean) => void] {
  const launch = useContext(LaunchCtx);
  return useState(launch === 'expanded');
}

function BannerFrame({ id, children }: { id: string; children: ReactNode }) {
  const rt = useRuntime();
  useBannerPrefsTick();
  const p = bannerPrefs(rt, id);
  const ref = useRef<HTMLDivElement>(null);
  const [asleep, setAsleep] = useState(false);
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
  return (
    <div
      ref={ref}
      className="fx-banner-frame"
      hidden={asleep}
      data-fx-ctx-target={BANNER_CTX_TARGET}
      data-fx-ctx-payload={id}
      data-fx-banner-id={id}
      data-tone={p.tone === 'own' ? undefined : p.tone}
      data-density={p.density === 'regular' ? undefined : p.density}
      data-icon={p.icon ? undefined : 'off'}
      style={p.maxRows ? { maxHeight: `calc(var(--fx-row-h) * ${p.maxRows})`, overflow: 'auto' } : undefined}
    >
      <LaunchCtx.Provider value={p.launch}>{children}</LaunchCtx.Provider>
    </div>
  );
}

/* ---------------- the dialog: one tab per banner ---------------- */

const TONE_LABEL: Record<BannerTone, string> = { own: 'Its own colour', accent: 'Accent', info: 'Info (blue)', success: 'Success (green)', warning: 'Warning (amber)', danger: 'Danger (red)', neutral: 'Neutral (grey)' };
const AUTO_HIDE = [0, 10, 30, 60, 300, 900];
const autoHideLabel = (s: number) => (s === 0 ? 'Never' : s < 60 ? `After ${s} s with nothing new` : `After ${s / 60} min with nothing new`);

function BannerSettingsPanel({ initial }: { initial?: string }) {
  const rt = useRuntime();
  useAxfState();
  useBannerPrefsTick();
  const list = knownBanners(rt);
  const [tab, setTab] = useState(() => (initial && list.some((b) => b.id === initial) ? initial : list[0]?.id ?? ''));
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
          <Section title="Look">
            <SelectField label="Colour" value={p.tone} options={TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))} onChange={(v) => set({ tone: v as BannerTone })} />
            <SelectField label="Density" value={p.density} options={DENSITIES.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) }))} onChange={(v) => set({ density: v as BannerDensity })} />
            <Switch label="Show its icon" checked={p.icon} onChange={(v) => set({ icon: v })} />
            <SelectField label="Maximum height" value={String(p.maxRows)} options={[0, 4, 6, 8, 12, 18].map((n) => ({ value: String(n), label: n === 0 ? 'Its own' : `${n} rows (scrolls past that)` }))} onChange={(v) => set({ maxRows: Number(v) })} />
          </Section>
          <Section title="Behaviour">
            <Switch label="Show this banner" checked={p.show} onChange={(v) => set({ show: v })} hint="Off hides it on this device; it still works everywhere else." />
            <SelectField label="When it appears" value={p.launch} options={[{ value: 'expanded', label: 'Open, with its list' }, { value: 'minimized', label: 'Minimized to one line' }]} onChange={(v) => set({ launch: v === 'minimized' ? 'minimized' : 'expanded' })} />
            <SelectField label="Hide itself" value={String(p.autoHide)} options={AUTO_HIDE.map((s) => ({ value: String(s), label: autoHideLabel(s) }))} onChange={(v) => set({ autoHide: Number(v) })} />
            <div className="fx-row fx-row--wrap">
              <span className="fx-grow">Place among the banners: {at + 1} of {shownOrder.length}</span>
              <Button tone="ghost" icon="chevron-up" disabled={at <= 0} onClick={() => move(-1)}>Up</Button>
              <Button tone="ghost" icon="chevron-down" disabled={at >= shownOrder.length - 1} onClick={() => move(1)}>Down</Button>
            </div>
            <Switch label="Hide it inside a host app (Patches)" checked={p.hideInHost} onChange={(v) => set({ hideInHost: v })} />
          </Section>
          <div className="fx-row fx-row--wrap">
            {b.settingsTab && <Button icon="settings" onClick={() => { rt.closeDialog(); rt.dispatch(`settings.open:${b.settingsTab}`); }}>{bannerLabel(b)}’s own settings</Button>}
            <Button tone="ghost" icon="refresh" onClick={() => resetBannerPrefs(rt, tab)}>Back to its defaults</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export const bannerSettingsDialog: DialogMap = {
  [BANNER_SETTINGS_DIALOG]: { title: 'Banner settings', icon: 'bell', searchable: false, render: (props) => <BannerSettingsPanel initial={typeof props.id === 'string' ? props.id : undefined} /> },
};

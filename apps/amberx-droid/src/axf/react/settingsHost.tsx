/*
 * Settings placement, React side (settings-placement@1, engines/settingsplacement.ts).
 *
 *  - <SettingsHost owner=…>: a plugin wraps its UI in it; its settings can then open inside it (slide-out pane, drop-down,
 *    tab, split view, inline section), drawn with the picked look and animation. Several mounted hosts of one plugin
 *    (two Terminal windows): the one holding focus wins, else the one used last.
 *  - <SettingsPageSurfaces>: mounted once on the page (the settings library puts it in slot app.frame.cover); draws the
 *    pop-up dialog and the fallback pane over the page.
 *  - <SettingsPlacementPicker owner=…>: "Open my settings in…": placement, mode, look, animation and a live preview.
 *
 * The settings library supplies what goes inside (`setSettingsSurfaceContent`), so this file never imports a library.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRuntime } from './AxfProvider';
import { Button, IconButton, Segmented } from './components/Controls';
import { Note, SelectField, Switch } from './components/Forms';
import { Icon } from './components/Icon';
import {
  ANIMATIONS, ANIMATION_LABELS, DEFAULT_LOOKS, EDGES, EASINGS, FALLBACK_LABELS, INSIDE_MODES, LEVELS, MODE_LABELS, POSITIONS, SETTINGS_PLACEMENT_DEFAULT_KEY, SIZES, SPEEDS,
  describePick, effectivePick, resolveSettingsOpen, encodePick, hostModes, lookKeyOf, lookStyle, normalizeLook, normalizePick, placementChoices, settingsPlacementKey,
  type HostInfo, type InsideMode, type LookKey, type SettingsLook, type SettingsPlacementPick, type SettingsRoute,
} from '../core/engines/settingsplacement';
import type { AxfRuntime } from '../core/runtime';

/* ---------------- store: mounted hosts + open surfaces ---------------- */

interface HostRec { id: string; owner: string; modes: InsideMode[]; el: () => HTMLElement | null; usedAt: number }
export interface SettingsSurface { key: string; owner: string; tab: string; route: Exclude<SettingsRoute, { via: 'main' } | { via: 'window' }>; hostId?: string; at: number }

const hosts = new Map<string, HostRec>();
let surfaces: SettingsSurface[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const f of listeners) f(); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const getSurfaces = () => surfaces;

let content: (tab: string, close: () => void) => ReactNode = (tab) => <p className="fx-muted">{tab}</p>;
/** What a surface shows: the settings library renders the tab (its name, level toolbar, panels and groups). */
export function setSettingsSurfaceContent(render: (tab: string, close: () => void) => ReactNode) { content = render; }

/** The narrow-screen rule for hosts: split and drop-down don't fit under this width (or on a phone-sized page). */
const COMPACT_SHARE = 0.5;
const isCompact = (el: HTMLElement | null) => {
  const w = el?.getBoundingClientRect().width ?? 0;
  // the layout asset's viewport cut-offs, stamped on the root by the runtime (no breakpoint of our own)
  const phone = typeof document !== 'undefined' && !!document.documentElement.matches?.(':where([data-fx-tiny],[data-fx-small])');
  return phone || (w > 0 && typeof innerWidth === 'number' && w < innerWidth * COMPACT_SHARE && w < 560);
};

/** The plugin's host that should take its settings now: the one holding focus, else the one used last. */
export function findSettingsHost(owner: string): { id: string; info: HostInfo } | null {
  const mine = [...hosts.values()].filter((h) => h.owner === owner && h.el()?.isConnected);
  if (!mine.length) return null;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const h = mine.find((x) => active && x.el()?.contains(active)) ?? mine.sort((a, b) => b.usedAt - a.usedAt)[0]!;
  return { id: h.id, info: { modes: h.modes, compact: isCompact(h.el()) } };
}

export function openSettingsSurface(s: Omit<SettingsSurface, 'key' | 'at'>): string {
  const key = `${s.owner}:${s.tab}`;
  surfaces = [...surfaces.filter((x) => x.key !== key && !(s.hostId && x.hostId === s.hostId)), { ...s, key, at: Date.now() }];
  emit();
  return key;
}
export function closeSettingsSurface(key?: string) {
  const next = key ? surfaces.filter((x) => x.key !== key) : [];
  if (next.length !== surfaces.length) { surfaces = next; emit(); }
}
/** Is a surface for this tab open (the gear toggles it)? */
export const settingsSurfaceOpen = (owner: string, tab: string) => surfaces.some((x) => x.key === `${owner}:${tab}`);

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The pick in force for `owner` (its own, else the app default, else the legacy "Opens in = dialog" rule). */
export function settingsPickOf(rt: AxfRuntime, owner: string): SettingsPlacementPick {
  return effectivePick(rt.settings.get(settingsPlacementKey(owner)), rt.settings.get(SETTINGS_PLACEMENT_DEFAULT_KEY), rt.placementOf(owner), rt.libraries.find((l) => l.id === owner)?.settingsPlacement);
}

/** Where `owner`'s settings open right now (engine + what is mounted). */
export function routeSettings(rt: AxfRuntime, owner: string, pick = settingsPickOf(rt, owner)): { route: SettingsRoute; hostId?: string } {
  const host = findSettingsHost(owner);
  const hostable = hostModes(rt.libraries.find((l) => l.id === owner)?.settingsHost).length > 0 || !!host;
  return { route: resolveRoute(pick, host?.info ?? null, hostable), ...(host ? { hostId: host.id } : {}) };
}
const resolveRoute = (pick: SettingsPlacementPick, host: HostInfo | null, hostable: boolean) => resolveSettingsOpen(pick, { host, hostable, reducedMotion: reducedMotion() });

/* ---------------- the panel a surface draws ---------------- */

function SurfacePanel({ s, className }: { s: SettingsSurface; className: string }) {
  const rt = useRuntime();
  const tab = rt.settings.getTab(s.tab);
  const close = () => closeSettingsSurface(s.key);
  const { vars, attrs } = lookStyle(s.route.look);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const fallback = 'fallback' in s.route ? s.route.fallback : undefined;
  return (
    <section className={`axf-sp ${className}`} style={vars} {...attrs} role={s.route.via === 'dialog' ? 'dialog' : 'complementary'} aria-modal={s.route.via === 'dialog' ? true : undefined} aria-labelledby={titleId} data-axf-sp-owner={s.owner} data-axf-sp-tab={s.tab}>
      <header className="axf-sp__head">
        <Icon name={tab?.icon ?? 'settings'} />
        <strong id={titleId} className="fx-grow">{tab?.label ?? s.tab} settings</strong>
        <IconButton icon="layout" label="Where these settings open" onClick={() => rt.dispatch(`settings.placement:${s.owner}`)} />
        <IconButton icon="external-link" label="Open in the main Settings page" onClick={() => { close(); rt.dispatch(`settings.open-main:${s.tab}`); }} />
        <IconButton icon="x" label="Close" onClick={close} />
      </header>
      {fallback && <p className="fx-muted axf-sp__why">Opened as a pane: {FALLBACK_LABELS[fallback]}.</p>}
      <div className="axf-sp__body">{content(s.tab, close)}</div>
    </section>
  );
}

/* ---------------- <SettingsHost> ---------------- */

export interface SettingsHostProps {
  /** the plugin / library id (its settings tabs' module) */
  owner: string;
  /** in-plugin modes this host offers; default all (pane is always one) */
  modes?: InsideMode[];
  /** label of the plugin's own side when the settings open as a tab */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Wrap a plugin's UI in it so its settings can open inside the plugin. */
export function SettingsHost({ owner, modes, label = 'Back', className, children }: SettingsHostProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => (modes?.length ? hostModes(modes) : [...INSIDE_MODES]), [modes?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    hosts.set(id, { id, owner, modes: list, el: () => ref.current, usedAt: Date.now() });
    return () => { hosts.delete(id); const mine = surfaces.filter((s) => s.hostId === id); if (mine.length) { surfaces = surfaces.filter((s) => s.hostId !== id); emit(); } };
  }, [id, owner, list]);
  const all = useSyncExternalStore(subscribe, getSurfaces, getSurfaces);
  const s = all.find((x) => x.hostId === id && x.route.via === 'host');
  const [showing, setShowing] = useState<'plugin' | 'settings'>('settings');
  useEffect(() => { if (s) setShowing('settings'); }, [s?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = s && s.route.via === 'host' ? s.route.mode : undefined;
  const look = s?.route.look;
  const { vars, attrs } = look ? lookStyle(look) : { vars: {}, attrs: {} };
  const touch = () => { const h = hosts.get(id); if (h) h.usedAt = Date.now(); };
  const panel = s ? <SurfacePanel s={s} className={`axf-sp--${mode}`} /> : null;
  return (
    <div ref={ref} className={`axf-sphost ${className ?? ''}`} data-axf-sphost={owner} data-axf-sphost-open={mode} style={vars} {...attrs} onPointerDownCapture={touch} onFocusCapture={touch}>
      {mode === 'tab' && (
        <div className="axf-sphost__tabs">
          <Segmented size="sm" label="Show" value={showing} onChange={setShowing} options={[{ value: 'plugin', label, icon: 'arrow-left' }, { value: 'settings', label: 'Settings', icon: 'settings' }]} />
        </div>
      )}
      {mode === 'inline' && panel}
      <div className="axf-sphost__content" hidden={mode === 'tab' && showing === 'settings'}>{children}</div>
      {mode === 'pane' && look?.dim && <div className="axf-sp-scrim" onClick={() => s && closeSettingsSurface(s.key)} />}
      {(mode === 'pane' || mode === 'split' || mode === 'dropdown') && panel}
      {mode === 'tab' && showing === 'settings' && panel}
    </div>
  );
}

/* ---------------- page-level surfaces (dialog, fallback pane) ---------------- */

export function SettingsPageSurfaces() {
  const all = useSyncExternalStore(subscribe, getSurfaces, getSurfaces);
  const page = all.filter((s) => s.route.via === 'dialog' || s.route.via === 'page-pane');
  if (!page.length) return null;
  return (
    <>
      {page.map((s) => {
        const { vars, attrs } = lookStyle(s.route.look);
        return (
          <div key={s.key} className="axf-sp-layer" data-axf-sp-via={s.route.via} style={vars} {...attrs}>
            {s.route.look.dim || s.route.via === 'dialog' ? <div className="axf-sp-scrim" onClick={() => closeSettingsSurface(s.key)} /> : null}
            <SurfacePanel s={s} className={s.route.via === 'dialog' ? 'axf-sp--dialog' : 'axf-sp--pane'} />
          </div>
        );
      })}
    </>
  );
}

/* ---------------- picker ---------------- */

const label = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const opts = (list: readonly string[], names?: Record<string, string>) => list.map((v) => ({ value: v, label: names?.[v] ?? label(v) }));

/** Read and write one owner's pick (or the app default with owner = null), live. */
export function useSettingsPick(owner: string | null): [SettingsPlacementPick, (p: SettingsPlacementPick) => void, boolean] {
  const rt = useRuntime();
  const key = owner ? settingsPlacementKey(owner) : SETTINGS_PLACEMENT_DEFAULT_KEY;
  const [, tick] = useState(0);
  useEffect(() => rt.settings.onChange(key, () => tick((n) => n + 1)), [rt, key]);
  const own = rt.settings.get(key);
  const pick = owner ? settingsPickOf(rt, owner) : normalizePick(own);
  return [pick, (p) => rt.settings.set(key, encodePick(p)), own != null && own !== ''];
}

/** "Open my settings in…": placement, how (inside), look + animation, live preview, Try it. */
export function SettingsPlacementPicker({ owner, compact = false }: { owner: string | null; compact?: boolean }) {
  const rt = useRuntime();
  const [pick, setPick, own] = useSettingsPick(owner);
  const [more, setMore] = useState(!compact);
  const lib = owner ? rt.libraries.find((l) => l.id === owner) : undefined;
  const modes = owner ? hostModes(lib?.settingsHost) : [...INSIDE_MODES];
  const lk: LookKey | null = lookKeyOf(pick.placement, pick.mode);
  const look = lk ? normalizeLook(pick.looks[lk], lk) : null;
  const setLook = (patch: Partial<SettingsLook>) => lk && look && setPick({ ...pick, looks: { ...pick.looks, [lk]: { ...look, ...patch } } });
  const tab = owner ? lib?.ui?.settingsTabs[0]?.id : undefined;
  const inside = pick.placement === 'inside';
  const noHost = owner && inside && !modes.length;
  const notOffered = owner && inside && modes.length > 0 && !modes.includes(pick.mode);
  return (
    <div className="fx-stack axf-sp-picker" data-axf-sp-picker={owner ?? 'default'}>
      <SelectField label="Open my settings in" value={pick.placement} options={placementChoices()} onChange={(v) => setPick({ ...pick, placement: v as SettingsPlacementPick['placement'] })}
        hint={owner ? (own ? describePick(pick) : `Not set: ${describePick(pick).toLowerCase()} (the default). They always stay in the main Settings too.`) : 'For every plugin nobody has picked for yet.'} />
      {inside && (
        <SelectField label="How, inside it" value={pick.mode} options={INSIDE_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] + (owner && modes.length && !modes.includes(m) ? ' (opens as a pane here)' : '') }))} onChange={(v) => setPick({ ...pick, mode: v as InsideMode })} />
      )}
      {noHost && <Note tone="info">This plugin has no room of its own for settings yet, so they slide out as a pane over the page.</Note>}
      {notOffered && <Note tone="info">This plugin doesn't offer a {MODE_LABELS[pick.mode].toLowerCase()}, so they slide out as a pane over it.</Note>}
      {look && lk && (
        <>
          <div className="fx-row fx-row--wrap">
            <Button tone="ghost" size="sm" icon={more ? 'chevron-up' : 'chevron-down'} onClick={() => setMore(!more)}>{more ? 'Hide look and animation' : 'Look and animation'}</Button>
            {tab && <Button tone="ghost" size="sm" icon="play" onClick={() => rt.dispatch(`settings.open:${tab}`)}>Try it</Button>}
            <Button tone="ghost" size="sm" icon="undo" onClick={() => setPick({ ...pick, looks: { ...pick.looks, [lk]: DEFAULT_LOOKS[lk] } })}>Reset look</Button>
          </div>
          {more && (
            <div className="axf-sp-picker__look">
              <div className="axf-sp-picker__grid">
                <SelectField label="Animation" value={look.animation} options={opts(ANIMATIONS, ANIMATION_LABELS)} onChange={(v) => setLook({ animation: v as SettingsLook['animation'] })} />
                <SelectField label="Speed" value={look.speed} options={opts(SPEEDS)} onChange={(v) => setLook({ speed: v as SettingsLook['speed'] })} />
                <SelectField label="Easing" value={look.easing} options={opts(EASINGS, { theme: 'Theme' })} onChange={(v) => setLook({ easing: v as SettingsLook['easing'] })} />
                {(pick.placement === 'inside' && (pick.mode === 'pane' || pick.mode === 'split')) || look.animation === 'slide' || look.animation === 'push'
                  ? <SelectField label={pick.mode === 'pane' || pick.mode === 'split' ? 'From the' : 'Slides in from the'} value={look.edge} options={opts(EDGES)} onChange={(v) => setLook({ edge: v as SettingsLook['edge'] })} /> : null}
                <SelectField label="Size" value={look.size} options={opts(SIZES)} onChange={(v) => setLook({ size: v as SettingsLook['size'] })} />
                {(pick.placement === 'dialog' || (inside && pick.mode === 'dropdown')) && <SelectField label="Position" value={look.position} options={opts(POSITIONS)} onChange={(v) => setLook({ position: v as SettingsLook['position'] })} />}
                <SelectField label="Corners" value={look.radius} options={opts(LEVELS, { sm: 'Small', md: 'Medium', lg: 'Large' })} onChange={(v) => setLook({ radius: v as SettingsLook['radius'] })} />
                <SelectField label="Shadow" value={look.shadow} options={opts(LEVELS, { sm: 'Small', md: 'Medium', lg: 'Large' })} onChange={(v) => setLook({ shadow: v as SettingsLook['shadow'] })} />
              </div>
              <div className="fx-row fx-row--wrap">
                <Switch label="Dim behind it" checked={look.dim} onChange={(v) => setLook({ dim: v })} />
                <Switch label="Blur behind it" checked={look.blur} onChange={(v) => setLook({ blur: v })} />
              </div>
              <PlacementPreview pick={pick} look={look} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A small replaying sketch of the pick: the plugin as a box, the settings opening in it with the look's animation. */
function PlacementPreview({ pick, look }: { pick: SettingsPlacementPick; look: SettingsLook }) {
  const motion = reducedMotion() ? { ...look, animation: 'none' as const } : look;
  const { vars, attrs } = lookStyle(motion);
  const [n, setN] = useState(0);
  const sig = JSON.stringify([pick.placement, pick.mode, motion]);
  useEffect(() => { setN((x) => x + 1); }, [sig]);
  const kind = pick.placement === 'inside' ? pick.mode : pick.placement === 'dialog' ? 'dialog' : 'window';
  return (
    <div className="axf-sp-preview" aria-label="Preview" style={vars} {...attrs} data-axf-sp-kind={kind}>
      <div className="axf-sp-preview__host" key={n}>
        <span className="fx-muted axf-sp-preview__label"><Icon name="eye" /> Preview</span>
        {look.dim && kind !== 'split' && kind !== 'inline' && kind !== 'tab' && <div className="axf-sp-scrim" />}
        <div className={`axf-sp axf-sp--${kind === 'window' ? 'dialog' : kind} axf-sp-preview__panel`}><span className="axf-sp-preview__bar" /><span className="axf-sp-preview__bar" /><span className="axf-sp-preview__bar" /></div>
      </div>
      <IconButton icon="refresh" label="Play again" onClick={() => setN((x) => x + 1)} />
    </div>
  );
}

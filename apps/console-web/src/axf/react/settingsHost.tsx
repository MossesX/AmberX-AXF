/*
 * Settings placement, React side (settings-placement@1, engines/settingsplacement.ts).
 *
 *  - <SettingsHost owner=…>: a screen's (or a plugin's) room for its settings: wrap a UI in it and its settings can
 *    open inside it (inline section, slide-out pane, drop-down, tab, split view), drawn with the picked look and
 *    animation. AppShell wraps every screen in one (`owner = screenOwner(view)`), so any screen can host its settings;
 *    a plugin may add its own (the Terminal window). Several mounted hosts of one owner: the one holding focus wins,
 *    else the one used last.
 *  - <SettingsPageSurfaces>: mounted once on the page (the settings library puts it in slot app.frame.cover); draws the
 *    pop-up dialog, the side panel (left / right) and the bottom sheet over the page.
 *  - Surfaces animate out the way they came in: closing keeps the surface for one animation (`closing`), then drops it.
 *  - <SettingsPlacementPicker scope=…>: the full picker (placement, side, inside mode, look, animation, live preview).
 *  - <PopsUpInRow>: the one-line "Pops up in" row at the top of every settings interface (Brett, Nov 4 2026).
 *
 * The settings library supplies what goes inside (`setSettingsSurfaceContent`), so this file never imports a library.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRuntime } from './AxfProvider';
import { Button, IconButton, Segmented } from './components/Controls';
import { Note, SelectField, Switch } from './components/Forms';
import { Icon } from './components/Icon';
import {
  ANIMATIONS, ANIMATION_LABELS, CHOICE_LABELS, DEFAULT_LOOKS, EDGES, EASINGS, FALLBACK_LABELS, INSIDE_MODES, LEVELS, MODE_LABELS, PICK_SOURCE_LABELS, PLACEMENT_CHOICES, POSITIONS, SETTINGS_PLACEMENT_DEFAULT_KEY, SIZES, SPEEDS,
  applyChoice, choiceOf, describePick, encodePick, hasPlacement, hostModes, lookKeyOf, lookStyle, normalizeLook, normalizePick, pickFor, resolveSettingsOpen, screenPlacementKey, settingsPlacementKey,
  type HostInfo, type InsideMode, type LookKey, type PickSource, type PlacementChoice, type SettingsLook, type SettingsPlacementPick, type SettingsRoute,
} from '../core/engines/settingsplacement';
import type { AxfRuntime } from '../core/runtime';

/* ---------------- scopes ---------------- */

/** Which pick a picker edits: one screen's override, one plugin's own pick, or the app default. */
export type PlacementScope = { kind: 'screen'; view: string } | { kind: 'owner'; owner: string } | { kind: 'app' };

/** The host owner id for a screen (a view id). */
export const screenOwner = (view: string) => `view:${view}`;
export const isScreenOwner = (owner: string) => owner.startsWith('view:');

/** The settings key a scope edits. */
export const scopeKey = (s: PlacementScope): string => (s.kind === 'screen' ? screenPlacementKey(s.view) : s.kind === 'owner' ? settingsPlacementKey(s.owner) : SETTINGS_PLACEMENT_DEFAULT_KEY);
/** A scope as one string (`screen:<view>` | `owner:<id>` | `app`), for actions. */
export const scopeId = (s: PlacementScope): string => (s.kind === 'screen' ? `screen:${s.view}` : s.kind === 'owner' ? `owner:${s.owner}` : 'app');
export function parseScope(id: string | undefined | null): PlacementScope | null {
  if (!id || id === 'app' || id === 'default') return { kind: 'app' };
  if (id.startsWith('screen:')) return { kind: 'screen', view: id.slice(7) };
  if (id.startsWith('owner:')) return { kind: 'owner', owner: id.slice(6) };
  return null;
}

/** The settings a screen opens: its owning plugin's first settings tab, else the whole settings interface (no tab). */
export function settingsTargetOf(rt: AxfRuntime, view: string): { owner?: string; tab?: string } {
  const lib = rt.libraries.find((l) => l.ui?.views.some((v) => v.id === view));
  const tab = lib?.ui?.settingsTabs[0]?.id;
  return lib && tab ? { owner: lib.id, tab } : {};
}

/* ---------------- store: mounted hosts + open surfaces ---------------- */

interface HostRec { id: string; owner: string; modes: InsideMode[]; el: () => HTMLElement | null; usedAt: number }
export interface SettingsSurface {
  key: string;
  /** the plugin whose settings these are, or the screen's host owner */
  owner: string;
  /** the settings tab shown; absent = the whole settings interface */
  tab?: string;
  /** the screen it was opened from (its override applies) */
  screen?: string;
  route: Exclude<SettingsRoute, { via: 'page' } | { via: 'window' }>;
  hostId?: string;
  at: number;
  /** animating out; dropped after one animation (or at once with no animation) */
  closing?: boolean;
}

const hosts = new Map<string, HostRec>();
let surfaces: SettingsSurface[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const f of listeners) f(); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const getSurfaces = () => surfaces;

let content: (tab: string | undefined, close: () => void, surface: SettingsSurface) => ReactNode = (tab) => <p className="fx-muted">{tab ?? 'Settings'}</p>;
/** What a surface shows: the settings library renders the tab (or the whole interface when `tab` is absent). */
export function setSettingsSurfaceContent(render: (tab: string | undefined, close: () => void, surface: SettingsSurface) => ReactNode) { content = render; }

/** The narrow-screen rule for hosts: split and drop-down don't fit under this width (or on a phone-sized page). */
const COMPACT_SHARE = 0.5;
const isCompact = (el: HTMLElement | null) => {
  const w = el?.getBoundingClientRect().width ?? 0;
  // the layout asset's viewport cut-offs, stamped on the root by the runtime (no breakpoint of our own)
  const phone = typeof document !== 'undefined' && !!document.documentElement.matches?.(':where([data-fx-tiny],[data-fx-small])');
  return phone || (w > 0 && typeof innerWidth === 'number' && w < innerWidth * COMPACT_SHARE && w < 560);
};

/** The owner's host that should take its settings now: the one holding focus, else the one used last. */
export function findSettingsHost(owner: string): { id: string; info: HostInfo } | null {
  const mine = [...hosts.values()].filter((h) => h.owner === owner && h.el()?.isConnected);
  if (!mine.length) return null;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const h = mine.find((x) => active && x.el()?.contains(active)) ?? mine.sort((a, b) => b.usedAt - a.usedAt)[0]!;
  return { id: h.id, info: { modes: h.modes, compact: isCompact(h.el()) } };
}

export const surfaceKey = (owner: string, tab?: string) => `${owner}:${tab ?? '*'}`;

export function openSettingsSurface(s: Omit<SettingsSurface, 'key' | 'at'>): string {
  const key = surfaceKey(s.owner, s.tab);
  // one surface per key, one per host; a surface being closed is replaced at once
  surfaces = [...surfaces.filter((x) => x.key !== key && !(s.hostId && x.hostId === s.hostId)), { ...s, key, at: Date.now() }];
  emit();
  return key;
}
/** Start closing a surface (all of them with no key): it animates out, then `dropSettingsSurface` removes it. */
export function closeSettingsSurface(key?: string) {
  let changed = false;
  surfaces = surfaces.map((x) => ((!key || x.key === key) && !x.closing ? ((changed = true), { ...x, closing: true }) : x));
  if (changed) emit();
}
export function dropSettingsSurface(key: string) {
  const next = surfaces.filter((x) => x.key !== key);
  if (next.length !== surfaces.length) { surfaces = next; emit(); }
}
/** Is a surface for this owner / tab open (the gear toggles it)? */
export const settingsSurfaceOpen = (owner: string, tab?: string) => surfaces.some((x) => x.key === surfaceKey(owner, tab) && !x.closing);
/** Every open surface (for tests and the picker's "Try it"). */
export const openSurfaces = () => surfaces.filter((x) => !x.closing);

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- which pick is in force ---------------- */

/** The settings interface asset's own `opensIn` (settings-ui@1), if it says anything. */
const interfaceOpensIn = (rt: AxfRuntime): unknown => (rt.assetOrNull('settings')?.data as { opensIn?: unknown } | undefined)?.opensIn;
/** The app default: the saved setting, else the manifest's `settingsPlacement`. */
const appDefaultOf = (rt: AxfRuntime): unknown => { const v = rt.settings.get(SETTINGS_PLACEMENT_DEFAULT_KEY); return hasPlacement(v) ? v : rt.manifest.settingsPlacement; };

/**
 * The pick in force for an opening: the screen's override (when opened from a screen), the owner plugin's own pick, its
 * declared default, the settings interface's `opensIn`, the app default, the legacy "Opens in = dialog" rule, the page.
 */
export function settingsPickFor(rt: AxfRuntime, where: { owner?: string; screen?: string }): { pick: SettingsPlacementPick; from: PickSource } {
  const owner = where.owner && !isScreenOwner(where.owner) ? where.owner : undefined;
  const lib = owner ? rt.libraries.find((l) => l.id === owner) : undefined;
  return pickFor({
    screen: where.screen ? rt.settings.get(screenPlacementKey(where.screen)) : undefined,
    owner: owner ? rt.settings.get(settingsPlacementKey(owner)) : undefined,
    declared: lib?.settingsPlacement,
    interface: interfaceOpensIn(rt),
    appDefault: appDefaultOf(rt),
    legacyOpens: owner ? rt.placementOf(owner) : null,
  });
}
/** The pick in force for a plugin (no screen). Kept for callers of the first contract. */
export const settingsPickOf = (rt: AxfRuntime, owner: string): SettingsPlacementPick => settingsPickFor(rt, { owner: owner || undefined }).pick;

/** Where settings open right now for an owner / screen (engine + what is mounted). */
export function routeSettings(rt: AxfRuntime, where: { owner?: string; screen?: string }, pick = settingsPickFor(rt, where).pick): { route: SettingsRoute; hostId?: string; hostOwner?: string } {
  const owner = where.owner && !isScreenOwner(where.owner) ? where.owner : undefined;
  // the plugin's own host first (its window), else the screen's host
  const own = owner ? findSettingsHost(owner) : null;
  const screen = where.screen ? findSettingsHost(screenOwner(where.screen)) : null;
  const host = own ?? screen;
  const hostable = !!host || !!where.screen || (!!owner && hostModes(rt.libraries.find((l) => l.id === owner)?.settingsHost).length > 0);
  const route = resolveSettingsOpen(pick, { host: host?.info ?? null, hostable, reducedMotion: reducedMotion() });
  return { route, ...(host ? { hostId: host.id, hostOwner: own ? owner! : screenOwner(where.screen!) } : {}) };
}

/* ---------------- the panel a surface draws ---------------- */

/** Longest a closing surface is kept when no animation end arrives (the slowest speed × a generous theme motion). */
const CLOSE_FALLBACK_MS = 1200;

function SurfacePanel({ s, className }: { s: SettingsSurface; className: string }) {
  const rt = useRuntime();
  const tab = s.tab ? rt.settings.getTab(s.tab) : undefined;
  const close = () => closeSettingsSurface(s.key);
  const { vars, attrs } = lookStyle(s.route.look);
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !s.closing) close(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  // closing: drop after the exit animation (none / reduced motion = at once; a fallback timer in case no event arrives)
  useEffect(() => {
    if (!s.closing) return;
    const el = ref.current;
    const instant = s.route.look.animation === 'none' || s.route.look.speed === 'instant' || reducedMotion();
    if (instant || !el) { dropSettingsSurface(s.key); return; }
    const done = () => dropSettingsSurface(s.key);
    el.addEventListener('animationend', done, { once: true });
    const t = setTimeout(done, CLOSE_FALLBACK_MS);
    return () => { clearTimeout(t); el.removeEventListener('animationend', done); };
  }, [s.closing, s.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const fallback = 'fallback' in s.route ? s.route.fallback : undefined;
  const title = tab ? `${tab.label} settings` : `${rt.manifest.app.name} settings`;
  const scope: PlacementScope = s.screen ? { kind: 'screen', view: s.screen } : !isScreenOwner(s.owner) ? { kind: 'owner', owner: s.owner } : { kind: 'app' };
  return (
    <section ref={ref} className={`axf-sp ${className}${s.closing ? ' is-closing' : ''}`} style={vars} {...attrs} role={s.route.via === 'dialog' ? 'dialog' : 'complementary'} aria-modal={s.route.via === 'dialog' ? true : undefined} aria-labelledby={titleId} data-axf-sp-owner={s.owner} data-axf-sp-tab={s.tab ?? ''} data-axf-sp-closing={s.closing ? '' : undefined}>
      <header className="axf-sp__head">
        <Icon name={tab?.icon ?? 'settings'} />
        <strong id={titleId} className="fx-grow">{title}</strong>
        <IconButton icon="layout" label="Where these settings open" onClick={() => rt.dispatch(`settings.placement:${scopeId(scope)}`)} />
        <IconButton icon="external-link" label="Open on the full settings page" onClick={() => { close(); rt.dispatch(s.tab ? `settings.open-main:${s.tab}` : 'settings.open-main'); }} />
        <IconButton icon="x" label="Close" onClick={close} />
      </header>
      {fallback && <p className="fx-muted axf-sp__why">Opened here because {FALLBACK_LABELS[fallback]}.</p>}
      <div className="axf-sp__body">{content(s.tab, close, s)}</div>
    </section>
  );
}

/* ---------------- <SettingsHost> ---------------- */

export interface SettingsHostProps {
  /** the plugin / library id, or `screenOwner(view)` for a screen */
  owner: string;
  /** in-screen modes this host offers; default all (pane is always one) */
  modes?: InsideMode[];
  /** label of the host's own side when the settings open as a tab */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Wrap a UI in it so its settings can open inside it. */
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
  const open = s && !s.closing ? mode : undefined;
  return (
    <div ref={ref} className={`axf-sphost ${className ?? ''}`} data-axf-sphost={owner} data-axf-sphost-open={open} data-axf-sphost-compact={s && isCompact(ref.current) ? '' : undefined} style={vars} {...attrs} onPointerDownCapture={touch} onFocusCapture={touch}>
      {mode === 'tab' && (
        <div className="axf-sphost__tabs">
          <Segmented size="sm" label="Show" value={showing} onChange={setShowing} options={[{ value: 'plugin', label, icon: 'arrow-left' }, { value: 'settings', label: 'Settings', icon: 'settings' }]} />
        </div>
      )}
      {mode === 'inline' && panel}
      <div className="axf-sphost__content" hidden={mode === 'tab' && showing === 'settings' && !s?.closing}>{children}</div>
      {mode === 'pane' && look?.dim && <div className={`axf-sp-scrim${s?.closing ? ' is-closing' : ''}`} onClick={() => s && closeSettingsSurface(s.key)} />}
      {(mode === 'pane' || mode === 'split' || mode === 'dropdown') && panel}
      {mode === 'tab' && showing === 'settings' && panel}
    </div>
  );
}

/* ---------------- page-level surfaces (dialog, side panel, bottom sheet) ---------------- */

export function SettingsPageSurfaces() {
  const all = useSyncExternalStore(subscribe, getSurfaces, getSurfaces);
  const page = all.filter((s) => s.route.via === 'dialog' || s.route.via === 'panel' || s.route.via === 'sheet');
  if (!page.length) return null;
  return (
    <>
      {page.map((s) => {
        const { vars, attrs } = lookStyle(s.route.look);
        const cls = s.route.via === 'dialog' ? 'axf-sp--dialog' : s.route.via === 'sheet' ? 'axf-sp--pane axf-sp--sheet' : 'axf-sp--pane axf-sp--panel';
        return (
          <div key={s.key} className="axf-sp-layer" data-axf-sp-via={s.route.via} data-axf-sphost-compact={isCompact(null) ? '' : undefined} style={vars} {...attrs}>
            {s.route.look.dim || s.route.via === 'dialog' ? <div className={`axf-sp-scrim${s.closing ? ' is-closing' : ''}`} onClick={() => closeSettingsSurface(s.key)} /> : null}
            <SurfacePanel s={s} className={cls} />
          </div>
        );
      })}
    </>
  );
}

/* ---------------- picker ---------------- */

const label = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const opts = (list: readonly string[], names?: Record<string, string>) => list.map((v) => ({ value: v, label: names?.[v] ?? label(v) }));

/**
 * Read and write one scope's pick, live: [the pick in force there, set (null = forget the override), whether the scope
 * itself holds a pick, where the pick in force comes from].
 */
export function useSettingsPick(scope: PlacementScope): [SettingsPlacementPick, (p: SettingsPlacementPick | null) => void, boolean, PickSource] {
  const rt = useRuntime();
  const key = scopeKey(scope);
  const [, tick] = useState(0);
  useEffect(() => rt.settings.subscribe(() => tick((n) => n + 1)), [rt]);
  const own = rt.settings.get(key);
  const r = scope.kind === 'screen' ? settingsPickFor(rt, { screen: scope.view, ...settingsTargetOf(rt, scope.view) }) : scope.kind === 'owner' ? settingsPickFor(rt, { owner: scope.owner }) : pickFor({ appDefault: appDefaultOf(rt), interface: undefined });
  return [r.pick, (p) => rt.settings.set(key, p ? encodePick(p) : null), hasPlacement(own), r.from];
}

/** Choice options for selects: "Use the app default (…)" first for a screen or plugin scope, then every placement. */
export function choiceOptions(scope: PlacementScope, fallbackText?: string): { value: string; label: string }[] {
  return [...(scope.kind === 'app' ? [] : [{ value: 'default', label: `Use the app default${fallbackText ? ` (${fallbackText.toLowerCase()})` : ''}` }]), ...PLACEMENT_CHOICES.map((value) => ({ value, label: CHOICE_LABELS[value] }))];
}

/** "Open these settings in…": placement, side, inside mode, look + animation, live preview, Try it. */
export function SettingsPlacementPicker({ scope, compact = false }: { scope: PlacementScope; compact?: boolean }) {
  const rt = useRuntime();
  const [pick, setPick, own, from] = useSettingsPick(scope);
  const [more, setMore] = useState(!compact);
  const lib = scope.kind === 'owner' ? rt.libraries.find((l) => l.id === scope.owner) : undefined;
  const modes = scope.kind === 'owner' ? hostModes(lib?.settingsHost).length ? hostModes(lib?.settingsHost) : [...INSIDE_MODES] : [...INSIDE_MODES];
  const lk: LookKey | null = lookKeyOf(pick.placement, pick.mode);
  const look = lk ? normalizeLook(pick.looks[lk], lk) : null;
  const setLook = (patch: Partial<SettingsLook>) => lk && look && setPick({ ...pick, looks: { ...pick.looks, [lk]: { ...look, ...patch } } });
  const tryIt = scope.kind === 'owner' ? (lib?.ui?.settingsTabs[0]?.id ? `settings.open:${lib.ui.settingsTabs[0].id}` : null) : scope.kind === 'screen' ? `settings.open-for:${scope.view}` : 'settings.open';
  const inside = pick.placement === 'inside';
  const notOffered = scope.kind === 'owner' && inside && !modes.includes(pick.mode);
  const choice = own || scope.kind === 'app' ? choiceOf(pick) : 'default';
  const fallbackText = scope.kind === 'app' ? undefined : describePick(pickFor({ appDefault: appDefaultOf(rt), interface: interfaceOpensIn(rt) }).pick);
  return (
    <div className="fx-stack axf-sp-picker" data-axf-sp-picker={scopeId(scope)}>
      <SelectField label={scope.kind === 'app' ? 'Settings open in' : 'These settings open in'} value={choice} options={choiceOptions(scope, fallbackText)} onChange={(v) => setPick(v === 'default' ? null : applyChoice(v as PlacementChoice, pick))}
        hint={scope.kind === 'app' ? 'For every screen and plugin nobody has picked for. They always stay on the settings page too.' : own ? describePick(pick) : `Now: ${describePick(pick).toLowerCase()} (${PICK_SOURCE_LABELS[from]}).`} />
      {inside && (
        <SelectField label="How, inside it" value={pick.mode} options={INSIDE_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] + (scope.kind === 'owner' && !modes.includes(m) ? ' (opens as a pane here)' : '') }))} onChange={(v) => setPick({ ...pick, mode: v as InsideMode })} />
      )}
      {notOffered && <Note tone="info">This plugin doesn't offer a {MODE_LABELS[pick.mode].toLowerCase()}, so they slide out as a pane over it.</Note>}
      {look && lk && (
        <>
          <div className="fx-row fx-row--wrap">
            <Button tone="ghost" size="sm" icon={more ? 'chevron-up' : 'chevron-down'} onClick={() => setMore(!more)}>{more ? 'Hide look and animation' : 'Look and animation'}</Button>
            {tryIt && <Button tone="ghost" size="sm" icon="play" onClick={() => rt.dispatch(tryIt)}>Try it</Button>}
            <Button tone="ghost" size="sm" icon="undo" onClick={() => setPick({ ...pick, looks: { ...pick.looks, [lk]: DEFAULT_LOOKS[lk] } })}>Reset look</Button>
          </div>
          {more && (
            <div className="axf-sp-picker__look">
              <div className="axf-sp-picker__grid">
                <SelectField label="Animation" value={look.animation} options={opts(ANIMATIONS, ANIMATION_LABELS)} onChange={(v) => setLook({ animation: v as SettingsLook['animation'] })} />
                <SelectField label="Speed" value={look.speed} options={opts(SPEEDS)} onChange={(v) => setLook({ speed: v as SettingsLook['speed'] })} />
                <SelectField label="Easing" value={look.easing} options={opts(EASINGS, { theme: 'Theme' })} onChange={(v) => setLook({ easing: v as SettingsLook['easing'] })} />
                {(inside && (pick.mode === 'pane' || pick.mode === 'split')) || (!inside && pick.placement !== 'panel' && pick.placement !== 'sheet' && (look.animation === 'slide' || look.animation === 'push'))
                  ? <SelectField label={inside ? 'From the' : 'Slides in from the'} value={look.edge} options={opts(EDGES)} onChange={(v) => setLook({ edge: v as SettingsLook['edge'] })} /> : null}
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

/**
 * The "Pops up in" row at the top of every settings interface (Brett, Nov 4 2026): what the settings open in now and a
 * select to change it for the screen they were opened from (or, with no screen, the app default). "Look…" opens the
 * full picker. Compact: one line.
 */
export function PopsUpInRow({ screen, owner }: { screen?: string; owner?: string }) {
  const rt = useRuntime();
  const [which, setWhich] = useState<'screen' | 'app'>(screen ? 'screen' : 'app');
  const scope: PlacementScope = which === 'screen' && screen ? { kind: 'screen', view: screen } : owner && !isScreenOwner(owner) && !screen ? { kind: 'owner', owner } : { kind: 'app' };
  const [pick, setPick, own, from] = useSettingsPick(scope);
  const choice = own || scope.kind === 'app' ? choiceOf(pick) : 'default';
  const title = screen ? rt.search.entries().find((e) => e.id === `view:${screen}`)?.label ?? screen : undefined;
  const iface = interfaceOpensIn(rt);
  return (
    <div className="axf-sp-row fx-row fx-row--wrap" data-axf-sp-row={scopeId(scope)} role="group" aria-label="Where these settings pop up">
      <span className="axf-sp-row__label"><Icon name="layout" /> Pops up in</span>
      <select className="fx-select axf-sp-row__select" aria-label="Pops up in" value={choice} onChange={(e) => setPick(e.target.value === 'default' ? null : applyChoice(e.target.value as PlacementChoice, pick))}>
        {choiceOptions(scope, scope.kind === 'app' ? undefined : describePick(pickFor({ appDefault: appDefaultOf(rt), interface: iface }).pick)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {screen && <Segmented size="sm" label="For" value={which} onChange={setWhich} options={[{ value: 'screen', label: title ? `This screen (${title})` : 'This screen' }, { value: 'app', label: 'Whole app' }]} />}
      <span className="fx-muted axf-sp-row__hint">{own && scope.kind !== 'app' ? '' : PICK_SOURCE_LABELS[from]}{hasPlacement(iface) && scope.kind === 'app' ? ` · the settings interface asset says ${describePick(normalizePick(iface)).toLowerCase()}` : ''}</span>
      <Button tone="ghost" size="sm" icon="sliders" onClick={() => rt.dispatch(`settings.placement:${scopeId(scope)}`)}>Look…</Button>
    </div>
  );
}

/** A small replaying sketch of the pick: the screen as a box, the settings opening in it with the look's animation. */
function PlacementPreview({ pick, look }: { pick: SettingsPlacementPick; look: SettingsLook }) {
  const motion = reducedMotion() ? { ...look, animation: 'none' as const } : look;
  const edge = pick.placement === 'panel' ? pick.side : pick.placement === 'sheet' ? 'bottom' : motion.edge;
  const { vars, attrs } = lookStyle({ ...motion, edge });
  const [n, setN] = useState(0);
  const sig = JSON.stringify([pick.placement, pick.side, pick.mode, motion]);
  useEffect(() => { setN((x) => x + 1); }, [sig]);
  const kind = pick.placement === 'inside' ? pick.mode : pick.placement === 'dialog' || pick.placement === 'window' ? 'dialog' : pick.placement === 'page' ? 'tab' : 'pane';
  return (
    <div className="axf-sp-preview" aria-label="Preview" data-axf-sp-kind={pick.placement === 'inside' ? pick.mode : pick.placement}>
      <div className="axf-sp-preview__host" key={n} style={vars} {...attrs}>
        <span className="fx-muted axf-sp-preview__label"><Icon name="eye" /> Preview</span>
        {look.dim && kind !== 'split' && kind !== 'inline' && kind !== 'tab' && <div className="axf-sp-scrim" />}
        <div className={`axf-sp axf-sp--${kind} axf-sp-preview__panel`}><span className="axf-sp-preview__bar" /><span className="axf-sp-preview__bar" /><span className="axf-sp-preview__bar" /></div>
      </div>
      <IconButton icon="refresh" label="Play again" onClick={() => setN((x) => x + 1)} />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { AssetType, AxfRuntime } from '../../core';
import { FRAMEWORK_MODULE } from '../../core/engines/actions';
import { CONTROL_TOKEN_SLOTS, withTokenOverride, withoutTokenOverride } from '../../core/engines/control-tokens.mjs';
import { JUMP_ASSET_FIELD, JUMP_COLLAPSED_KEY, JUMP_FIELDS, JUMP_FIELD_IDS, JUMP_FIELD_LEVELS, JUMP_LOCATIONS, JUMP_MENU_PREFIX, jumpAxis, jumpCollapsed, jumpFieldSource, jumpItems, jumpMenuOutput, jumpMoreSplit, jumpSpy, jumpStep, normalizeJumpMenu, parseJumpCollapsed, withJumpCollapsed, type JumpItem, type JumpLocation, type JumpMenuData, type JumpSection } from '../../core/engines/jumpmenu';
import { SETTINGS_LEVEL_KEY, SETTINGS_LEVELS, SETTINGS_LEVEL_LABEL, type SettingsLevel } from '../../core/engines/settingsui';
import type { MenuEntry } from '../../core/engines/windows';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Segmented, Slider } from './Controls';
import { SelectField, Switch } from './Forms';
import { Icon } from './Icon';
import { MenuList } from './MenuList';
import type { DialogMap } from './Overlays';

/*
 * Jump menu (jump-menu@1, build jump-menu-asset; Brett, Nov 4 2026: "make the jump menu an asset type … when you right
 * click on it, you can go to its settings. It has its own settings … whether it shows icons or text or whatever … you can
 * select its location."): the in-page section index a long page draws from its sections. Tapping an entry scrolls to
 * that section; the section on screen is lit (scroll-spy). It never opens sections one at a time.
 *
 * `<JumpMenu id="plan-studio.plan" sections={…}>{content}</JumpMenu>` lays the menu and the content out as the asset in
 * force says (top / left / right / bottom / floating), so a page never decides where its index sits. Right-click or
 * long-press the menu: Jump menu settings (this dialog), Change jump menu (another jump-menu asset for this page), Move
 * (its location), Fold. Every change is a control@1 override on `tokens.jump` (settings key `axf.tokens.jump`): a plain
 * field is app-wide, `menu.<id>.<field>` is this page's own, `menu.<id>.asset` its asset. They ride the axHub look like
 * every other look change, and the API, MCP and CLI set the same values (`axf token jump set menu.plan-studio.plan.location left`).
 */

export const JUMP_CTX_TARGET = 'jump-menu';
export const JUMP_SETTINGS_DIALOG = 'jump-menu-settings';
const KEY = CONTROL_TOKEN_SLOTS['tokens.jump'].key;
const TYPE = 'jump-menu' as AssetType;
const LOCATION_ICONS: Record<JumpLocation, string> = { top: 'chevron-up', left: 'chevron-left', right: 'chevron-right', bottom: 'chevron-down', floating: 'move' };
const LOCATION_LABELS: Record<JumpLocation, string> = { top: 'Top', left: 'Left', right: 'Right', bottom: 'Bottom', floating: 'Floating' };

/* ---------------- runtime plumbing: actions + context menu, once per runtime ---------------- */

interface LiveMenu { go: (section: string) => void; fold: (on: boolean) => void; collapsible: boolean; folded: boolean }
const installed = new WeakSet<AxfRuntime>();
/** The jump menus on screen right now, by id (the context-menu actions reach them here). */
const live = new Map<string, LiveMenu>();

function install(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  rt.actions.withModule(FRAMEWORK_MODULE, () => {
    rt.actions.register('jumpmenu.settings', ([id], ctx) => rt.openDialog(JUMP_SETTINGS_DIALOG, { id: id || (typeof ctx?.payload === 'string' ? ctx.payload : '') }), { label: 'Jump menu settings' });
    rt.actions.register('jumpmenu.use', ([id, asset]) => { if (id && asset) setJumpField(rt, id, JUMP_ASSET_FIELD, asset === 'default' ? null : asset); }, { label: 'Change jump menu', params: true });
    rt.actions.register('jumpmenu.move', ([id, loc]) => { if (id && loc) setJumpField(rt, id, 'location', loc); }, { label: 'Move jump menu', params: true });
    rt.actions.register('jumpmenu.fold', ([id, on]) => { if (id) live.get(id)?.fold(on !== 'off'); }, { label: 'Fold or unfold a jump menu', params: true });
    rt.actions.register('jumpmenu.go', ([id, section]) => { if (id && section) live.get(id)?.go(section); }, { label: 'Jump to a section', params: true });
    rt.actions.register('jumpmenu.reset', ([id]) => resetJumpMenu(rt, id || null), { label: 'Reset a jump menu', params: true });
  });
  // One menu, named by the payload (its id), never the others.
  rt.contextExtras.set(JUMP_CTX_TARGET, (_t, id) => (id ? jumpContextItems(rt, id) : []));
}

/** The right-click items for one jump menu: settings, change (asset picker), move (location), fold, reset. */
export function jumpContextItems(rt: AxfRuntime, id: string): MenuEntry[] {
  const { data, assetId, overrides } = rt.jumpMenuData(id);
  const assets = rt.registry.list(TYPE) as unknown as { id: string; name: string }[];
  const own = jumpFieldSource(overrides, id, JUMP_ASSET_FIELD) === 'menu';
  const change: MenuEntry[] = [
    ...assets.map((a) => ({ id: `axf-jump-use-${a.id}`, label: `${a.id === assetId ? '• ' : ''}${a.name}`, icon: 'list', action: `jumpmenu.use:${id}:${a.id}` })),
    ...(own ? [{ id: 'axf-jump-use-sep', separator: true }, { id: 'axf-jump-use-default', label: 'The app’s own', icon: 'undo', action: `jumpmenu.use:${id}:default` }] : []),
  ];
  const move: MenuEntry[] = JUMP_LOCATIONS.map((l) => ({ id: `axf-jump-move-${l}`, label: `${l === data.location ? '• ' : ''}${LOCATION_LABELS[l]}`, icon: LOCATION_ICONS[l], action: `jumpmenu.move:${id}:${l}` }));
  const m = live.get(id);
  const changed = Object.keys(overrides).some((k) => k.startsWith(`${JUMP_MENU_PREFIX}${id}.`));
  return [
    { id: 'axf-jump-settings', label: 'Jump menu settings', icon: 'settings', action: `jumpmenu.settings:${id}` },
    { id: 'axf-jump-change', label: 'Change jump menu', icon: 'shuffle', items: change },
    { id: 'axf-jump-move', label: 'Move', icon: 'move', items: move },
    ...(m?.collapsible ? [{ id: 'axf-jump-fold', label: m.folded ? 'Unfold' : 'Fold', icon: m.folded ? 'maximize' : 'minimize', action: `jumpmenu.fold:${id}:${m.folded ? 'off' : 'on'}` }] : []),
    ...(changed ? [{ id: 'axf-jump-reset', label: 'Reset this jump menu', icon: 'undo', action: `jumpmenu.reset:${id}` }] : []),
  ];
}

/* ---------------- settings: control@1 overrides on tokens.jump ---------------- */

/**
 * Set one field. `menuId` = that page's own setting (`menu.<id>.<field>`), null = app-wide (`<field>`). A value equal
 * to what lies beneath (the app-wide value for a page, the asset's own for the app) drops the override instead.
 */
export function setJumpField(rt: AxfRuntime, menuId: string | null, field: string, value: string | number | boolean | null): void {
  const path = menuId ? `${JUMP_MENU_PREFIX}${menuId}.${field}` : field;
  const raw = rt.settings.get(KEY);
  let beneath: unknown;
  if (field === JUMP_ASSET_FIELD) beneath = null;
  else if (menuId) beneath = (rt.jumpMenuData(undefined).data as unknown as Record<string, unknown>)[field];
  else { const a = rt.assetOrNull(TYPE); beneath = a ? (normalizeJumpMenu(a.data) as unknown as Record<string, unknown>)[field] : (JUMP_FIELDS[field]?.default as unknown); }
  const next = value === null || value === beneath ? withoutTokenOverride(raw, path) : withTokenOverride(raw, path, value);
  if (next && typeof next === 'object' && Object.keys(next).length) rt.settings.set(KEY, next as never); else rt.settings.clear(KEY);
}
/** Drop one page's overrides (its fields and its asset), or every app-wide one when `menuId` is null. */
export function resetJumpMenu(rt: AxfRuntime, menuId: string | null): void {
  const raw = rt.settings.get(KEY);
  const paths = menuId ? [...JUMP_FIELD_IDS, JUMP_ASSET_FIELD].map((f) => `${JUMP_MENU_PREFIX}${menuId}.${f}`) : [...JUMP_FIELD_IDS];
  let next: unknown = raw;
  for (const p of paths) next = withoutTokenOverride(next, p);
  if (next && typeof next === 'object' && Object.keys(next as object).length) rt.settings.set(KEY, next as never); else rt.settings.clear(KEY);
}

/** The jump menu in force for a page: re-read whenever the overrides, the active asset or the folded state change. */
export function useJumpMenu(id?: string): { data: JumpMenuData; assetId: string | null; overrides: Record<string, unknown>; folded: boolean } {
  const rt = useRuntime();
  useAxfState();
  useSyncExternalStore((f) => rt.settings.onChange(KEY, f), () => rt.settings.get(KEY), () => rt.settings.get(KEY));
  const foldedRaw = useSyncExternalStore((f) => rt.settings.onChange(JUMP_COLLAPSED_KEY, f), () => rt.settings.get(JUMP_COLLAPSED_KEY), () => rt.settings.get(JUMP_COLLAPSED_KEY));
  const r = rt.jumpMenuData(id);
  const saved = id ? parseJumpCollapsed(foldedRaw)[id] : undefined;
  return { ...r, folded: jumpCollapsed(r.data, { collapsed: saved }) };
}

function setFolded(rt: AxfRuntime, id: string, on: boolean | null): void {
  const m = withJumpCollapsed(rt.settings.get(JUMP_COLLAPSED_KEY), id, on);
  if (Object.keys(m).length) rt.settings.set(JUMP_COLLAPSED_KEY, JSON.stringify(m)); else rt.settings.clear(JUMP_COLLAPSED_KEY);
}

/* ---------------- the component ---------------- */

export interface JumpMenuProps {
  /** this page's menu id (`plan-studio.plan`): its settings, its asset pick and its folded state hang off it */
  id: string;
  sections: readonly JumpSection[];
  /** accessible name of the menu (default "Sections") */
  label?: string;
  /** the element id a section scrolls to (default: the section's id) */
  targetId?: (s: JumpSection) => string;
  /** the scrolling box (default: the nearest scrolling ancestor, else the page) */
  scrollRef?: RefObject<HTMLElement | null>;
  /** the content the menu indexes; given, the menu and the content are laid out per the location */
  children?: ReactNode;
  className?: string;
}

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
function scrollBoxOf(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p && p !== document.body) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

export function JumpMenu({ id, sections, label = 'Sections', targetId, scrollRef, children, className }: JumpMenuProps) {
  const rt = useRuntime();
  install(rt);
  const { data, folded } = useJumpMenu(id);
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const clean = useMemo(() => sections.filter((s) => s && typeof s.id === 'string'), [sections]);
  const items = useMemo(() => jumpItems(clean, data.display), [clean, data.display]);
  const reduced = prefersReducedMotion();
  const out = useMemo(() => jumpMenuOutput(data, { reducedMotion: reduced, collapsed: folded }), [data, reduced, folded]);
  const axis = jumpAxis(data.location);
  const target = useCallback((s: JumpSection) => (targetId ? targetId(s) : s.id), [targetId]);
  const offsetPx = useCallback(() => {
    const el = hostRef.current;
    const space = el ? parseFloat(getComputedStyle(el).getPropertyValue('--fx-space')) || 8 : 8;
    return data.offset * space;
  }, [data.offset]);
  const box = useCallback(() => scrollRef?.current ?? scrollBoxOf(hostRef.current), [scrollRef]);

  // Jump: scroll the box so the section's top sits `offset` below the box's top edge.
  const go = useCallback((sectionId: string) => {
    const s = clean.find((x) => x.id === sectionId);
    const el = s ? document.getElementById(target(s)) : null;
    if (!el) return;
    const b = box();
    const behavior: ScrollBehavior = data.smooth && !reduced ? 'smooth' : 'auto';
    const r = el.getBoundingClientRect();
    if (b) b.scrollTo({ top: r.top - b.getBoundingClientRect().top + b.scrollTop - offsetPx(), behavior });
    else window.scrollTo({ top: r.top + window.scrollY - offsetPx(), behavior });
    setActive(sectionId);
    el.focus?.({ preventScroll: true });
  }, [clean, target, box, data.smooth, reduced, offsetPx]);

  // Scroll-spy: the section on screen, on every scroll (one frame at a time).
  useEffect(() => {
    if (!data.spy) return;
    const b = box();
    const src: EventTarget = b ?? window;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const top = b ? b.getBoundingClientRect().top : 0;
      const scrollTop = b ? b.scrollTop : window.scrollY;
      const positions = clean.map((s) => { const el = document.getElementById(target(s)); if (!el) return null; const r = el.getBoundingClientRect(); return { id: s.id, top: r.top - top + scrollTop, bottom: r.bottom - top + scrollTop }; }).filter((p): p is { id: string; top: number; bottom: number } => !!p);
      const viewport = b ? b.clientHeight : window.innerHeight;
      const max = b ? b.scrollHeight : document.documentElement.scrollHeight;
      setActive(jumpSpy(positions, scrollTop, viewport, max, offsetPx()));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    src.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { src.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [data.spy, clean, target, box, offsetPx]);

  // The context-menu actions reach this instance here.
  useEffect(() => {
    live.set(id, { go, fold: (on) => setFolded(rt, id, on), collapsible: data.collapsible, folded });
    return () => { live.delete(id); };
  }, [id, go, rt, data.collapsible, folded]);

  const bar = (
    <JumpMenuBar id={id} items={items} data={data} active={active} folded={folded} label={label} axis={axis} attrs={out.attrs} vars={out.vars}
      onGo={go} onFold={data.collapsible ? (on) => setFolded(rt, id, on) : undefined} />
  );
  if (children === undefined) return bar;
  const after = data.location === 'bottom' || data.location === 'right' || data.location === 'floating';
  return (
    <div ref={hostRef} className={`fx-jump-host ${className ?? ''}`.trim()} data-fx-jump-location={data.location} data-fx-jump-axis={axis} data-fx-jump-sticky={data.sticky ? 'on' : 'off'} data-fx-jump-collapsed={folded ? 'on' : 'off'}>
      {!after && bar}
      <div className="fx-jump-host__content">{children}</div>
      {after && bar}
    </div>
  );
}

interface BarProps {
  id: string; items: JumpItem[]; data: JumpMenuData; active: string | null; folded: boolean; label: string; axis: 'row' | 'column';
  attrs: Record<string, string>; vars: Record<string, string>;
  onGo: (section: string) => void; onFold?: (on: boolean) => void;
  /** a preview in the settings dialog: no context menu, no measuring */
  preview?: boolean;
}

/** The menu itself (the entries, the More menu, the fold handle). */
export function JumpMenuBar({ id, items, data, active, folded, label, axis, attrs, vars, onGo, onFold, preview }: BarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(items.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const widths = useRef<number[]>([]);
  const more = data.overflow === 'more' && axis === 'row' && !folded && !preview;

  // Overflow `more`: measure every entry once (all shown), then fold the ones that don't fit under More; re-measure on resize.
  useLayoutEffect(() => {
    if (!more) { setShown(items.length); return; }
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const kids = [...el.querySelectorAll<HTMLElement>('[data-fx-jump-entry]')];
      if (kids.length === items.length) widths.current = kids.map((k) => k.offsetWidth);
      const moreBtn = el.querySelector<HTMLElement>('[data-fx-jump-more]');
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const split = jumpMoreSplit(widths.current, el.clientWidth, (moreBtn?.offsetWidth ?? 0) || Math.max(...widths.current, 0), gap);
      setShown(split.shown);
    };
    setShown(items.length);
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { setShown(items.length); requestAnimationFrame(measure); }) : null;
    ro?.observe(el);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [more, items]);

  const ids = items.map((i) => i.id);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : null;
    if (!dir) return;
    e.preventDefault();
    const next = jumpStep(ids, focusId ?? active, dir);
    if (!next) return;
    setFocusId(next);
    listRef.current?.querySelector<HTMLElement>(`[data-fx-jump-entry="${CSS.escape(next)}"]`)?.focus();
  };
  const visible = more ? items.slice(0, shown) : items;
  const rest = more ? items.slice(shown) : [];
  const style = vars as unknown as Record<string, string>;
  const ctx = preview ? {} : { 'data-fx-ctx-target': JUMP_CTX_TARGET, 'data-fx-ctx-payload': id };
  return (
    <nav className={`fx-jump fx-jump--${data.variant}${folded ? ' is-folded' : ''}${preview ? ' fx-jump--preview' : ''}`} aria-label={label} data-axf-jump={id} {...attrs} {...ctx} style={style}>
      {!folded && (
        <div ref={listRef} className="fx-jump__list" role="list" onKeyDown={onKey}>
          {visible.map((it) => (
            <button key={it.id} type="button" role="listitem" data-fx-jump-entry={it.id} className={`fx-jump__item${it.id === active ? ' is-on' : ''}`} aria-current={it.id === active ? 'location' : undefined} tabIndex={(focusId ?? active ?? ids[0]) === it.id ? 0 : -1}
              title={it.showText ? undefined : it.name} aria-label={it.showText ? undefined : it.name} onClick={() => onGo(it.id)} onFocus={() => setFocusId(it.id)}>
              {it.showIcon && it.icon && <Icon name={it.icon} size={14} className="fx-jump__icon" />}
              {it.showText && <span className="fx-jump__text">{it.text}</span>}
            </button>
          ))}
          {more && rest.length > 0 && (
            <span className="fx-jump__more-wrap">
              <button type="button" data-fx-jump-more="" className={`fx-jump__item fx-jump__more${rest.some((r) => r.id === active) ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                <Icon name="more" size={14} className="fx-jump__icon" /><span className="fx-jump__text">More</span>
              </button>
              {moreOpen && (
                <div className="fx-popover fx-jump__menu" role="menu">
                  <MenuList items={rest.map((r) => ({ id: `jump-${r.id}`, label: r.name, icon: r.icon, action: `jumpmenu.go:${id}:${r.id}` }))} onDone={() => setMoreOpen(false)} />
                </div>
              )}
            </span>
          )}
        </div>
      )}
      {onFold && (
        <button type="button" className="fx-iconbtn fx-jump__fold" aria-expanded={!folded} aria-label={folded ? 'Unfold the jump menu' : 'Fold the jump menu'} title={folded ? 'Unfold' : 'Fold'} onClick={() => onFold(!folded)}>
          <Icon name={folded ? (axis === 'column' ? 'chevron-right' : 'list') : (axis === 'column' ? 'chevron-left' : 'chevron-up')} size={14} />
        </button>
      )}
    </nav>
  );
}

/* ---------------- the settings dialog ---------------- */

const LABELS: Record<string, string> = { location: 'Location', display: 'Shows', variant: 'Style', size: 'Size', density: 'Density', sticky: 'Stays on screen while the page scrolls', collapsible: 'Can fold to a handle', collapsed: 'Starts folded', spy: 'Light the section on screen', smooth: 'Smooth scrolling', overflow: 'When the entries don’t fit', offset: 'Room above a jumped-to heading' };
const OPTION_LABELS: Record<string, string> = { 'icons-text': 'Icons + text', text: 'Text only', icons: 'Icons only', numbered: 'Numbered', chips: 'Chips', underline: 'Underline', rail: 'Rail', pill: 'Pill', sm: 'Small', md: 'Medium', lg: 'Large', theme: 'Theme', compact: 'Compact', regular: 'Regular', roomy: 'Roomy', wrap: 'Wrap to more lines', scroll: 'Scroll sideways', more: 'Fold the rest under More', top: 'Top', left: 'Left', right: 'Right', bottom: 'Bottom', floating: 'Floating' };
const DISPLAY_ICONS: Record<string, string> = { 'icons-text': 'layers', text: 'type', icons: 'star', numbered: 'list' };
const LEVEL_RANK: Record<SettingsLevel, number> = { simple: 0, basic: 1, developer: 2, administrator: 3 };
const SOURCE_TEXT = { menu: 'Set for this page.', app: 'Set for every jump menu in the app.', asset: '' } as const;

function useLevel(): [SettingsLevel, (l: SettingsLevel) => void] {
  const rt = useRuntime();
  const raw = useSyncExternalStore((f) => rt.settings.onChange(SETTINGS_LEVEL_KEY, f), () => rt.settings.get(SETTINGS_LEVEL_KEY), () => rt.settings.get(SETTINGS_LEVEL_KEY));
  const level = (SETTINGS_LEVELS as readonly string[]).includes(String(raw)) ? (raw as SettingsLevel) : 'basic';
  return [level, (l) => rt.settings.set(SETTINGS_LEVEL_KEY, l)];
}

function JumpField({ menuId, field, scope }: { menuId: string; field: string; scope: 'menu' | 'app' }) {
  const rt = useRuntime();
  const { data, overrides } = useJumpMenu(scope === 'menu' ? menuId : undefined);
  const f = JUMP_FIELDS[field]!;
  const v = (data as unknown as Record<string, unknown>)[field];
  const src = jumpFieldSource(overrides, scope === 'menu' ? menuId : null, field);
  const hint = SOURCE_TEXT[src] || undefined;
  const set = (x: string | number | boolean) => setJumpField(rt, scope === 'menu' ? menuId : null, field, x);
  const label = LABELS[field] ?? field;
  if (f.kind === 'boolean') return <Switch label={label} hint={hint} checked={v === true} onChange={set} />;
  if (f.kind === 'number') return <Slider label={label} value={Number(v)} min={f.min} max={f.max} step={1} unit="×" onChange={set} />;
  const options = [...(f.options ?? [])];
  if (field === 'location') return <div className="fx-field"><span className="fx-field__label">{label}</span><Segmented label={label} value={String(v)} options={options.map((o) => ({ value: o, label: OPTION_LABELS[o] ?? o, icon: LOCATION_ICONS[o as JumpLocation] }))} onChange={set} />{hint && <span className="fx-muted fx-field__hint">{hint}</span>}</div>;
  if (field === 'display' || field === 'size') return <div className="fx-field"><span className="fx-field__label">{label}</span><Segmented label={label} value={String(v)} options={options.map((o) => ({ value: o, label: OPTION_LABELS[o] ?? o, icon: DISPLAY_ICONS[o] }))} onChange={set} />{hint && <span className="fx-muted fx-field__hint">{hint}</span>}</div>;
  return <SelectField label={label} hint={hint} value={String(v)} options={options.map((o) => ({ value: o, label: OPTION_LABELS[o] ?? o }))} onChange={set} />;
}

const PREVIEW_SECTIONS: JumpSection[] = [{ id: 'basics', label: 'Basics', icon: 'edit' }, { id: 'steps', label: 'Steps', icon: 'list' }, { id: 'links', label: 'Links', icon: 'external' }, { id: 'notes', label: 'Notes', icon: 'file' }];

/** A small jump menu drawn with the same classes and tokens: what the page's menu looks like right now. */
export function JumpMenuPreview({ menuId }: { menuId: string }) {
  const { data, folded } = useJumpMenu(menuId);
  const [active, setActive] = useState('steps');
  const items = jumpItems(PREVIEW_SECTIONS, data.display);
  const out = jumpMenuOutput(data, { collapsed: folded });
  return (
    <div className="fx-jump-preview" data-fx-jump-location={data.location} data-fx-jump-axis={jumpAxis(data.location)} aria-hidden="true">
      <JumpMenuBar id={`${menuId}:preview`} items={items} data={data} active={active} folded={folded} label="Preview" axis={jumpAxis(data.location)} attrs={out.attrs} vars={out.vars} onGo={setActive} preview />
    </div>
  );
}

/** The jump menu settings interface for one page's menu (right-click → Jump menu settings). */
export function JumpMenuSettings({ id }: { id: string }) {
  const rt = useRuntime();
  const [level, setLevel] = useLevel();
  const [scope, setScope] = useState<'menu' | 'app'>('menu');
  const { assetId, overrides } = useJumpMenu(scope === 'menu' ? id : undefined);
  const presets = rt.registry.list(TYPE) as unknown as { id: string; name: string; description?: string }[];
  const cur = presets.find((p) => p.id === assetId);
  const mine = Object.keys(overrides).filter((k) => k.startsWith(`${JUMP_MENU_PREFIX}${id}.`)).length;
  const app = Object.keys(overrides).filter((k) => !k.startsWith(JUMP_MENU_PREFIX)).length;
  const fields = JUMP_FIELD_IDS.filter((f) => LEVEL_RANK[JUMP_FIELD_LEVELS[f] ?? 'developer'] <= LEVEL_RANK[level]);
  if (!id) return <p className="fx-muted">Right-click or long-press a jump menu to open its settings.</p>;
  return (
    <div className="fx-stack fx-jump-settings">
      <div className="fx-row fx-jump-settings__bar" role="toolbar" aria-label="Jump menu settings level" data-axf-tap-confirm="off" data-axf-tap-confirm-reason="a level picker: one tap changes what is shown, nothing runs">
        <Segmented size="sm" label="Level" value={level} options={SETTINGS_LEVELS.map((l) => ({ value: l, label: SETTINGS_LEVEL_LABEL[l] }))} onChange={setLevel} />
        <span className="fx-jump-settings__grow" />
        <Segmented size="sm" label="Applies to" value={scope} options={[{ value: 'menu', label: 'This page' }, { value: 'app', label: 'Every jump menu' }]} onChange={setScope} />
      </div>
      <p className="fx-muted">{scope === 'menu' ? <>Settings for the jump menu <code>{id}</code>. They beat the app-wide ones on this page only.</> : 'Settings for every jump menu in the app (a page with its own settings keeps those).'}</p>
      <SelectField label={scope === 'menu' ? 'Jump menu for this page' : 'Jump menu for the app'} hint={cur?.description} value={assetId ?? ''} options={presets.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(aid) => { if (scope === 'menu') setJumpField(rt, id, JUMP_ASSET_FIELD, aid); else rt.swap(TYPE, aid); }} />
      <JumpMenuPreview menuId={id} />
      <div className="fx-stack">{fields.map((f) => <JumpField key={f} menuId={id} field={f} scope={scope} />)}</div>
      {level === 'simple' && <p className="fx-muted">More settings at the Basic and Developer levels.</p>}
      <div className="fx-form__actions">
        <Button icon="undo" disabled={!mine} onClick={() => resetJumpMenu(rt, id)}>{mine ? `Reset this page’s ${mine} change${mine === 1 ? '' : 's'}` : 'Nothing changed on this page'}</Button>
        <Button icon="refresh" disabled={!app} onClick={() => resetJumpMenu(rt, null)}>{app ? `Reset ${app} app-wide change${app === 1 ? '' : 's'}` : 'No app-wide changes'}</Button>
      </div>
    </div>
  );
}

export const jumpMenuDialog: DialogMap = {
  [JUMP_SETTINGS_DIALOG]: { title: 'Jump menu settings', icon: 'list', searchable: false, render: (props) => <JumpMenuSettings id={typeof props.id === 'string' ? props.id : ''} /> },
};

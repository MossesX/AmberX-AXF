/**
 * Help mode (Brett, Nov 1 2026): "when it's on, the app teaches me how to use it, with tooltips everywhere. Off = no
 * tooltips, no clutter." One layer every AppShell mounts, so every app and every plugin page gets it without a line of
 * its own code:
 *
 *   - names every control with a stable help id (core/engines/help-rules.mjs `helpTarget`: data-help, the action it
 *     dispatches, the screen it opens, a banner / menu id, else its label) and marks it `data-axf-help-id`
 *   - desktop: hover a control → its tooltip; phone: a small ? badge on each control (tap it), or long-press the control
 *   - a tooltip never covers its control and never stops it working; tapping anywhere else (or Escape) closes it
 *   - "What is this?" in a tooltip opens a small panel with the longer explanation and related screens
 *   - the first time on a screen, a 2–4 step intro of its main parts (Skip; "Don't show intros again")
 * Off: nothing is tagged, drawn or listened to except the switch's own shortcuts (F1, Ctrl+Shift+H).
 * Look: theme tokens only (`.fx-help-*` in ui/axf.css).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { HELP_CONTROL_SELECTOR, HELP_SHORTCUTS, type HelpDescriptor, type HelpEntry, type HelpIntro } from '../../core/engines/help';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { Button, IconButton } from './Controls';
import { Checkbox } from './Forms';

const UI = 'data-axf-help-ui';
const LONG_PRESS_MS = 480;
const HOVER_MS = 320;

/** Help mode on? Re-renders when it changes. */
export function useHelpMode(): boolean {
  const rt = useRuntime();
  useAxfState();
  return rt.helpMode();
}

/** What a DOM control is, for help ids. Exported for tests and for apps that draw their own controls. */
export function describeHelpElement(el: Element): HelpDescriptor & { kind: string } {
  const attr = (n: string) => el.getAttribute(n) ?? undefined;
  const action = attr('data-axf-action');
  const nav = attr('data-axf-view-link');
  const column = el.matches('th, [role="columnheader"]');
  const kind = el.matches('[data-fx-banner-id]') ? 'banner'
    : el.matches('[role="menuitem"], [role="menuitemcheckbox"]') ? 'menu-item'
    : el.matches('[role="tab"]') ? 'tab'
    : column ? 'column'
    : el.matches('.fx-switchrow, .fx-checkrow, [role="switch"]') ? 'toggle'
    : el.matches('.fx-slider') ? 'slider'
    : el.matches('.fx-field, select') ? 'field'
    : nav ? 'nav'
    : el.matches('a[href]') ? 'link'
    : el.matches('[data-axf-menu-btn]') ? 'menu'
    : 'button';
  return {
    kind,
    help: attr('data-help'),
    action,
    view: nav,
    banner: attr('data-fx-banner-id'),
    menu: attr('data-axf-menu-btn'),
    column,
    label: labelOf(el),
  };
}

function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  // a field / switch box: its own label text, not the value typed into it
  const own = el.querySelector(':scope > label, .fx-field__label, .fx-switchrow__label, .fx-checkrow__label, .fx-slider__head label');
  const raw = (own ?? el).textContent ?? '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 80);
  return (el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '').trim();
}

/** The element an intro step or a related link points at: a help id, data-help, data-axf-id, a view, else a CSS selector. */
export function findHelpTarget(target: string): HTMLElement | null {
  const t = target.trim();
  if (!t) return null;
  const esc = t.replace(/["\\]/g, '');
  for (const sel of [`[data-axf-help-id="${esc}"]`, `[data-help="${esc}"]`, `[data-axf-id="${esc}"]`, `[data-axf-view-link="${esc.replace(/^view:/, '')}"]`, `[data-view="${esc}"]`]) {
    const hit = visible(document.querySelectorAll<HTMLElement>(sel));
    if (hit) return hit;
  }
  try { return visible(document.querySelectorAll<HTMLElement>(t)); } catch { return null; }
}

function visible(list: NodeListOf<HTMLElement>): HTMLElement | null {
  for (const el of list) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return el; }
  return null;
}

interface Tip { el: HTMLElement; id: string | null; entry: (HelpEntry & { pack: string }) | null; label: string; rect: DOMRect }

/**
 * The Help layer. AppShell mounts it once; apps that don't use AppShell can mount it themselves inside <AxfProvider>.
 */
export function HelpLayer() {
  const rt = useRuntime();
  const state = useAxfState();
  const on = rt.helpMode();
  const [tip, setTip] = useState<Tip | null>(null);
  const [badges, setBadges] = useState<{ key: string; x: number; y: number; el: HTMLElement }[]>([]);
  const coarse = useCoarsePointer();
  const tipRef = useRef<HTMLDivElement | null>(null);

  // the switch's shortcuts work whether Help mode is on or off
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : '', e.key.toLowerCase()].filter(Boolean).join('+');
      if (HELP_SHORTCUTS.includes(combo)) { e.preventDefault(); rt.setHelpMode(null); return; }
      if (e.key === 'Escape') { setTip(null); if (rt.helpPanel()) rt.explainHelp(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rt]);

  // the root carries the mode, for styles that want it (data-axf-help="on")
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (on) root.setAttribute('data-axf-help', 'on'); else root.removeAttribute('data-axf-help');
    if (!on) setTip(null);
    return () => root.removeAttribute('data-axf-help');
  }, [on]);

  // tag every control with its help id; re-tag when the page changes (one pass per frame at most)
  const tag = useCallback(() => {
    const els = document.querySelectorAll<HTMLElement>(HELP_CONTROL_SELECTOR);
    for (const el of els) {
      if (el.closest(`[${UI}]`)) continue;
      const desc = describeHelpElement(el);
      const { id, entry } = rt.helpFor(desc);
      if (!id) { el.removeAttribute('data-axf-help-id'); continue; }
      if (el.getAttribute('data-axf-help-id') !== id) el.setAttribute('data-axf-help-id', id);
      const has = entry ? (entry.draft ? 'draft' : 'yes') : 'no';
      if (el.getAttribute('data-axf-help-has') !== has) el.setAttribute('data-axf-help-has', has);
    }
  }, [rt]);

  const placeBadges = useCallback(() => {
    if (!coarse) return setBadges([]);
    const out: { key: string; x: number; y: number; el: HTMLElement }[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    document.querySelectorAll<HTMLElement>('[data-axf-help-id]').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.height < 12 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
      // only controls you can see: the topmost thing at its centre is the control (or inside it), not a dialog over it
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) return;
      // a control inside another tagged one (a button in a banner) keeps the badge; the outer one doesn't double it
      if (el.querySelector('[data-axf-help-id]') && !el.matches('[data-fx-banner-id]')) return;
      out.push({ key: `${i}:${el.getAttribute('data-axf-help-id')}`, x: Math.min(vw - 9, r.right - 2), y: Math.max(9, r.top + 2), el });
    });
    setBadges(out.slice(0, 160));
  }, [coarse]);

  useEffect(() => {
    if (!on) { document.querySelectorAll('[data-axf-help-id]').forEach((el) => { el.removeAttribute('data-axf-help-id'); el.removeAttribute('data-axf-help-has'); }); setBadges([]); return undefined; }
    let raf = 0;
    const run = () => { raf = 0; tag(); placeBadges(); };
    const soon = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    const mo = new MutationObserver((list) => { if (list.some((m) => !(m.target as Element).closest?.(`[${UI}]`))) soon(); });
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', soon, true);
    window.addEventListener('resize', soon);
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); window.removeEventListener('scroll', soon, true); window.removeEventListener('resize', soon); };
  }, [on, tag, placeBadges, state.view, state.rev]);

  const show = useCallback((el: HTMLElement) => {
    const desc = describeHelpElement(el);
    const { id, entry } = rt.helpFor(desc);
    setTip({ el, id, entry, label: desc.label ?? '', rect: el.getBoundingClientRect() });
  }, [rt]);

  // hover (mouse / pen), long-press (touch), tap elsewhere to dismiss
  useEffect(() => {
    if (!on) return undefined;
    let hover: ReturnType<typeof setTimeout> | undefined;
    let leave: ReturnType<typeof setTimeout> | undefined;
    let press: ReturnType<typeof setTimeout> | undefined;
    let pressAt: { x: number; y: number } | null = null;
    let swallowClick = false;
    const controlOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-axf-help-id]') : null);
    const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest(`[${UI}]`);
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (inUi(e.target)) { clearTimeout(leave); return; }
      const el = controlOf(e.target);
      clearTimeout(hover);
      if (!el) { clearTimeout(leave); leave = setTimeout(() => setTip((t) => (t && !tipRef.current?.matches(':hover') ? null : t)), 260); return; }
      clearTimeout(leave);
      hover = setTimeout(() => show(el), HOVER_MS);
    };
    const down = (e: PointerEvent) => {
      swallowClick = false;
      if (inUi(e.target)) return;
      setTip(null);
      if (e.pointerType !== 'touch') return;
      const el = controlOf(e.target);
      if (!el) return;
      pressAt = { x: e.clientX, y: e.clientY };
      clearTimeout(press);
      press = setTimeout(() => { swallowClick = true; show(el); }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => { if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) { clearTimeout(press); pressAt = null; } };
    const up = () => { clearTimeout(press); pressAt = null; };
    // a long-press shows help instead of tapping the control (the control is untouched), and never opens the phone's menu
    const click = (e: MouseEvent) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } };
    const menu = (e: MouseEvent) => { if (swallowClick || (pressAt && controlOf(e.target))) e.preventDefault(); };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      clearTimeout(hover); clearTimeout(leave); clearTimeout(press);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', menu, true);
    };
  }, [on, show]);

  // a tooltip whose control went away (a page change) goes with it
  useEffect(() => { if (tip && !tip.el.isConnected) setTip(null); }, [tip, state.rev, state.view]);

  if (!on) return null;
  return (
    <div className="fx-help-layer" {...{ [UI]: '' }}>
      {badges.map((b) => (
        <button key={b.key} type="button" className="fx-help-badge" {...{ [UI]: '' }} style={{ left: b.x, top: b.y } as CSSProperties}
          aria-label={`Help: ${labelOf(b.el) || 'this control'}`}
          onClick={(e) => { e.stopPropagation(); show(b.el); }}>?</button>
      ))}
      {tip && <HelpTip tip={tip} tipRef={tipRef} onClose={() => setTip(null)} />}
      <HelpPanel />
      <HelpIntroCard />
    </div>
  );
}

/** Where a tooltip goes: below its control when there is room, else above; never over it; inside the screen. */
export function placeTip(rect: { left: number; top: number; bottom: number; width: number }, size: { w: number; h: number }, view: { w: number; h: number }, gap = 8): { left: number; top: number; side: 'below' | 'above' } {
  const left = Math.max(gap, Math.min(view.w - size.w - gap, rect.left + rect.width / 2 - size.w / 2));
  const below = rect.bottom + gap;
  if (below + size.h <= view.h - gap || rect.top - gap - size.h < gap) return { left, top: Math.min(below, Math.max(gap, view.h - size.h - gap)), side: 'below' };
  return { left, top: rect.top - gap - size.h, side: 'above' };
}

function HelpTip({ tip, tipRef, onClose }: { tip: Tip; tipRef: React.MutableRefObject<HTMLDivElement | null>; onClose: () => void }) {
  const rt = useRuntime();
  const [pos, setPos] = useState<{ left: number; top: number; side: string } | null>(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const r = tip.el.getBoundingClientRect();
    setPos(placeTip(r, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }));
  }, [tip, tipRef]);
  const e = tip.entry;
  return (
    <div ref={tipRef} className={`fx-help-tip${e ? '' : ' is-missing'}${e?.draft ? ' is-draft' : ''}`} role="tooltip" {...{ [UI]: '' }}
      data-side={pos?.side} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 } as CSSProperties}>
      <div className="fx-help-tip__head">
        <Icon name="help" size={14} />
        <strong className="fx-help-tip__title">{e?.title ?? (tip.label || 'This control')}</strong>
        <IconButton icon="x" label="Close help" size={12} onClick={onClose} />
      </div>
      {e ? (
        <>
          <p className="fx-help-tip__text">{e.text}</p>
          {e.tryIt && <p className="fx-help-tip__try"><Icon name="play" size={12} /> {e.tryIt}</p>}
        </>
      ) : (
        <p className="fx-help-tip__text fx-muted">No help yet. It's on the coverage list{tip.id ? <> as <code>{tip.id}</code></> : null}.</p>
      )}
      <div className="fx-help-tip__foot">
        <Button size="sm" tone="ghost" icon="info" onClick={() => { rt.explainHelp(e?.target ?? tip.id); onClose(); }}>What is this?</Button>
      </div>
    </div>
  );
}

/** "What is this?": the longer explanation, a thing to try, a link, related screens. */
export function HelpPanel() {
  const rt = useRuntime();
  useAxfState();
  const id = rt.helpPanel();
  if (!id) return null;
  const index = rt.helpIndex();
  const e = index.byTarget.get(id) ?? null;
  const intro = id.startsWith('view:') ? index.intros.get(id.slice(5)) : undefined;
  return (
    <aside className="fx-help-panel" role="dialog" aria-label="What is this?" {...{ [UI]: '' }}>
      <header className="fx-help-panel__head">
        <Icon name="help" size={16} />
        <div className="fx-help-panel__titles">
          <p className="fx-eyebrow">What is this?</p>
          <h2>{e?.title ?? id}</h2>
        </div>
        <IconButton icon="x" label="Close" onClick={() => rt.explainHelp(null)} />
      </header>
      <div className="fx-help-panel__body">
        {e ? (
          <>
            <p>{e.text}</p>
            {e.more && e.more.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
            {e.tryIt && <p className="fx-help-tip__try"><Icon name="play" size={12} /> Try it: {e.tryIt}</p>}
            {e.draft && <p className="fx-muted fx-help-panel__note">Drafted from the code; plain-English edit still to come.</p>}
          </>
        ) : (
          <p className="fx-muted">No help yet for <code>{id}</code>. Add an entry with this target to the app's help pack (help@1) or the plugin's help.json; the coverage report lists every control still missing one.</p>
        )}
        {(e?.related?.length || intro) ? (
          <div className="fx-help-panel__related">
            <p className="fx-eyebrow">Related</p>
            {e?.related?.map((r) => {
              const rel = index.byTarget.get(r);
              const view = r.startsWith('view:') ? r.slice(5) : null;
              return (
                <Button key={r} size="sm" tone="quiet" icon={view ? 'external' : 'help'} onClick={() => (view ? (rt.navigate(view), rt.explainHelp(null)) : rt.explainHelp(r))}>
                  {rel?.title ?? r}
                </Button>
              );
            })}
            {intro && <Button size="sm" tone="quiet" icon="play" onClick={() => { rt.explainHelp(null); rt.dispatch('help.intro'); }}>Show this screen's intro</Button>}
          </div>
        ) : null}
        {e?.link && <a className="fx-link" href={e.link.href} target={/^https?:/.test(e.link.href) ? '_blank' : undefined} rel="noreferrer">{e.link.label}</a>}
      </div>
    </aside>
  );
}

/** The screen intro: once per screen while Help mode is on (or when asked to replay). */
export function HelpIntroCard() {
  const rt = useRuntime();
  const state = useAxfState();
  const screen = state.view;
  const intro = rt.helpIntro(screen);
  const [at, setAt] = useState(0);
  const [stopAll, setStopAll] = useState(false);
  useEffect(() => { setAt(0); setStopAll(false); }, [screen, intro]);
  if (!intro) return null;
  const done = () => rt.helpIntroDone(screen, stopAll);
  const i = Math.min(at, intro.steps.length - 1);
  const step = intro.steps[i]!;
  const last = i === intro.steps.length - 1;
  return (
    <>
      <HelpSpot target={step.target} />
      <section className="fx-help-intro" role="dialog" aria-label={`${intro.title}: intro`} {...{ [UI]: '' }}>
        <header className="fx-help-intro__head">
          <p className="fx-eyebrow">{intro.title} · {i + 1} of {intro.steps.length}</p>
          <IconButton icon="x" label="Skip the intro" onClick={done} />
        </header>
        {step.title && <h3 className="fx-help-intro__title">{step.title}</h3>}
        <p className="fx-help-intro__say">{step.say}</p>
        <div className="fx-help-intro__foot">
          <Checkbox label="Don't show intros again" checked={stopAll} onChange={setStopAll} />
          <span className="fx-help-intro__buttons">
            {i > 0 && <Button size="sm" tone="ghost" onClick={() => setAt(i - 1)}>Back</Button>}
            {!last && <Button size="sm" tone="ghost" onClick={done}>Skip</Button>}
            <Button size="sm" tone="primary" onClick={() => { if (step.do) rt.dispatch(step.do); if (last) done(); else setAt(i + 1); }}>{last ? 'Got it' : 'Next'}</Button>
          </span>
        </div>
      </section>
    </>
  );
}

/** The outline round the part an intro step is about (nothing when the step names no target, or it isn't on screen). */
function HelpSpot({ target }: { target: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const find = () => { const el = findHelpTarget(target); setRect(el ? el.getBoundingClientRect() : null); };
    find();
    // the page (and the Help layer's tags) may land a frame later: look again then, and once more when it settles
    const raf = requestAnimationFrame(find);
    const late = setTimeout(find, 250);
    window.addEventListener('resize', find);
    window.addEventListener('scroll', find, true);
    return () => { cancelAnimationFrame(raf); clearTimeout(late); window.removeEventListener('resize', find); window.removeEventListener('scroll', find, true); };
  }, [target]);
  if (!rect) return null;
  return <div className="fx-help-spot" {...{ [UI]: '' }} aria-hidden="true" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 } as CSSProperties} />;
}

/** The ? switch (menu bar): lights up while Help mode is on. */
export function HelpModeButton({ className }: { className?: string }) {
  const rt = useRuntime();
  const on = useHelpMode();
  return (
    <button type="button" className={`fx-helpbtn${on ? ' is-on' : ''} ${className ?? ''}`.trim()} aria-pressed={on} data-help="action:help.mode"
      aria-label={on ? 'Help mode is on (F1 turns it off)' : 'Help mode (F1): tooltips on everything'} title={on ? 'Help mode on' : 'Help mode'}
      onClick={() => rt.setHelpMode(null)}>
      <Icon name="help" size={15} />
    </button>
  );
}

function useCoarsePointer(): boolean {
  const q = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(q);
    const on = () => setCoarse(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

export type { HelpIntro };

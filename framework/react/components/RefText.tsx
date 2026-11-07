/**
 * Reference links in text (ref@1, build banner-ref-links, Brett Nov 3 2026). `<RefText text="…" />` draws a line of
 * banner or build text with every mention of a real thing (a screen, settings tab, section or single setting, plugin,
 * dialog, toolbar, menu, component, build, PR, agent, file) as a link:
 *   - tap / click         a peek card: what it is, where it lives, whether a build is changing it, Open
 *   - double-tap / -click open it and highlight it (the search focuser's flash, same as search and What's New)
 *   - long-press / right-click  the context menu: Open, Open in new window, Show in UI Review, Show the build that's
 *     changing it, Copy link
 *
 * The targets are the app's own search index (every screen, dialog, settings tab / group / setting, action, asset,
 * plugin and build any library adds) plus `addRefSource` sources (a console plugin adds the builds
 * store with each build's declared touches, PRs and agents). Matching is engines/refs.mjs: no model, no tokens.
 * A build's explicit refs (`touches={[…]}` or `touches: a.b, c.d` in its text) win over names.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AxfRuntime } from '../../core';
import { findRefs, refIndex, refPeek, refSegments, refTargetFromSearch, resolveRef, type RefIndex, type RefPeek, type RefSpan, type RefTarget } from '../../core/engines/refs.mjs';
import { useOptionalRuntime } from '../AxfProvider';
import { Button } from './Controls';
import { Icon } from './Icon';
import { usePortalRoot } from './InterfaceScope';

/* ---------------- sources ---------------- */

type RefSource = () => readonly RefTarget[];
const sources = new Map<string, RefSource>();
let sourcesRev = 0;
const listeners = new Set<() => void>();
const changed = () => { sourcesRev++; listeners.forEach((l) => l()); };

/** Add (or replace) a source of ref targets; call `refSourcesChanged()` when its list changes. Returns a remover. */
export function addRefSource(id: string, source: RefSource): () => void {
  sources.set(id, source); changed();
  return () => { if (sources.get(id) === source) { sources.delete(id); changed(); } };
}
export function refSourcesChanged(): void { changed(); }

const INDEX_TTL_MS = 5_000;
const cache = new WeakMap<AxfRuntime, { at: number; rev: number; index: RefIndex; builds: RefTarget[] }>();

/** Every target the app knows now: the search index (where each thing opens), then the sources (builds' touches, reviews). */
export function refIndexOf(rt: AxfRuntime): { index: RefIndex; builds: RefTarget[] } {
  const c = cache.get(rt);
  if (c && c.rev === sourcesRev && Date.now() - c.at < INDEX_TTL_MS) return c;
  const targets: RefTarget[] = [];
  for (const e of rt.search.entries()) { if (e.searchable === false) continue; const t = refTargetFromSearch(e); if (t) targets.push(t); }
  for (const s of sources.values()) { try { targets.push(...s()); } catch { /* a broken source adds nothing */ } }
  const index = refIndex(targets);
  const next = { at: Date.now(), rev: sourcesRev, index, builds: [...index.byId.values()].filter((t) => t.kind === 'build') };
  cache.set(rt, next);
  return next;
}

/* ---------------- opening ---------------- */

export type RefHow = 'open' | 'window' | 'review' | 'build' | 'copy';
const enc = encodeURIComponent;
const PARAM = 'axf-ref';
/** Device setting: false = banner text stays plain (Settings → Plugins → Reference links in the console). */
export const REFS_SETTING = 'axf.refs.links';

/** Where a ref's link goes when copied or opened in a new window: this app with `?axf-ref=<id>`. */
export function refLink(id: string): string {
  if (typeof location === 'undefined') return `?${PARAM}=${enc(id)}`;
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set(PARAM, id);
  return u.toString();
}

/** Open a ref (an id or a target). → false when there is nothing to open (the caller already got a toast). */
export function openRef(rt: AxfRuntime, ref: string | RefTarget, how: RefHow = 'open'): boolean {
  const { index, builds } = refIndexOf(rt);
  const id = typeof ref === 'string' ? ref : ref.id;
  const target = typeof ref === 'string' ? (index.byId.get(id) ?? resolveRef(index, id).target) : ref;
  if (how === 'copy') { void globalThis.navigator?.clipboard?.writeText(refLink(id)).then(() => rt.toast('Link copied.', 'info'), () => rt.toast(refLink(id), 'info', 'Copy this link')); return true; }
  if (how === 'window') { globalThis.open?.(refLink(id), '_blank', 'noopener'); return true; }
  const peek = refPeek({ ref: id, kind: target?.kind ?? id.split(':')[0], text: target?.label ?? id, ...(target ? {} : { missing: true }) }, index, builds);
  if (how === 'build') {
    const b = peek.changing[0];
    if (!b) { rt.toast('No build is changing this right now.', 'info'); return false; }
    return openRef(rt, `build:${b.id}`);
  }
  if (how === 'review') {
    const b = [...peek.changing.map((c) => index.byId.get(`build:${c.id}`)), target?.kind === 'build' ? target : undefined].find((x) => x?.reviews?.length);
    const url = b?.reviews?.find((r) => typeof r.url === 'string')?.url as string | undefined;
    if (url) { globalThis.open?.(url, '_blank', 'noopener'); return true; }
    if (rt.actions.get('ui-review.open')) return rt.dispatch('ui-review.open');
    rt.toast('UI Review is not installed here.', 'warning'); return false;
  }
  if (!target || peek.state === 'new') {
    // a part that is new and not live yet: its UI Review item (the build's shots), else say so
    if (peek.changing.length) return openRef(rt, id, 'review');
    rt.toast(`${typeof ref === 'string' ? ref : ref.label} is not in this app.`, 'warning', 'Nothing to open'); return false;
  }
  if (target.focus) return rt.search.focus({ id: target.id, kind: target.kind, label: target.label, focus: target.focus as never });
  if (target.url) { globalThis.open?.(target.url, '_blank', 'noopener'); return true; }
  rt.toast(`${target.label} has no place to open.`, 'info'); return false;
}

const KIND_LABEL: Record<string, string> = {
  screen: 'Screen', settings: 'Settings', section: 'Settings section', setting: 'Setting', dialog: 'Dialog', plugin: 'Plugin', toolbar: 'Toolbar', menu: 'Menu',
  component: 'Component', build: 'Build', pr: 'Pull request', agent: 'Agent', note: 'Note', file: 'File', action: 'Action', window: 'Window',
};
const KIND_ICON: Record<string, string> = { screen: 'layout', settings: 'settings', section: 'settings', setting: 'sliders', dialog: 'layers', plugin: 'package', toolbar: 'menu', menu: 'menu', component: 'box', build: 'play', pr: 'branch', agent: 'user', note: 'edit', file: 'file', action: 'zap', window: 'maximize' };

/** Context menu, actions and the `?axf-ref=` link: installed once per runtime, the first time a RefText draws. */
const installed = new WeakSet<AxfRuntime>();
function installRefs(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  const reg = (how: RefHow, label: string) => rt.actions.register(`refs.${how}`, ([id = '']) => { openRef(rt, decodeURIComponent(id), how); }, { label, params: true, searchable: false, effect: 'navigate' });
  reg('open', 'Open what this text refers to'); reg('window', 'Open it in a new window'); reg('review', 'Show it in UI Review'); reg('build', "Show the build that's changing it"); reg('copy', 'Copy a link to it');
  rt.contextExtras.set('axf-ref', (_t, payload) => {
    if (!payload) return [];
    const id = decodeURIComponent(payload);
    const { index, builds } = refIndexOf(rt);
    const p = refPeek({ ref: id, kind: id.split(':')[0], text: id }, index, builds);
    const t = index.byId.get(id);
    return [
      { id: 'refs.open', label: `Open ${p.label.length > 40 ? `${p.label.slice(0, 38)}…` : p.label}`, icon: 'external', action: `refs.open:${payload}` },
      { id: 'refs.window', label: 'Open in new window', icon: 'maximize', action: `refs.window:${payload}` },
      ...(p.changing.length || t?.reviews?.length ? [{ id: 'refs.review', label: 'Show in UI Review', icon: 'eye', action: `refs.review:${payload}` }] : []),
      ...(p.changing.length ? [{ id: 'refs.build', label: `Show the build that's changing it (${p.changing[0]?.label ?? ""})`, icon: 'play', action: `refs.build:${payload}` }] : []),
      { id: 'refs.copy', label: 'Copy link', icon: 'copy', action: `refs.copy:${payload}` },
    ];
  });
  // a link opened in a new window (or shared): open it once the app has drawn its screens and settings
  if (typeof location !== 'undefined') {
    const id = new URL(location.href).searchParams.get(PARAM);
    if (id) {
      const started = Date.now();
      const tryOpen = () => {
        cache.delete(rt);
        const t = refIndexOf(rt).index.byId.get(id);
        if (t || Date.now() - started > 8_000) {
          if (t || /^(pr|file):/.test(id)) openRef(rt, id); else rt.toast(`${id} is not in this app.`, 'warning', 'Nothing to open');
          const u = new URL(location.href); u.searchParams.delete(PARAM); history.replaceState(history.state, '', u.toString());
          return;
        }
        setTimeout(tryOpen, 400);
      };
      setTimeout(tryOpen, 300);
    }
  }
}

/* ---------------- the peek card ---------------- */

function PeekCard({ rt, peek, at, onClose }: { rt: AxfRuntime; peek: RefPeek; at: DOMRect; onClose: () => void }) {
  const root = usePortalRoot();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: at.left, top: at.bottom, visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect(); const gap = 6;
    const below = at.bottom + gap + r.height <= innerHeight;
    setPos({ left: Math.max(gap, Math.min(at.left, innerWidth - r.width - gap)), top: below ? at.bottom + gap : Math.max(gap, at.top - r.height - gap) });
  }, [at]);
  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key); addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); removeEventListener('resize', onClose); };
  }, [onClose]);
  const go = (id: string, how: RefHow = 'open') => { onClose(); openRef(rt, id, how); };
  const { index } = refIndexOf(rt);
  const reviews = peek.changing.length > 0 || !!index.byId.get(peek.ref)?.reviews?.length;
  const card = (
    <div ref={ref} className="fx-popover fx-ref-peek" role="dialog" aria-label={peek.label} style={pos} data-fx-ctx-ignore>
      <div className="fx-ref-peek__head">
        <Icon name={KIND_ICON[peek.kind] ?? 'info'} size={14} />
        <span className="fx-ref-peek__kind">{KIND_LABEL[peek.kind] ?? peek.kind}</span>
      </div>
      <div className="fx-ref-peek__label">{peek.label}</div>
      {peek.detail && <div className="fx-ref-peek__detail">{peek.detail}</div>}
      {peek.line && <div className={`fx-ref-peek__state is-${peek.state}`}>{peek.line}</div>}
      {peek.candidates.length > 0 && (
        <div className="fx-ref-peek__also">
          <span className="fx-ref-peek__detail">Or did it mean</span>
          {peek.candidates.slice(0, 5).map((c) => <Button key={c.id} size="sm" tone="ghost" icon={KIND_ICON[c.kind] ?? 'info'} onClick={() => go(c.id)}>{c.label} · {KIND_LABEL[c.kind] ?? c.kind}</Button>)}
        </div>
      )}
      <div className="fx-ref-peek__actions">
        <Button size="sm" tone="primary" icon="external" onClick={() => go(peek.ref)}>{peek.state === 'new' ? 'Show it' : 'Open'}</Button>
        {reviews && <Button size="sm" icon="eye" onClick={() => go(peek.ref, 'review')}>UI Review</Button>}
        {peek.changing.length > 0 && <Button size="sm" icon="play" onClick={() => go(peek.ref, 'build')}>The build</Button>}
      </div>
    </div>
  );
  return createPortal(card, root ?? document.body);
}

/* ---------------- the text ---------------- */

export interface RefTextProps {
  text: string;
  /** a build's declared refs (`settings:terminal`, `toolbar.terminal`): they win over names in the text */
  touches?: string[];
  className?: string;
}

/** A line of text with its references as links. Without a runtime (or with nothing to link) it is the plain text. */
export function RefText({ text, touches, className }: RefTextProps) {
  const rt = useOptionalRuntime();
  const [, setRev] = useState(0);
  useEffect(() => { const l = () => setRev((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  useEffect(() => { if (rt) installRefs(rt); }, [rt]);
  const value = String(text ?? '');
  const res = useMemo(() => (rt && value ? findRefs(value, refIndexOf(rt).index, { explicit: touches }) : null), [rt, value, touches?.join(','), sourcesRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [peek, setPeek] = useState<{ peek: RefPeek; at: DOMRect } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTap = useRef(0);
  const pressed = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; x: number; y: number }>({ fired: false, x: 0, y: 0 });
  useEffect(() => () => { clearTimeout(clickTimer.current); clearTimeout(pressed.current.timer); }, []);
  if (!rt || !res?.spans.length || rt.settings.get(REFS_SETTING) === false) return className ? <span className={className}>{value}</span> : <>{value}</>;

  const showPeek = (s: RefSpan, el: Element) => { const { index, builds } = refIndexOf(rt); setPeek({ peek: refPeek(s, index, builds), at: el.getBoundingClientRect() }); };
  const onClick = (s: RefSpan) => (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault(); e.stopPropagation();
    if (pressed.current.fired) { pressed.current.fired = false; return; } // the release after a long-press
    const now = Date.now(); const dbl = rt.behavior().interaction.doubleTapMs;
    const el = e.currentTarget;
    if (now - lastTap.current <= dbl) { clearTimeout(clickTimer.current); lastTap.current = 0; setPeek(null); openRef(rt, s.ref); return; }
    lastTap.current = now;
    clickTimer.current = setTimeout(() => showPeek(s, el), dbl);
  };
  const menu = (s: RefSpan, x: number, y: number) => { clearTimeout(clickTimer.current); setPeek(null); rt.openContext(x, y, 'axf-ref', enc(s.ref)); };
  const onContext = (s: RefSpan) => (e: MouseEvent<HTMLSpanElement>) => { e.preventDefault(); e.stopPropagation(); if (!pressed.current.fired) menu(s, e.clientX, e.clientY); };
  const onDown = (s: RefSpan) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (e.pointerType !== 'touch') return;
    const p = pressed.current; p.fired = false; p.x = e.clientX; p.y = e.clientY; clearTimeout(p.timer);
    p.timer = setTimeout(() => { p.fired = true; menu(s, p.x, p.y); }, rt.behavior().interaction.longPressMs);
  };
  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => { const p = pressed.current; if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > rt.behavior().interaction.dragThreshold) clearTimeout(p.timer); };
  const onUp = () => clearTimeout(pressed.current.timer);
  const onKey = (s: RefSpan) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey || e.key === ' ') openRef(rt, s.ref); else showPeek(s, e.currentTarget);
  };
  return (
    <span className={className}>
      {refSegments(value, res.spans).map((seg, i) => !seg.span ? <Fragment key={i}>{seg.text}</Fragment> : (
        <span
          key={i}
          className={`fx-ref${seg.span.missing ? ' is-missing' : ''}${seg.span.ambiguous ? ' is-ambiguous' : ''}`}
          role="link" tabIndex={0}
          data-fx-ctx-target="axf-ref" data-fx-ctx-payload={enc(seg.span.ref)} data-ref-kind={seg.span.kind}
          title={`${KIND_LABEL[seg.span.kind] ?? seg.span.kind}: tap for details, double-tap to open, hold for more`}
          onClick={onClick(seg.span)} onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onContextMenu={onContext(seg.span)} onPointerDown={onDown(seg.span)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onKeyDown={onKey(seg.span)}
        >{seg.text}</span>
      ))}
      {peek && <PeekCard rt={rt} peek={peek.peek} at={peek.at} onClose={() => setPeek(null)} />}
    </span>
  );
}

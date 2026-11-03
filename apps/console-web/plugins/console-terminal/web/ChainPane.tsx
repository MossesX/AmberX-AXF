/*
 * Context chain pane (headless-tabs, Nov 3 2026, Brett: "show the chain as a tree in the order it happens, and print
 * the rules it picks up one at a time, deliberately slower than real time, so I can watch what the agent is learning").
 * Pane B of a headless tab. The chain is the session's context-chain@1 file (deploy/claude-meter.mjs): the CLAUDE.md
 * load order Claude Code uses (user memory, project memory, @imports, .claude/rules), then every file it Reads, each
 * Markdown file with its rules (headings and list items). Files appear in order, nested under the file that imported
 * them; their rules type out one at a time at the chosen speed (Settings → Terminal → Context chain speed, or the
 * pane's own Slow / Normal / Fast / Instant), with Pause and Skip to end. Finished files fold to one line (tap to open).
 * Theme tokens only (axp-chain prefix); controls are the framework's.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Segmented } from '@console/axf/react';
import { call, type Settings } from './api';
import { meterOf, useMeters } from './meters';

export interface ChainRule { kind: 'heading' | 'item'; level: number; text: string }
export interface ChainItem { i: number; path: string; rel: string; via: string; depth: number; parent: string; at: string; rules: ChainRule[] }
export type Speed = Settings['chainSpeed'];

/** Characters per second and the pause after each rule, per speed. */
export const PACE: Record<Speed, { cps: number; pauseMs: number }> = {
  slow: { cps: 18, pauseMs: 900 }, normal: { cps: 45, pauseMs: 450 }, fast: { cps: 140, pauseMs: 120 }, instant: { cps: Infinity, pauseMs: 0 },
};

/** The reveal order: each file (rule -1 = its header), then each of its rules. Pure. */
export function steps(items: ChainItem[]): { item: number; rule: number; len: number }[] {
  const out: { item: number; rule: number; len: number }[] = [];
  items.forEach((it, k) => { out.push({ item: k, rule: -1, len: 0 }); it.rules.forEach((r, j) => out.push({ item: k, rule: j, len: r.text.length })); });
  return out;
}

/** Advance a reveal cursor by `ms` of time. Returns the new {step, chars, wait}. Pure, so the pacing is testable. */
export function advance(cur: { step: number; chars: number; wait: number }, seq: { len: number; rule: number }[], ms: number, speed: Speed): { step: number; chars: number; wait: number } {
  const pace = PACE[speed];
  let { step, chars, wait } = cur;
  let left = ms;
  while (left > 0 && step < seq.length) {
    if (wait > 0) { const w = Math.min(wait, left); wait -= w; left -= w; if (wait > 0) break; step++; chars = 0; continue; }
    const s = seq[step]!;
    if (s.rule === -1) { wait = pace.pauseMs; if (!wait) { step++; chars = 0; } continue; }
    if (!Number.isFinite(pace.cps)) { chars = s.len; } else { const n = Math.floor((left * pace.cps) / 1000); if (n <= 0) break; const take = Math.min(n, s.len - chars); chars += take; left -= (take * 1000) / pace.cps; }
    if (chars >= s.len) { wait = pace.pauseMs; if (!wait) { step++; chars = 0; } }
  }
  return { step, chars, wait };
}

const VIA_ICON: Record<string, string> = { 'user memory': 'user', 'project memory': 'file', 'project rules': 'shield', 'nested memory': 'folder', import: 'layers', read: 'eye' };
const P = 'axp-chain';

export function ChainPane({ session, settings }: { session: string; settings: Settings | null }) {
  useMeters();
  const meter = meterOf(session);
  const [items, setItems] = useState<ChainItem[]>([]);
  const [err, setErr] = useState('');
  const [speed, setSpeed] = useState<Speed>(settings?.chainSpeed ?? 'normal');
  const [paused, setPaused] = useState(false);
  const [cur, setCur] = useState({ step: 0, chars: 0, wait: 0 });
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const loaded = useRef(-1);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { if (settings?.chainSpeed) setSpeed(settings.chainSpeed); }, [settings?.chainSpeed]);

  // fetch the chain on open and whenever the session's meter says it grew
  const version = meter?.chainVersion ?? 0;
  useEffect(() => {
    if (loaded.current === version && items.length) return;
    let off = false;
    void call<{ version: number; items: ChainItem[] }>(`headless/${encodeURIComponent(session)}/chain`).then((c) => {
      if (off) return; loaded.current = c.version ?? version; setErr('');
      setItems((prev) => (c.items?.length >= prev.length ? c.items : prev)); // append-only: never step back
    }, (e: Error) => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [session, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const seq = useMemo(() => steps(items), [items]);
  const done = cur.step >= seq.length;
  useEffect(() => {
    if (paused || done) return;
    let last = performance.now();
    const t = setInterval(() => { const now = performance.now(); const ms = now - last; last = now; setCur((c) => advance(c, seq, ms, speed)); }, 40);
    return () => clearInterval(t);
  }, [paused, done, seq, speed]);
  // follow the newest line unless Brett scrolled up to read
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [cur.step, cur.chars, items.length]);

  const at = seq[cur.step];
  const curItem = done ? items.length : at?.item ?? 0;
  const shownRules = (k: number) => (k < curItem ? items[k]!.rules.length : k === curItem && at ? Math.max(0, at.rule) : 0);
  const totalRules = items.reduce((n, it) => n + it.rules.length, 0);
  const seenRules = items.reduce((n, _it, k) => n + shownRules(k), 0) + (at && at.rule >= 0 && cur.chars > 0 ? 1 : 0);

  return (
    <section className={P} aria-label="Context chain">
      <header className={`${P}__bar`}>
        <Icon name="branch" size={14} />
        <strong className={`${P}__title`}>Context chain</strong>
        <span className={`${P}__count`}>{Math.min(curItem + (done ? 0 : 1), items.length)}/{items.length} files · {seenRules}/{totalRules} rules</span>
        <span className="fx-grow" />
        <Segmented size="sm" label="Reveal speed" value={speed} onChange={setSpeed}
          options={[{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'instant', label: 'All' }]} />
        <button type="button" className="fx-iconbtn" title={paused ? 'Play' : 'Pause'} aria-label={paused ? 'Play' : 'Pause'} disabled={done} onClick={() => setPaused(!paused)}><Icon name={paused ? 'play' : 'pause'} size={13} /></button>
        <button type="button" className="fx-iconbtn" title="Skip to the end" aria-label="Skip to the end" disabled={done} onClick={() => setCur({ step: seq.length, chars: 0, wait: 0 })}><Icon name="arrow-right" size={13} /></button>
      </header>
      <div ref={box} className={`${P}__list`} role="tree" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {err && !items.length && <p className={`${P}__empty`}>{err}</p>}
        {!err && !items.length && <p className={`${P}__empty`}>Waiting for the session to load its context…</p>}
        {items.slice(0, done ? items.length : curItem + 1).map((it, k) => {
          const n = shownRules(k);
          const active = !done && k === curItem;
          const expanded = open[k] ?? active;
          return (
            <div key={it.i} className={`${P}__file ${active ? 'is-active' : ''}`} role="treeitem" aria-expanded={it.rules.length ? expanded : undefined} style={{ ['--axp-chain-depth' as string]: it.depth }}>
              <button type="button" className={`fx-menu__item ${P}__head`} title={it.path} onClick={() => setOpen({ ...open, [k]: !expanded })}>
                <Icon name={it.rules.length ? (expanded ? 'chevron-down' : 'chevron-right') : 'minus'} size={12} />
                <Icon name={VIA_ICON[it.via] ?? 'file'} size={13} />
                <span className={`${P}__path`}>{it.rel}</span>
                <span className={`${P}__via`}>{it.via}{it.rules.length ? ` · ${it.rules.length}` : ''}</span>
              </button>
              {expanded && n + (active && at?.rule === n ? 1 : 0) > 0 && (
                <ol className={`${P}__rules`}>
                  {it.rules.slice(0, n).map((r, j) => <li key={j} className={`${P}__rule is-${r.kind}`} style={{ ['--axp-chain-level' as string]: r.level }}>{r.text}</li>)}
                  {active && at && at.rule === n && at.rule >= 0 && (
                    <li className={`${P}__rule is-${it.rules[n]!.kind} is-typing`} style={{ ['--axp-chain-level' as string]: it.rules[n]!.level }}>{it.rules[n]!.text.slice(0, cur.chars)}<span className={`${P}__caret`} aria-hidden /></li>
                  )}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

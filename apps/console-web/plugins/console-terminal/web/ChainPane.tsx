/*
 * Context chain pane (headless-tabs, Nov 3 2026, Brett: "show the chain as a tree in the order it happens, and print
 * the rules it picks up one at a time, deliberately slower than real time, so I can watch what the agent is learning").
 * Pane B of a headless tab. The chain is the session's context-chain@1 file (deploy/claude-meter.mjs): the CLAUDE.md
 * load order Claude Code uses (user memory, project memory, @imports, .claude/rules), then every file it Reads, each
 * Markdown file with its rules (headings and list items).
 * A tree (terminal-drag-chain-tree, Nov 3 2026, Brett: "every file that is chained, it needs to open indented"): each
 * file sits under the file that pulled it in (@import, a mention the session followed, a "read it first" rule), with
 * its icon, why it loaded and how many rules it holds; ▸ / ▾ folds a file's children. The reveal walks the tree depth
 * first, each file's rules typing out at the chosen speed (Settings → Terminal → Context chain speed, or the pane's
 * own Slow / Normal / Fast / All), with Pause and Skip to end. Tapping a file shows its content again, typed out from
 * the start; tapping it once more folds it. Theme tokens only (axp-chain prefix); controls are the framework's.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Segmented } from '@console/axf/react';
import { call, type Settings } from './api';
import { meterOf, useMeters } from './meters';
import { chainTree, replay, revealTick, shownOf, treeOrder, REVEAL0, type ChainItem, type ChainNode, type Reveal, type Speed } from './headless-core';

export type { ChainItem, ChainNode, ChainRule, Speed } from './headless-core';

const VIA_ICON: Record<string, string> = { 'user memory': 'user', 'project memory': 'file', 'project rules': 'shield', 'nested memory': 'folder', import: 'layers', read: 'eye' };
const REASON: Record<string, { label: string; icon: string; tip: string }> = {
  'session-start': { label: 'session start', icon: 'play', tip: 'Claude Code loads it when the session starts' },
  import: { label: '@import', icon: 'layers', tip: 'pulled in by an @import in the file above' },
  reference: { label: 'reference', icon: 'arrow-right', tip: 'the file above mentions it and the session read it' },
  'session-start rule': { label: 'start rule', icon: 'shield', tip: 'a rule in the file above says to read it first' },
  read: { label: 'read', icon: 'eye', tip: 'the session read it (no loaded file mentions it)' },
  'nested memory': { label: 'nested memory', icon: 'folder', tip: 'its folder’s CLAUDE.md, loaded when the session read a file there' },
};
const reasonOf = (it: ChainItem) => REASON[it.reason ?? ''] ?? (it.via === 'import' ? REASON.import! : it.via === 'read' ? REASON.read! : REASON['session-start']!);
const fileIcon = (it: ChainItem) => (/\.(md|mdx|markdown)$/i.test(it.path) ? VIA_ICON[it.via] ?? 'file' : /\.(json|ya?ml|toml)$/i.test(it.path) ? 'list' : 'code');
const baseName = (rel: string) => rel.split('/').pop() || rel;
const P = 'axp-chain';

export function ChainPane({ session, settings, scale = 100 }: { session: string; settings: Settings | null; scale?: number }) {
  useMeters();
  const meter = meterOf(session);
  const [items, setItems] = useState<ChainItem[]>([]);
  const [err, setErr] = useState('');
  const [speed, setSpeed] = useState<Speed>(settings?.chainSpeed ?? 'normal');
  const [paused, setPaused] = useState(false);
  const [rev, setRev] = useState<Reveal>(REVEAL0);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const seen = useRef(new Set<number>());
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

  const tree = useMemo(() => chainTree(items), [items]);
  const order = useMemo(() => treeOrder(tree, collapsed), [tree, collapsed]);
  const done = !rev.cur && order.every((k) => rev.done.includes(k));
  useEffect(() => {
    if (paused || done) return;
    let last = performance.now();
    const t = setInterval(() => { const now = performance.now(); const ms = now - last; last = now; setRev((r) => revealTick(r, items, order, ms, speed)); }, 40);
    return () => clearInterval(t);
  }, [paused, done, items, order, speed]);
  // follow the file being revealed unless Brett scrolled up to read
  useEffect(() => { const el = box.current; if (el && stick.current) el.querySelector(`.${P}__file.is-active`)?.scrollIntoView?.({ block: 'nearest' }); }, [rev.cur?.item, rev.cur?.step, items.length]);

  for (const k of rev.done) seen.current.add(k);
  if (rev.cur) seen.current.add(rev.cur.item);
  const totalRules = items.reduce((n, it) => n + it.rules.length, 0);
  const seenRules = items.reduce((n, _it, k) => { const s = shownOf(rev, k, items); return n + s.rules + (s.typing >= 0 && s.chars > 0 ? 1 : 0); }, 0);
  const allDone = () => { const all = items.map((_, k) => k); setRev({ done: all, cur: null }); };
  const pick = (k: number) => {
    if (open[k] ?? rev.cur?.item === k) { setOpen({ ...open, [k]: false }); return; }
    setOpen({ ...open, [k]: true }); setRev((r) => replay(r, k)); setPaused(false);
  };
  const fold = (k: number) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const anyFolded = collapsed.size > 0;
  const parents = useMemo(() => { const out: number[] = []; const walk = (ns: ChainNode[]) => ns.forEach((n) => { if (n.children.length) { out.push(n.i); walk(n.children); } }); walk(tree); return out; }, [tree]);

  const node = (n: ChainNode, depth: number): React.ReactNode => {
    const k = n.i;
    if (!seen.current.has(k)) return null;
    const active = rev.cur?.item === k;
    const s = shownOf(rev, k, items);
    const showRules = (open[k] ?? active) && (s.rules > 0 || s.typing >= 0);
    const kids = n.children.filter((c) => seen.current.has(c.i));
    const folded = collapsed.has(k);
    const r = reasonOf(n);
    return (
      <li key={k} className={`${P}__file ${active ? 'is-active' : ''}`} role="treeitem" aria-level={depth + 1} aria-expanded={n.children.length ? !folded : undefined} aria-selected={active}
        style={{ ['--axp-chain-depth' as string]: depth }}>
        <div className={`${P}__row`}>
          {n.children.length
            ? <button type="button" className={`fx-iconbtn ${P}__twisty`} aria-label={folded ? `Open ${n.rel}` : `Fold ${n.rel}`} title={folded ? 'Show the files it pulled in' : 'Fold the files it pulled in'} onClick={() => fold(k)}><Icon name={folded ? 'chevron-right' : 'chevron-down'} size={12} /></button>
            : <span className={`${P}__twisty`} aria-hidden />}
          <button type="button" className={`fx-menu__item ${P}__head`} title={`${n.path}${n.why ? `\n${r.label}: ${n.why}` : `\n${r.tip}`}`} onClick={() => pick(k)}>
            <Icon name={fileIcon(n)} size={13} />
            <span className={`${P}__path`}><span className={`${P}__name`}>{baseName(n.rel)}</span>{n.rel !== baseName(n.rel) && <span className={`${P}__dir`}> {n.rel.slice(0, -baseName(n.rel).length - 1)}</span>}</span>
            <span className={`${P}__via is-${(n.reason ?? n.via).replace(/\s+/g, '-')}`} title={r.tip}><Icon name={r.icon} size={11} /> {r.label}</span>
            {n.rules.length > 0 && <span className={`${P}__n`} aria-label={`${n.rules.length} rules`}>{n.rules.length}</span>}
            {folded && kids.length > 0 && <span className={`${P}__more`}>+{kids.length}</span>}
          </button>
        </div>
        {showRules && (
          <ol className={`${P}__rules`}>
            {n.rules.slice(0, s.rules).map((x, j) => <li key={j} className={`${P}__rule is-${x.kind}`} style={{ ['--axp-chain-level' as string]: x.level }}>{x.text}</li>)}
            {s.typing >= 0 && (() => { const x = n.rules[s.typing]!; return (
              <li className={`${P}__rule is-${x.kind} is-typing`} style={{ ['--axp-chain-level' as string]: x.level }}>{x.text.slice(0, s.chars)}<span className={`${P}__caret`} aria-hidden /></li>
            ); })()}
          </ol>
        )}
        {!folded && kids.length > 0 && <ul className={`${P}__kids`} role="group">{kids.map((c) => node(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section className={P} aria-label="Context chain" style={{ ['--axp-chain-scale' as string]: scale / 100 }}>
      <header className={`${P}__bar`}>
        <Icon name="branch" size={14} />
        <strong className={`${P}__title`}>Context chain</strong>
        <span className={`${P}__count`}>{seen.current.size}/{items.length} files · {seenRules}/{totalRules} rules</span>
        <span className="fx-grow" />
        <Segmented size="sm" label="Reveal speed" value={speed} onChange={setSpeed}
          options={[{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'instant', label: 'All' }]} />
        <button type="button" className="fx-iconbtn" title={anyFolded ? 'Open every file' : 'Fold every file'} aria-label={anyFolded ? 'Open every file' : 'Fold every file'} disabled={!parents.length}
          onClick={() => setCollapsed(anyFolded ? new Set() : new Set(parents))}><Icon name={anyFolded ? 'list' : 'minus'} size={13} /></button>
        <button type="button" className="fx-iconbtn" title={paused ? 'Play' : 'Pause'} aria-label={paused ? 'Play' : 'Pause'} disabled={done} onClick={() => setPaused(!paused)}><Icon name={paused ? 'play' : 'pause'} size={13} /></button>
        <button type="button" className="fx-iconbtn" title="Skip to the end" aria-label="Skip to the end" disabled={done} onClick={allDone}><Icon name="arrow-right" size={13} /></button>
      </header>
      <div ref={box} className={`${P}__list`} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {err && !items.length && <p className={`${P}__empty`}>{err}</p>}
        {!err && !items.length && <p className={`${P}__empty`}>Waiting for the session to load its context…</p>}
        {items.length > 0 && <ul className={`${P}__tree`} role="tree" aria-label="Files in load order">{tree.map((n) => node(n, 0))}</ul>}
      </div>
    </section>
  );
}

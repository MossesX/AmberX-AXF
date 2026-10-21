import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRuntime } from '../AxfProvider';
import { Icon } from '../components/Icon';
import type { TerminalLine } from '../../core/terminal';

/**
 * The output terminal pane: every install / import / hot-swap / fallback line, newest at the bottom, auto-scrolling
 * while the user is at the end (scrolling up pauses it; the follow button resumes). Channel chips filter.
 * Rendered as the `terminal` tab kind (floating window / dock) and the `terminal` dialog.
 */
export function OutputTerminalPane({ channel, height }: { channel?: string | null; height?: number | string }) {
  const rt = useRuntime();
  const term = rt.terminal;
  const all = useSyncExternalStore(term.subscribe.bind(term), () => term.lines, () => term.lines);
  const [filter, setFilter] = useState<string | null>(channel ?? null);
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const lines = filter ? all.filter((l) => l.channel === filter) : all;
  useEffect(() => { if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines.length, follow]);
  const onScroll = () => { const el = ref.current; if (!el) return; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 8); };
  return (
    <div className="fx-terminal" style={height ? { height } : undefined}>
      <div className="fx-terminal__bar">
        <button className={`fx-chip ${filter === null ? 'is-selected' : ''}`} onClick={() => setFilter(null)}>all</button>
        {term.channels().map((c) => <button key={c} className={`fx-chip ${filter === c ? 'is-selected' : ''}`} onClick={() => setFilter(c)}>{c}</button>)}
        <span className="fx-tabgroup__spacer" />
        <span className="fx-badge">{lines.length}</span>
        <button className={`fx-iconbtn ${follow ? 'is-active' : ''}`} title={follow ? 'Following output' : 'Resume auto-scroll'} onClick={() => setFollow(true)}><Icon name={follow ? 'chevron-down' : 'pause'} /></button>
        <button className="fx-iconbtn" title="Copy output" onClick={() => navigator.clipboard?.writeText(term.export()).then(() => rt.toast('Terminal output copied.'))}><Icon name="copy" /></button>
        <button className="fx-iconbtn" title="Clear" onClick={() => term.clear()}><Icon name="trash" /></button>
      </div>
      <div className="fx-terminal__lines" ref={ref} onScroll={onScroll}>
        {lines.length === 0 && <div className="fx-muted">— no output yet —</div>}
        {lines.map((l, i) => <TerminalRow key={`${l.at}-${i}`} l={l} />)}
      </div>
    </div>
  );
}

function TerminalRow({ l }: { l: TerminalLine }) {
  const mark = { ok: '✓', warn: '!', error: '✗', note: '·', info: ' ' }[l.level];
  return (
    <div className={`fx-terminal__row is-${l.level}`}>
      <span className="fx-terminal__time">{new Date(l.at).toLocaleTimeString([], { hour12: false })}</span>
      <span className="fx-terminal__chan">[{l.channel}]</span>
      <span className="fx-terminal__text">{mark} {l.text}</span>
    </div>
  );
}

export const terminalDialog = { terminal: { title: 'Output terminal', icon: 'terminal', render: (p: Record<string, unknown>) => <OutputTerminalPane channel={p.channel ? String(p.channel) : null} height={360} /> } };

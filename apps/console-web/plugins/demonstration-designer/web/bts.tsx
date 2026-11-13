/**
 * The behind-the-scenes panel: a scrolling terminal-style window streaming everything a pipeline normally does out of
 * sight (orchestrator decisions, model picks, step splits, agent logs, git, tests, axHub calls, focus moves, errors),
 * one colour per kind, filterable by kind and by words, docked at the bottom, floated in a corner or full screen. It
 * follows the newest line unless you scroll up; Copy puts the shown lines on the clipboard as plain text.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Segmented, TextField } from '@console/axf/react';
import * as P from '../pipelines.mjs';
import type { Dock } from '../pipelines.mjs';
import { pDock, setKinds, setQuery, toggleKind, usePipelines, visibleLines } from './pipeline-model';

const DOCK_OPTS: { value: Dock; label: string; icon: string; title: string }[] = [
  { value: 'dock', label: 'Dock', icon: 'minimize', title: 'Docked along the bottom' },
  { value: 'float', label: 'Float', icon: 'restore', title: 'A floating window in the corner' },
  { value: 'full', label: 'Full', icon: 'maximize', title: 'Full screen' },
];

export function BehindTheScenes() {
  const p = usePipelines();
  const lines = visibleLines(p);
  const box = useRef<HTMLOListElement>(null);
  const [stick, setStick] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const el = box.current; if (el && stick) el.scrollTop = el.scrollHeight; }, [lines.length, stick]);
  const onScroll = () => { const el = box.current; if (el) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24); };
  const copy = () => { void navigator.clipboard?.writeText(lines.map(P.lineText).join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const counts = new Map<string, number>();
  if (p.timeline) for (const e of P.eventsUntil(p.timeline, p.player.at)) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return (
    <section className="axp-demonstration-designer-bts" data-dock={p.player.dock} aria-label="Behind the scenes">
      <header className="axp-demonstration-designer-bts__head">
        <strong className="axp-demonstration-designer-bts__title">Behind the scenes</strong>
        <span className="fx-muted">{lines.length} line{lines.length === 1 ? '' : 's'}{p.kinds.length || p.q ? ' (filtered)' : ''}</span>
        <div role="toolbar" aria-label="Behind the scenes tools" className="axp-demonstration-designer-bts__tools">
          <TextField label="Filter words" value={p.q} onChange={setQuery} placeholder="git push, Fable, ✗…" className="axp-demonstration-designer-bts__q" />
          <Segmented<Dock> label="Where the panel sits" size="sm" value={p.player.dock} onChange={pDock} options={DOCK_OPTS} />
          <Button size="sm" icon={copied ? 'check' : 'copy'} aria-label="Copy the lines" onClick={copy} />
        </div>
      </header>
      <div role="toolbar" aria-label="Show these kinds" className="axp-demonstration-designer-bts__kinds">
        <Button size="sm" tone={p.kinds.length ? 'ghost' : 'primary'} aria-pressed={!p.kinds.length} onClick={() => setKinds([])}>All</Button>
        {P.EVENT_KINDS.map((k) => (
          <Button key={k.id} size="sm" tone={p.kinds.includes(k.id) ? 'primary' : 'ghost'} aria-pressed={p.kinds.includes(k.id)} onClick={() => toggleKind(k.id)} data-kind={k.id} className="axp-demonstration-designer-bts__kind">{k.label}{counts.get(k.id) ? ` ${counts.get(k.id)}` : ''}</Button>
        ))}
      </div>
      <ol ref={box} className="axp-demonstration-designer-bts__lines fx-mono" aria-label="Output" aria-live="off" onScroll={onScroll} tabIndex={0}>
        {lines.map((e, n) => (
          <li key={`${e.t}-${n}`} data-kind={e.kind} className="axp-demonstration-designer-bts__line">
            <span className="axp-demonstration-designer-bts__t">{P.clock(e.t)}</span>
            <span className="axp-demonstration-designer-bts__k">{e.kind}</span>
            <span className="axp-demonstration-designer-bts__x">{e.text}</span>
            {e.source && <span className="axp-demonstration-designer-bts__src">live · {e.source}</span>}
          </li>
        ))}
        {!lines.length && <li className="fx-muted axp-demonstration-designer-bts__line">{p.timeline ? 'Nothing yet: lines appear as the demo plays.' : 'Play a pipeline demo to see what happens behind the scenes.'}</li>}
      </ol>
      {!stick && <Button size="sm" icon="chevron-down" className="axp-demonstration-designer-bts__jump" onClick={() => setStick(true)}>Newest</Button>}
    </section>
  );
}

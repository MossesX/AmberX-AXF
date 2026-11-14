/**
 * Drawn over the whole console (slot app.frame.cover) while a pipeline demo plays, so it stays up as the console moves
 * from screen to screen: the walkthrough bar (the narrated chapter, its caption, chapter dots you can jump to, pause,
 * back, skip, restart, speed, stop) and the behind-the-scenes panel (bts.tsx). The chapter's words are spoken by the
 * device voice unless muted. The player state is reported to the server so the API can read it (GET pipeline/state).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Segmented } from '@console/axf/react';
import * as P from '../pipelines.mjs';
import { api } from './model';
import { BehindTheScenes } from './bts';
import { pChapter, pNext, pPrev, pRestart, pSpeed, pStop, pToggle, pipelineState, setPanel, usePipelines } from './pipeline-model';

const SPEED_OPTS = P.SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));

function speak(text: string, rate: number) {
  try {
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.min(2, Math.max(0.5, rate));
    synth.speak(u);
  } catch { /* no speech here */ }
}

/** Keep the server's copy of the player state current: on a change of status, chapter, dock or filter, and every 5 demo seconds. */
function useReportState() {
  const p = usePipelines();
  const sent = useRef('');
  useEffect(() => {
    const s = pipelineState();
    const key = JSON.stringify({ ...s, at: Math.floor(s.at / 5), lines: Math.floor(s.lines / 10) });
    if (key === sent.current) return;
    sent.current = key;
    void api.post('pipeline/state', s).catch(() => { /* the server is optional for playing */ });
  }, [p]);
}

export function PipelineCover() {
  const p = usePipelines();
  const [muted, setMuted] = useState(false);
  const spoken = useRef(-1);
  useReportState();
  const tl = p.timeline;
  const active = !!tl && p.player.status !== 'idle';
  const i = tl ? P.chapterAt(tl, p.player.at) : -1;
  const c = tl && i >= 0 ? tl.chapters[i] : undefined;
  useEffect(() => {
    if (!active) { spoken.current = -1; speak('', 1); return; }
    if (p.player.status !== 'playing') { try { globalThis.speechSynthesis?.pause(); } catch { /* none */ } return; }
    try { globalThis.speechSynthesis?.resume(); } catch { /* none */ }
    if (i !== spoken.current) { spoken.current = i; if (!muted) speak(c?.say ?? '', p.player.speed); }
  }, [active, i, p.player.status, muted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === ' ' && e.shiftKey) { e.preventDefault(); pToggle(); }
      else if (e.key === 'ArrowRight' && e.shiftKey) pNext();
      else if (e.key === 'ArrowLeft' && e.shiftKey) pPrev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
  if (!active || !tl || !p.demo) return null;
  const pct = tl.total ? (p.player.at / tl.total) * 100 : 0;
  const done = p.player.status === 'done';
  return (
    <div className="axp-demonstration-designer-cover" data-dock={p.player.dock} data-panel={p.panel ? 'on' : 'off'}>
      <section className="axp-demonstration-designer-walk" aria-label={`Walkthrough: ${p.demo.name}`} aria-live="polite">
        <div className="axp-demonstration-designer-walk__progress" style={{ inlineSize: `${pct}%` }} />
        <div className="axp-demonstration-designer-walk__body">
          <p className="fx-eyebrow">{p.demo.name} · chapter {i + 1} of {tl.chapters.length} · {P.clock(p.player.at)} / {P.clock(tl.total)}{p.recordedAt ? ' · recorded live run' : ' · scripted replay'}{done ? ' · finished' : p.player.status === 'paused' ? ' · paused' : ''}</p>
          <strong className="axp-demonstration-designer-walk__title">{c?.title}</strong>
          <p className="axp-demonstration-designer-walk__say">{c?.say}</p>
          {p.note && <p className="fx-muted axp-demonstration-designer-walk__note">{p.note}</p>}
        </div>
        <ol className="axp-demonstration-designer-walk__dots" aria-label="Chapters">
          {tl.chapters.map((ch) => (
            <li key={ch.id}><button type="button" data-fx-row data-axf-target={`demonstration-designer.walk.chapter.${ch.index + 1}`} className={`axp-demonstration-designer-walk__dot${ch.index === i ? ' is-on' : ch.index < i ? ' is-past' : ''}`} aria-current={ch.index === i ? 'step' : undefined} title={`${ch.index + 1}. ${ch.title}${ch.view ? ` · ${P.screenLabel(ch.view)}` : ''}`} onClick={() => pChapter(ch.index)}><span>{ch.index + 1}</span></button></li>
          ))}
        </ol>
        <div role="toolbar" aria-label="Walkthrough controls" className="axp-demonstration-designer-walk__bar">
          <Button size="sm" icon="chevron-left" aria-label="Previous chapter" onClick={pPrev} />
          <Button size="sm" tone="primary" icon={p.player.status === 'playing' ? 'pause' : 'play'} aria-label={p.player.status === 'playing' ? 'Pause' : done ? 'Play again' : 'Play'} onClick={done ? pRestart : pToggle} />
          <Button size="sm" icon="chevron-right" aria-label="Skip to the next chapter" onClick={pNext} />
          <Button size="sm" icon="refresh" aria-label="Restart" onClick={pRestart} />
          <Segmented<string> label="Speed" size="sm" value={String(p.player.speed)} onChange={(v) => pSpeed(Number(v))} options={SPEED_OPTS} />
          <Button size="sm" icon={muted ? 'x-circle' : 'mic'} aria-pressed={!muted} aria-label={muted ? 'Narration off' : 'Narration on'} onClick={() => { setMuted(!muted); if (!muted) speak('', 1); }} />
          <Button size="sm" icon="terminal" aria-pressed={p.panel} aria-label={p.panel ? 'Hide behind the scenes' : 'Show behind the scenes'} onClick={() => setPanel(!p.panel)} />
          <Button size="sm" icon="x" aria-label="Stop the demo" onClick={() => { speak('', 1); pStop(); }} />
        </div>
      </section>
      {p.panel && <BehindTheScenes />}
    </div>
  );
}

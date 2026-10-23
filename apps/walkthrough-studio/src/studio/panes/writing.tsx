/** Writing panes: Script (narration + cue track of the selected piece) and the Review queue. */
import { Button, Icon, IconButton, Meter, useRuntime } from '../../axf/react';
import { CUE_KINDS, autoProgress, cueSec, estimateSec, fmtDur, narrationSec, orderedPieces, pathOf, uid, updatePiece, words, type Cue, type Piece } from '../model';
import { studio, useStudio } from '../store';
import { StatusChip } from './outline';

/** speak text with the browser's voice (the compiler's narrator), using the project's voice, rate and pitch */
export function speak(text: string, s: { voice: string; rate: number; pitch: number }, onEnd?: () => void): boolean {
  const synth = globalThis.speechSynthesis;
  if (!synth || !text.trim()) { onEnd?.(); return false; }
  const u = new SpeechSynthesisUtterance(text);
  const v = synth.getVoices().find((x) => x.name === s.voice);
  if (v) u.voice = v;
  u.rate = s.rate; u.pitch = s.pitch;
  u.onend = () => onEnd?.(); u.onerror = () => onEnd?.();
  synth.speak(u);
  return true;
}
export const hush = () => globalThis.speechSynthesis?.cancel();

export function ScriptPane() {
  const project = useStudio((s) => s.project)!;
  const id = useStudio((s) => s.selection.piece);
  const p = id ? project.pieces[id] : undefined;
  if (!p) return <p className="fx-muted ws-pad">Pick a piece to write its narration and cues.</p>;
  const set = (patch: Partial<Piece>, label: string) => studio().edit(label, (q) => updatePiece(q, p.id, patch));
  const setCue = (i: number, patch: Partial<Cue>) => set({ cues: p.cues.map((c, k) => (k === i ? { ...c, ...patch } : c)) }, `cue:${p.id}:${i}`);
  const move = (i: number, d: number) => { const c = [...p.cues]; const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j]!, c[i]!]; set({ cues: c }, 'Move cue'); };
  const nSec = narrationSec(p, project.settings), cSec = cueSec(p), est = estimateSec(p, project.settings);
  const tgt = p.targetSec || project.settings.pieceTargetSec;
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <div className="ws-col ws-grow">
          <strong className="ws-ellipsis">{p.title}</strong>
          <span className="fx-small fx-muted ws-ellipsis">{pathOf(project.root, p.id).map((s) => s.title).join(' › ')}</span>
        </div>
        <StatusChip s={p.status} />
      </div>
      <div className="ws-pane__scroll ws-pad fx-stack">
        <label className="fx-field">
          <span className="fx-field__label">Narration</span>
          <textarea className="fx-input ws-script" rows={8} value={p.narration} onChange={(e) => set({ narration: e.target.value }, `narr:${p.id}`)} placeholder="What the narrator says while this piece plays." />
        </label>
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="play" onClick={() => speak(p.narration, project.settings)}>Speak it</Button>
          <Button size="sm" tone="quiet" icon="pause" onClick={hush}>Stop</Button>
          <span className="fx-small fx-muted">{words(p.narration)} words · voice ~{fmtDur(nSec)} · cues {fmtDur(cSec)} · piece ~{fmtDur(est)}{tgt ? ` / target ${fmtDur(tgt)}` : ''}</span>
        </div>
        {tgt > 0 && <Meter value={Math.min(100, (est / tgt) * 100)} done={est <= tgt} label={`${Math.round((est / tgt) * 100)}% of the target length`} />}
        <label className="fx-field">
          <span className="fx-field__label">Show the effect</span>
          <input className="fx-input" value={p.effect ?? ''} onChange={(e) => set({ effect: e.target.value }, `fx:${p.id}`)} placeholder="Change X and watch Y happen" />
        </label>
        <div className="ws-cues">
          <div className="fx-row"><strong>Cue track</strong><span className="fx-grow" /><span className="fx-small fx-muted">what the cursor does while the narration plays</span></div>
          {p.cues.map((c, i) => (
            <div key={c.id} className="ws-cue" data-fx-ctx-target="ws-cue" data-fx-ctx-payload={`${p.id}#${i}`}>
              <span className="fx-small fx-muted ws-cue__n">{i + 1}</span>
              <select className="fx-input" value={c.kind} onChange={(e) => setCue(i, { kind: e.target.value as Cue['kind'] })} aria-label="Cue kind">
                {CUE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
              <input className="fx-input ws-grow" value={c.target ?? ''} placeholder={c.kind === 'navigate' ? '—' : 'target (selector or words)'} onChange={(e) => setCue(i, { target: e.target.value })} aria-label="Target" />
              <input className="fx-input ws-grow" value={c.text ?? ''} placeholder={c.kind === 'navigate' ? 'https://…' : c.kind === 'type' ? 'text to type' : c.kind === 'say' ? 'caption' : 'text'} onChange={(e) => setCue(i, { text: e.target.value })} aria-label="Text" />
              <input className="fx-input ws-cue__dur" type="number" min={0} step={0.1} value={c.dur} onChange={(e) => setCue(i, { dur: Number(e.target.value) || 0 })} aria-label="Seconds" />
              <IconButton icon="chevron-up" label="Earlier" onClick={() => move(i, -1)} />
              <IconButton icon="chevron-down" label="Later" onClick={() => move(i, 1)} />
              <IconButton icon="trash" label="Remove cue" onClick={() => set({ cues: p.cues.filter((_, k) => k !== i) }, 'Remove cue')} />
            </div>
          ))}
          <div className="fx-row fx-row--wrap">
            {CUE_KINDS.map((k) => <Button key={k.id} size="sm" tone="quiet" icon={k.icon} onClick={() => set({ cues: [...p.cues, { id: uid('c'), kind: k.id, dur: k.defaultDur }] }, 'Add cue')}>{k.label}</Button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReviewPane() {
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const list = orderedPieces(project).filter((p) => p.status === 'review' || p.status === 'failed' || p.status === 'partial' || (!p.narration.trim() && p.status !== 'skipped'));
  const groups: [string, typeof list][] = [
    ['Needs review', list.filter((p) => p.status === 'review')],
    ['Failed', list.filter((p) => p.status === 'failed')],
    ['Partial', list.filter((p) => p.status === 'partial')],
    ['No narration', list.filter((p) => !p.narration.trim() && !['review', 'failed', 'partial'].includes(p.status))],
  ];
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      {groups.map(([title, ps]) => ps.length > 0 && (
        <section key={title} className="fx-stack">
          <h3 className="ws-h">{title} <span className="fx-small fx-muted">{ps.length}</span></h3>
          {ps.map((p) => (
            <div key={p.id} className="ws-row" data-fx-ctx-target="ws-piece" data-fx-ctx-payload={p.id}>
              <button type="button" data-fx-row className="ws-grow ws-col" onClick={() => studio().select({ piece: p.id, section: null })}>
                <strong className="ws-ellipsis">{p.title}</strong>
                <span className="fx-small fx-muted">{autoProgress(p)}% · {p.notes || pathOf(project.root, p.id).map((s) => s.title).join(' › ')}</span>
              </button>
              <IconButton icon="check" label="Mark built" onClick={() => { studio().select({ piece: p.id }); rt.dispatch('ws.status:built'); }} />
            </div>
          ))}
        </section>
      ))}
      {!list.length && <p className="fx-muted"><Icon name="check-circle" size={14} /> Nothing waiting for review.</p>}
    </div>
  );
}

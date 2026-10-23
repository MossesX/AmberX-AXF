/** Project panes: Dashboard, Project settings, Trash and Log. */
import { useEffect, useState } from 'react';
import { Button, Gauge, Icon, Meter, SelectField, Slider, Switch, TextField } from '../../axf/react';
import { STATUSES, fmtDur, parseDur, restoreTrash, totals, type PieceStatus, type ProjectSettings } from '../model';
import { studio, useStudio } from '../store';
import { speak } from './writing';

export function DashboardPane() {
  const prj = useStudio((s) => s.project)!;
  const tt = totals(prj);
  const target = prj.settings.targetSec;
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      <div className="ws-gauges">
        <Gauge label="Built" value={tt.progress} max={100} unit="%" integer />
        <Gauge label={target ? 'Of target length' : 'Length (min)'} value={target ? (tt.est / target) * 100 : tt.est / 60} max={target ? 150 : Math.max(60, Math.ceil(tt.est / 600) * 10)} unit={target ? '%' : ''} integer />
        <Gauge label="Recorded (min)" value={tt.clip / 60} max={Math.max(1, tt.est / 60)} />
      </div>
      <dl className="ws-dl">
        <dt>Pieces</dt><dd>{tt.pieces}</dd>
        <dt>Estimated length</dt><dd>{fmtDur(tt.est)}</dd>
        <dt>Desired length</dt><dd>{target ? fmtDur(target) : 'no limit'}</dd>
        <dt>Recorded</dt><dd>{fmtDur(tt.clip)}</dd>
        <dt>Last compile</dt><dd>{prj.compiled ? `${fmtDur(prj.compiled.durationSec)} · ${new Date(prj.compiled.at).toLocaleString()}` : 'never'}</dd>
      </dl>
      <h3 className="ws-h">By status</h3>
      {STATUSES.map((s) => (
        <div key={s.id} className="ws-statbar">
          <span className={`ws-dot ws-tone--${s.tone}`} /><span className="ws-statbar__label">{s.label}</span>
          <span className="ws-grow"><Meter value={tt.pieces ? (tt.byStatus[s.id] / tt.pieces) * 100 : 0} small done={s.id === 'built'} label={`${tt.byStatus[s.id]} ${s.label}`} /></span>
          <span className="fx-small fx-mono">{tt.byStatus[s.id]}</span>
        </div>
      ))}
      <h3 className="ws-h">By chapter</h3>
      {prj.root.children.map((sec) => {
        const st = totals(prj, sec);
        return (
          <div key={sec.id} className="ws-statbar">
            <Icon name={sec.icon ?? 'folder'} size={13} /><span className="ws-statbar__label ws-ellipsis">{sec.title}</span>
            <span className="ws-grow"><Meter value={st.progress} small done={st.progress >= 100} label={`${Math.round(st.progress)}%`} /></span>
            <span className="fx-small fx-mono">{fmtDur(st.est)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DurInput({ label, sec, onChange, hint }: { label: string; sec: number; onChange: (n: number) => void; hint: string }) {
  const [txt, setTxt] = useState(sec ? fmtDur(sec) : '');
  useEffect(() => setTxt(sec ? fmtDur(sec) : ''), [sec]);
  return <TextField label={label} value={txt} placeholder="no limit" hint={hint} onChange={(v) => { setTxt(v); onChange(parseDur(v)); }} />;
}

export function SettingsPane() {
  const prj = useStudio((s) => s.project)!;
  const s = prj.settings;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(globalThis.speechSynthesis?.getVoices() ?? []);
    load(); globalThis.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => globalThis.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);
  const set = (patch: Partial<ProjectSettings>, label = 'Project settings') => studio().edit(label, (p) => ({ ...p, settings: { ...p.settings, ...patch }, compiled: undefined }));
  const tt = totals(prj);
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      <TextField label="Project name" value={prj.name} onChange={(v) => studio().edit('pname', (p) => ({ ...p, name: v, root: { ...p.root, title: v } }))} />
      <TextField label="Description" rows={2} value={prj.description} onChange={(v) => studio().edit('pdesc', (p) => ({ ...p, description: v }))} />
      <h3 className="ws-h">Length</h3>
      <DurInput label="Desired length of the video" sec={s.targetSec} onChange={(n) => set({ targetSec: n }, 'target')} hint={`No limit when empty. Now ~${fmtDur(tt.est)}. Try 45:00, 1h30m, 5400.`} />
      <DurInput label="Desired length of each piece" sec={s.pieceTargetSec} onChange={(n) => set({ pieceTargetSec: n }, 'ptarget')} hint="Default for pieces without their own; no limit when empty." />
      <Slider label="Pause between pieces" value={s.gapSec} min={0} max={5} step={0.1} unit=" s" onChange={(v) => set({ gapSec: v }, 'gap')} />
      <h3 className="ws-h">Narrator</h3>
      <SelectField label="Voice" value={s.voice} empty="Browser default" options={voices.map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` }))} onChange={(v) => set({ voice: v })} hint="The compiler narrates with this voice in the preview; the brief names it for the final render." />
      <Slider label="Speaking speed" value={s.wpm} min={90} max={220} unit=" wpm" onChange={(v) => set({ wpm: v }, 'wpm')} />
      <Slider label="Voice rate" value={s.rate} min={0.5} max={2} step={0.05} unit="×" onChange={(v) => set({ rate: v }, 'rate')} />
      <Slider label="Voice pitch" value={s.pitch} min={0} max={2} step={0.05} onChange={(v) => set({ pitch: v }, 'pitch')} />
      <Button size="sm" icon="play" onClick={() => speak('This is how the narrator sounds in the AmberX AXF walkthrough.', s)}>Try the voice</Button>
      <h3 className="ws-h">Picture</h3>
      <div className="ws-2col">
        <SelectField label="Resolution" value={s.resolution} options={['1280x720', '1920x1080', '2560x1440', '1080x1920'].map((r) => ({ value: r, label: r === '1080x1920' ? '1080×1920 (phone, tall)' : r.replace('x', '×') }))} onChange={(v) => set({ resolution: v as ProjectSettings['resolution'] })} />
        <SelectField label="Frame rate" value={String(s.fps)} options={['24', '30', '60'].map((f) => ({ value: f, label: `${f} fps` }))} onChange={(v) => set({ fps: Number(v) as ProjectSettings['fps'] })} />
        <SelectField label="Transition" value={s.transition} options={[{ value: 'cut', label: 'Cut' }, { value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'zoom', label: 'Zoom' }]} onChange={(v) => set({ transition: v as ProjectSettings['transition'] })} />
        <SelectField label="Cursor" value={s.cursor} options={[{ value: 'arrow', label: 'Arrow' }, { value: 'dot', label: 'Dot' }, { value: 'ring', label: 'Ring' }]} onChange={(v) => set({ cursor: v as ProjectSettings['cursor'] })} />
      </div>
      <Switch label="Captions" checked={s.captions} onChange={(v) => set({ captions: v })} hint="Burned-in caption lines in the preview, plus SRT / VTT exports." />
      <Switch label="Title and chapter cards" checked={s.chapterCards} onChange={(v) => set({ chapterCards: v })} hint="A 4 s title card and a 3 s card before every top-level section." />
      <Switch label="Click ripples" checked={s.clickRipple} onChange={(v) => set({ clickRipple: v })} />
      <h3 className="ws-h">Leave out of the video</h3>
      <div className="fx-row fx-row--wrap">
        {STATUSES.map((st) => {
          const on = s.skipStatuses.includes(st.id);
          return <button key={st.id} type="button" className={`fx-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set({ skipStatuses: on ? s.skipStatuses.filter((x) => x !== st.id) : [...s.skipStatuses, st.id as PieceStatus] })}><span className={`ws-dot ws-tone--${st.tone}`} />{st.label}</button>;
        })}
      </div>
    </div>
  );
}

export function TrashPane() {
  const prj = useStudio((s) => s.project)!;
  if (!prj.trash.length) return <p className="fx-muted ws-pad"><Icon name="trash" size={14} /> The trash is empty. Drag anything onto the trash can that pops up while dragging.</p>;
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      <Button size="sm" tone="danger" icon="trash" onClick={() => studio().edit('Empty trash', (p) => ({ ...p, trash: [] }))}>Empty the trash</Button>
      {prj.trash.map((e, i) => (
        <div key={`${e.at}-${i}`} className="ws-row">
          <Icon name={e.kind === 'piece' ? 'file' : 'folder'} size={14} />
          <div className="ws-grow ws-col"><strong className="ws-ellipsis">{e.piece?.title ?? e.section?.title}</strong><span className="fx-small fx-muted">{e.kind}{e.pieces ? ` · ${e.pieces.length} pieces` : ''} · {new Date(e.at).toLocaleString()}</span></div>
          <Button size="sm" icon="undo" onClick={() => studio().edit('Restore', (p) => restoreTrash(p, i))}>Restore</Button>
        </div>
      ))}
    </div>
  );
}

export function LogPane() {
  const log = useStudio((s) => s.log);
  return (
    <div className="ws-pane__scroll fx-terminal ws-log">
      {log.length === 0 && <p className="fx-muted ws-pad">Nothing yet.</p>}
      {[...log].reverse().map((l, i) => <div key={i} className={`ws-log__line ws-tone-text--${l.level === 'ok' ? 'success' : l.level === 'warn' ? 'warning' : l.level === 'error' ? 'danger' : 'muted'}`}><span className="fx-mono fx-small">{new Date(l.at).toLocaleTimeString()}</span> {l.text}</div>)}
    </div>
  );
}

/**
 * Edit the voice (Nov 1 2026, Brett: "Wanna be able to edit voice"): pick Amber's voice and speed and rewrite any line she
 * says, scene by scene, then Re-voice. The edits (walkthrough-voice@1: only what differs from the script) are saved on
 * axHub (table `voice` in the `walkthrough` folder, one row per walkthrough) and sent to the AmberX server's render route,
 * which hands them to the console as one veto call on axHub. Re-voice redoes only the changed clips and re-cuts the video
 * from the last recording (minutes); Re-record runs the whole recording again (needed when what's shown should change).
 * The script comes from the published script.json. Controls are the framework's; layout only in walkthrough.css.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Note, SelectField, Slider, TextField } from '../../../axf/react';
import { HubData, type Row } from '../../../axf/libs/hubstore';
import { HUB } from '../../../hub/useHub';
import { SPEED_RANGE, VOICES, VOICE_FORMAT, WALKTHROUGH_BASE, editCount, editsOf, normalizeEdits, parseScript, type Edits, type ScriptDoc } from './core';

const HUB_PROJECT = 'amberx-axf';
let table: ReturnType<HubData['table']> | null = null;
function voiceTable() {
  if (!table) table = new HubData({ hub: HUB, project: HUB_PROJECT, folder: 'walkthrough', mode: 'all', appId: 'ai.amberx.amberx.walkthrough' }).table('voice');
  return table;
}

type Load = { phase: 'loading' } | { phase: 'ready'; script: ScriptDoc | null; saved: Edits | null } | { phase: 'error'; message: string };

function useScript(id: string, base: string): Load {
  const [s, set] = useState<Load>({ phase: 'loading' });
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`${WALKTHROUGH_BASE}${base}script.json`, { credentials: 'include', cache: 'no-cache' }).catch(() => null);
      const script = r?.ok ? parseScript(await r.json().catch(() => null)) : null;
      let saved: Edits | null = null;
      try { const rows = await voiceTable().rows(); if (rows[id]) saved = normalizeEdits(rows[id]); } catch { /* not on the hub yet: the script's own edits */ }
      if (live) set({ phase: 'ready', script, saved });
    })().catch((e) => live && set({ phase: 'error', message: (e as Error).message }));
    return () => { live = false; };
  }, [id, base]);
  return s;
}

type Msg = { tone: 'info' | 'success' | 'danger'; text: string } | null;

export function VoiceEditor({ id, base }: { id: string; base: string }) {
  const s = useScript(id, base);
  if (s.phase === 'loading') return <div className="axp-walkthrough__skeleton" aria-busy="true" aria-label="Loading the script" />;
  if (s.phase === 'error') return <p className="fx-muted" role="alert">{s.message}</p>;
  return <Editor id={id} script={s.script} saved={s.saved} />;
}

function Editor({ id, script, saved }: { id: string; script: ScriptDoc | null; saved: Edits | null }) {
  const start = saved ?? script?.edits ?? { voice: null, speed: null, lines: {} };
  const [voice, setVoice] = useState(start.voice ?? script?.voice ?? VOICES[0]!.id);
  const [speed, setSpeed] = useState(start.speed ?? script?.speed ?? 1);
  const [drafts, setDrafts] = useState<Record<string, string>>(start.lines);
  const [open, setOpen] = useState<string | null>(script?.chapters[0]?.id ?? null);
  const [busy, setBusy] = useState<'' | 'save' | 'voice' | 'record'>('');
  const [msg, setMsg] = useState<Msg>(null);
  const edits = useMemo<Edits>(() => (script ? editsOf(script, voice, speed, drafts) : normalizeEdits({ voice, speed, lines: {} })), [script, voice, speed, drafts]);
  const n = editCount(edits);

  const save = async () => {
    await voiceTable().put(id, { $axf: VOICE_FORMAT, ...edits, updatedAt: new Date().toISOString() } as unknown as Row);
  };
  const run = async (kind: 'save' | 'voice' | 'record') => {
    setBusy(kind); setMsg(null);
    try {
      await save();
      if (kind === 'save') { setMsg({ tone: 'success', text: 'Saved on axHub. Re-voice to hear it.' }); return; }
      const r = await fetch(`${WALKTHROUGH_BASE}${id}/render`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voiceOnly: kind === 'voice', overrides: edits }),
      });
      const j = await r.json().catch(() => ({})) as { detail?: string; message?: string };
      if (!r.ok) throw new Error(j.detail || `The server answered ${r.status}.`);
      setMsg({ tone: 'success', text: j.message || (kind === 'voice'
        ? 'Sent to axHub as a veto call. It runs when the countdown ends unless you deny it; the new video is up a few minutes later.'
        : 'Sent to axHub as a veto call. A full re-record takes a while; the new video replaces this one when it is done.') });
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally { setBusy(''); }
  };
  const setLine = (key: string, v: string) => setDrafts((d) => ({ ...d, [key]: v }));
  const reset = (key: string) => setDrafts((d) => { const { [key]: _gone, ...rest } = d; return rest; });

  return (
    <div className="fx-stack fx-stack--lg axp-walkthrough__voice">
      <div className="axp-walkthrough__voicebar">
        <SelectField label="Voice" value={voice} onChange={setVoice} options={VOICES.map((v) => ({ value: v.id, label: v.label }))} />
        <Slider label="Speed" value={Math.round(speed * 100)} min={SPEED_RANGE.min * 100} max={SPEED_RANGE.max * 100} step={SPEED_RANGE.step * 100} unit="%"
          onChange={(v) => setSpeed(Math.round(v) / 100)} />
      </div>
      <div className="fx-row fx-row--wrap">
        <Chip tone={n ? 'accent' : undefined}>{n ? `${n} change${n === 1 ? '' : 's'}` : 'No changes'}</Chip>
        <Button icon="check" busy={busy === 'save'} disabled={!!busy} onClick={() => void run('save')}>Save</Button>
        <Button icon="refresh" tone="primary" busy={busy === 'voice'} disabled={!!busy || !script} onClick={() => void run('voice')}>Re-voice</Button>
        <Button icon="play" busy={busy === 'record'} disabled={!!busy} confirm="Record the whole walkthrough again? It takes a while on the server." onClick={() => void run('record')}>Re-record</Button>
      </div>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      {!script && <Note tone="info">The words show up here once this walkthrough has been recorded. You can still pick the voice and speed, then Re-record.</Note>}
      {script && (
        <nav className="axp-walkthrough__index axp-walkthrough__script" aria-label="Narration by chapter">
          {script.chapters.map((c, ci) => {
            const changed = c.scenes.filter((x) => edits.lines[x.key]).length;
            return (
              <div key={c.id} className="axp-walkthrough__chapter">
                <div className="fx-row axp-walkthrough__chapterhead">
                  <button type="button" data-fx-row className="axp-walkthrough__jump" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <span>{ci + 1}. {c.title}</span>
                    {changed > 0 && <span className="fx-muted">{changed} edited</span>}
                  </button>
                </div>
                {open === c.id && (
                  <div className="fx-stack axp-walkthrough__lines">
                    {c.scenes.map((x, i) => (
                      <div key={x.key} className="fx-stack axp-walkthrough__line">
                        <TextField label={`Scene ${i + 1}${edits.lines[x.key] ? ' · edited' : ''}`} rows={3} value={drafts[x.key] ?? x.say} onChange={(v) => setLine(x.key, v.slice(0, 400))} />
                        {edits.lines[x.key] && <div className="fx-row"><Button tone="quiet" size="sm" icon="undo" onClick={() => reset(x.key)}>Back to the script</Button></div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      )}
    </div>
  );
}

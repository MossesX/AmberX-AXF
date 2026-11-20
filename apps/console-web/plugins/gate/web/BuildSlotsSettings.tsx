/**
 * Settings → Plugins → Gate → Builds at once (a panel in the Gate sub-tab: the settings library draws the tab's level
 * toolbar above it). Two numbers side by side, each with its live value: how many steps of one build run at once
 * (pipeline-settings@1 stepsInParallel) and how many builds the VPS runs at all (build-limit@1 maxBuilds, the host cap).
 * Read and saved through GET / PUT /api/plugins/gate/build-slots, the same call as MCP (gate_build_slots,
 * gate_build_slots_set); each number is saved by its owner, so the host cap stays Brett's own signed-in click and is
 * read-only for everyone else.
 */
import { useEffect, useState } from 'react';
import { Button, Note, TextField, useRuntime } from '@console/axf/react';
import { gateCall } from './api';
import { patchOf, previewOver, type BuildSlots, type SlotDraft } from './build-slots-core.mjs';

export function BuildSlotsSettings() {
  const rt = useRuntime();
  const [cur, setCur] = useState<BuildSlots | null>(null);
  const [draft, setDraft] = useState<SlotDraft>({ steps: '', cap: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fill = (s: BuildSlots) => { setCur(s); setDraft({ steps: String(s.stepsInParallel.value ?? ''), cap: String(s.hostCap.value ?? '') }); };
  useEffect(() => { void gateCall<BuildSlots>('build-slots').then(fill, (e: Error) => setError(e.message)); }, []);
  if (!cur) return error ? <p className="axp-gate__err" role="alert">{error}</p> : <p className="axp-gate__sub">Loading…</p>;
  const steps = cur.stepsInParallel; const cap = cur.hostCap;
  const { patch, errors } = patchOf(cur, draft);
  const changed = Object.keys(patch).length > 0 && !errors.steps && !errors.cap;
  const note = previewOver(cur, draft);
  const save = async () => {
    setBusy(true); setError('');
    try { fill(await gateCall<BuildSlots>('build-slots', 'PUT', patch)); rt.toast('Saved.', 'success', 'Gate'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const capHint = !cap.available ? cap.why
    : cap.canEdit ? `The most builds the VPS runs at once, whoever asks. Now ${cap.value}${typeof cap.live === 'number' ? `, ${cap.live} running` : ''}.`
      : `Now ${cap.value}${typeof cap.live === 'number' ? `, ${cap.live} running` : ''}. Only Brett changes it, from his own signed-in console.`;
  return (
    <div className="axp-gate__fields" data-axf-anchor="gate-build-slots">
      <div className="axp-gate__pair">
        <TextField label="Steps in parallel" type="number" value={draft.steps} onChange={(v) => setDraft((d) => ({ ...d, steps: v }))} disabled={!steps.available} error={errors.steps}
          hint={steps.available ? `Steps of one build that run at once (${steps.min} to ${steps.max}). Now ${steps.value}.` : steps.why} />
        <TextField label="Host cap" type="number" value={draft.cap} onChange={(v) => setDraft((d) => ({ ...d, cap: v }))} disabled={!cap.available || !cap.canEdit} error={errors.cap} hint={capHint} />
      </div>
      {note && <Note tone="warning">{note}</Note>}
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <div className="axp-gate__bar"><Button id="gate-build-slots-save" tone="primary" icon="save" busy={busy} disabled={!changed} onClick={() => void save()}>Save</Button></div>
    </div>
  );
}

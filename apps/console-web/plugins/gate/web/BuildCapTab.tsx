/**
 * VPS Configuration → Build cap: the host hard cap, the emergency slots and the orchestrator's steps in parallel side
 * by side, with what runs now and a plain note when the numbers disagree. Reads GET build-cap and writes POST
 * build-cap (the real settings: framework/cli/build-limit.mjs and the pipeline settings). The hard cap and the
 * emergency slots stay Brett's: disabled with the reason unless his own signed-in session is looking.
 * console-control@1: `tab:gate.tabs=build-cap`, `setting:vps.buildCap.maxBuilds | emergencySlots | stepsInParallel`
 * (buildCapState.ts), buttons `button:vps-cap-save | vps-cap-reset | vps-cap-refresh`; actions `vps.build-cap.open |
 * status | set:<key>:<n>`.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, TextField, useRuntime } from '@console/axf/react';
import { CAP_FIELDS, OWNER_ONLY, cachedBuildCap, loadBuildCap, onBuildCap, saveBuildCap, type BuildCap, type CapKey } from './buildCapState';

const draftOf = (c: BuildCap) => Object.fromEntries(CAP_FIELDS.map((f) => [f.key, String(f.read(c) ?? '')])) as Record<CapKey, string>;

export function BuildCapTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const [cur, setCur] = useState<BuildCap | null>(cachedBuildCap);
  const [draft, setDraft] = useState<Record<CapKey, string> | null>(() => { const c = cachedBuildCap(); return c ? draftOf(c) : null; });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // a fresh read fills the fields it is not holding an unsaved edit for
  useEffect(() => onBuildCap((c) => {
    setCur((old) => { setDraft((d) => (d && old ? Object.fromEntries(CAP_FIELDS.map((f) => [f.key, d[f.key] === String(f.read(old) ?? '') ? String(f.read(c) ?? '') : d[f.key]])) as Record<CapKey, string> : draftOf(c))); return c; });
  }), []);
  const reload = async () => { try { await loadBuildCap(); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => {
    void reload();
    const t = window.setInterval(() => { if (!document.hidden) void reload(); }, Math.max(5, refreshSec) * 1000);
    return () => window.clearInterval(t);
  }, [refreshSec]);

  const locked = (key: CapKey) => !!cur && cur.ownerOnly.includes(key) && !cur.canEdit;
  const bad = (key: CapKey): string => {
    if (!cur || !draft) return '';
    const [lo, hi] = cur.ranges[key]; const n = Number(draft[key]);
    return Number.isInteger(n) && n >= lo && n <= hi ? '' : `A whole number from ${lo} to ${hi}.`;
  };
  const patch = cur && draft ? Object.fromEntries(CAP_FIELDS.filter((f) => !locked(f.key) && draft[f.key] !== String(f.read(cur) ?? '')).map((f) => [f.key, Number(draft[f.key])])) as Partial<Record<CapKey, number>> : {};
  const changed = Object.keys(patch).length > 0;
  const invalid = (Object.keys(patch) as CapKey[]).some((k) => bad(k));
  const save = async () => {
    setBusy('save'); setError('');
    try { const c = await saveBuildCap(patch); setDraft(draftOf(c)); rt.toast(`Build cap saved.${c.note ? ` ${c.note}` : ''}`, 'success', 'VPS Configuration'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const refresh = async () => { setBusy('refresh'); await reload(); setBusy(''); };

  if (!cur || !draft) return error ? <p className="axp-gate__err" role="alert">{error}</p> : <p className="axp-gate__sub">Loading the build cap…</p>;
  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Build cap" data-axf-toolbar="gate.build-cap">
        <Chip tone={cur.note ? 'warning' : 'success'}>{cur.effective ?? '?'} at once</Chip>
        <span className="axp-gate__sub">{cur.live ?? '?'} of {cur.hardCap ?? '?'} running now, {cur.emergencyLive ?? '?'} of {cur.emergencySlots ?? '?'} emergency</span>
        <span className="axp-gate__bar-end">
          <Button id="vps-cap-refresh" icon="refresh" busy={busy === 'refresh'} onClick={() => void refresh()}>Refresh</Button>
          <Button id="vps-cap-reset" icon="undo" disabled={!changed} onClick={() => setDraft(draftOf(cur))}>Undo edits</Button>
          <Button id="vps-cap-save" tone="primary" icon="save" busy={busy === 'save'} disabled={!changed || invalid} onClick={() => void save()}>Save</Button>
        </span>
      </div>
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <Container title="Build cap" icon="layers">
        <div className="axp-gate__status">
          {CAP_FIELDS.map((f) => (
            <div key={f.key} className="axp-gate__stat" data-axf-target={`setting:vps.buildCap.${f.key}`}>
              <TextField label={f.label} type="number" value={draft[f.key]} disabled={locked(f.key)} error={locked(f.key) ? undefined : bad(f.key) || undefined}
                onChange={(v) => setDraft((d) => (d ? { ...d, [f.key]: v } : d))} hint={locked(f.key) ? `${f.hint} ${OWNER_ONLY}` : f.hint} />
            </div>
          ))}
        </div>
        {cur.note && <p className="axp-gate__note" role="status">{cur.note}</p>}
        {cur.setBy && <p className="axp-gate__sub">Hard cap last set by {cur.setBy}{cur.setAt ? ` on ${new Date(cur.setAt).toLocaleString()}` : ''}.</p>}
      </Container>
    </>
  );
}

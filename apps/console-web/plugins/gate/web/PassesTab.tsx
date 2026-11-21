/**
 * VPS Configuration → Passes: the one home for passes.
 *   Veto passes   control-pass@1 (moved from Token control → Passes, Nov 21 2026): start a pass (scope, minutes up to
 *                 the longest-pass setting, reason), approve or deny a request, revoke, undo, what is on now, recent
 *                 passes, and the longest-pass setting itself
 *   axHub passes  the hub's timed passes (HubPasses.tsx, was the axhub-passes plugin's Passes page)
 *   Go pass       the hub's Go pass (HubGoPass.tsx, was the same plugin's Go pass page)
 * console-control@1: `tab:gate.tabs=passes`, the row `tab:gate.passes.tabs=veto | hub | go`, fields
 * `setting:vps.passes.scope | minutes | reason | irreversible | maxMinutes | timeZone`, buttons `button:vps-pass-start |
 * vps-pass-settings-save | vps-pass-approve-<scope> | vps-pass-deny-<scope> | vps-pass-undo-<scope> |
 * vps-pass-revoke-<scope>`; actions in passesState.ts.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TabGroup, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import { GateList } from './GateList';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { GoPass } from './HubGoPass';
import { Passes as HubPasses } from './HubPasses';
import { clampMinutes, countdown, isPassTab, loadPassSettings, loadPasses, onShowPassTab, passCalls, savePassSettings, takeWantedPassTab, useNow, usePasses, type PassAnswer, type PassTab, type PassView, type ScopeRow } from './passesState';

const T = 'Passes';
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-');

function VetoPasses() {
  const rt = useRuntime();
  const { status, error } = usePasses();
  const now = useNow();
  const [busy, setBusy] = useState('');
  const [scope, setScope] = useState('all');
  const [irreversible, setIrreversible] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [reason, setReason] = useState('');
  const [max, setMax] = useState('');
  const [tz, setTz] = useState('');
  const [saved, setSaved] = useState<{ max: string; tz: string } | null>(null);
  const rows = status?.items ?? [];
  const longest = status?.maxMinutes ?? 240;
  const recent = (status?.recent ?? []).filter((p): p is PassView => !!p);
  useEffect(() => { void loadPassSettings().then((s) => { const v = { max: String(s.maxMinutes ?? 240), tz: s.timeZone ?? '' }; setSaved(v); setMax(v.max); setTz(v.tz); }, () => { /* the note above says why */ }); }, []);

  const act = async (key: string, run: () => Promise<PassAnswer>) => {
    setBusy(key);
    try {
      const a = await run();
      rt.toast(a.ok ? (a.text ?? 'Done.') : `${a.code ?? 'failed'}: ${a.message ?? ''}`, a.ok ? (a.approval?.required || a.notUndoable?.length ? 'warning' : 'success') : 'danger', T);
      await loadPasses();
    } catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };
  const n = Number(minutes);
  const minutesError = minutes && (!Number.isInteger(n) || n < 1 || n > longest) ? `A whole number from 1 to ${longest} (the longest pass).` : '';
  const start = () => act('grant', () => passCalls.grant(scope, clampMinutes(minutes, longest), reason, scope === 'all' && irreversible));
  const saveSettings = async () => {
    setBusy('settings');
    try { const s = await savePassSettings({ maxMinutes: Number(max) || 240, timeZone: tz }); const v = { max: String(s.maxMinutes ?? max), tz: s.timeZone ?? tz }; setSaved(v); setMax(v.max); setTz(v.tz); rt.toast(`Passes now last at most ${v.max} minutes.`, 'success', T); }
    catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:vps.passes.scope', kind: 'setting', label: 'New pass: scope', keywords: ['veto pass', 'scope'], get: () => scope, set: (v: unknown) => { setScope(String(v)); return String(v); } },
    { address: 'setting:vps.passes.minutes', kind: 'setting', label: 'New pass: minutes', keywords: ['veto pass', 'minutes'], get: () => minutes, set: (v: unknown) => { const m = String(clampMinutes(v, longest)); setMinutes(m); return m; } },
    { address: 'setting:vps.passes.reason', kind: 'setting', label: 'New pass: reason', keywords: ['veto pass', 'reason'], get: () => reason, set: (v: unknown) => { setReason(String(v)); return String(v); } },
    { address: 'setting:vps.passes.irreversible', kind: 'setting', label: 'New pass: include irreversible deletes', keywords: ['veto pass', 'irreversible'], get: () => irreversible, set: (v: unknown) => { const on = v === true || v === 'on' || v === 'true'; setIrreversible(on); return on; } },
  ], [scope, minutes, reason, irreversible, longest]);
  useControlTargets(targets, `${scope}|${minutes}|${reason}|${irreversible}|${longest}`);

  const cols: GridColumn<ScopeRow>[] = [
    { id: 'scope', label: 'Scope', width: 'calc(var(--fx-space) * 48)', fixed: true, sortable: true, sortValue: (r) => r.label, render: (r) => <span className="axp-gate__cell"><strong>{r.label}</strong><span className="axp-gate__sub">{r.id}</span></span> },
    { id: 'state', label: 'Now', width: 'calc(var(--fx-space) * 28)', render: (r) => (r.active ? <Chip tone="success">{countdown(r.active.expiresAt, now)} left</Chip> : r.pending ? <Chip tone="warning">waiting</Chip> : <span className="axp-gate__sub">off</span>) },
    { id: 'act', label: '', width: 'calc(var(--fx-space) * 76)', render: (r) => (
      <span className="axp-gate__bar">
        {r.pending && <Button size="sm" id={`vps-pass-approve-${slug(r.id)}`} tone="primary" icon="check" disabled={!!busy} onClick={() => void act('a', () => passCalls.approve(r.id, r.pending!.id))}>Approve</Button>}
        {r.pending && <Button size="sm" id={`vps-pass-deny-${slug(r.id)}`} icon="x" disabled={!!busy} onClick={() => void act('d', () => passCalls.deny(r.id, r.pending!.id))}>Deny</Button>}
        {r.active && <Button size="sm" id={`vps-pass-undo-${slug(r.id)}`} icon="undo" disabled={!!busy || !r.active.changes} onClick={() => void act('u', () => passCalls.undo(r.id))}>Undo {r.active.changes}</Button>}
        {(r.active || r.pending) && <Button size="sm" id={`vps-pass-revoke-${slug(r.id)}`} icon="x" disabled={!!busy} onClick={() => void act('r', () => passCalls.revoke(r.id))}>Revoke</Button>}
      </span>
    ) },
    { id: 'text', label: 'What', width: 'calc(var(--fx-space) * 100)', render: (r) => <span className="axp-gate__cell">{r.text}{r.pending && <span className="axp-gate__sub">{r.pending.requestedBy} asks for {r.pending.minutes} min{r.pending.reason ? `: ${r.pending.reason}` : ''}</span>}</span> },
  ];
  const recentCols: GridColumn<PassView>[] = [
    { id: 'scope', label: 'Scope', width: 'calc(var(--fx-space) * 40)', fixed: true, render: (p) => <span className="axp-gate__cell"><strong>{p.label ?? p.scope}</strong><span className="axp-gate__sub">{p.id}</span></span> },
    { id: 'state', label: 'State', width: 'calc(var(--fx-space) * 24)', render: (p) => <Chip>{p.state}</Chip> },
    { id: 'text', label: 'What', width: 'calc(var(--fx-space) * 120)', render: (p) => <span className="axp-gate__sub">{p.text}</span> },
  ];

  return (
    <>
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <Note tone="info">A pass lets commands run without the veto countdown for a while (“allow everything for the next 30 minutes”). Everything is the default scope; a narrower one covers only token changes there. Irreversible deletes still confirm unless the pass includes them. Brett approves each pass once, and everything done under a pass can be undone from here.</Note>
      <Container title="Start a pass" icon="key">
        <div className="axp-gate__status">
          <SelectField label="Scope" value={scope} onChange={setScope} options={rows.length ? rows.map((r) => ({ value: r.id, label: r.label })) : [{ value: 'all', label: 'Everything' }]} />
          <TextField label="Minutes" type="number" value={minutes} onChange={setMinutes} error={minutesError || undefined} hint={`1 to ${longest}, the longest pass.`} />
          <TextField label="Reason" value={reason} onChange={setReason} placeholder="optional" />
        </div>
        {scope === 'all' && <Switch label="Include irreversible deletes" checked={irreversible} onChange={setIrreversible} hint="Hard deletes nothing can bring back skip the confirm too." />}
        <div className="axp-gate__bar"><Button id="vps-pass-start" tone="primary" icon="check" busy={busy === 'grant'} disabled={!!busy || !!minutesError} onClick={() => void start()}>Start pass</Button></div>
      </Container>
      <GateList<ScopeRow>
        id="gate.passes" label="Passes by scope" title={`Passes (${rows.filter((r) => r.active).length} on, ${rows.filter((r) => r.pending).length} waiting)`} rows={rows} columns={cols}
        rowId={(r) => r.id} rowLabel={(r) => r.label} rowTone={(r) => (r.pending ? 'warning' : r.active ? 'accent' : '')}
        empty={<p className="axp-gate__sub">{status ? 'No scopes.' : 'Loading the passes…'}</p>}
      />
      {recent.length > 0 && (
        <GateList<PassView>
          id="gate.passes.recent" label="Recent passes" title={`Recent passes (${recent.length})`} rows={recent} columns={recentCols}
          rowId={(p) => p.id} rowLabel={(p) => `${p.label ?? p.scope} ${p.state}`} empty={<p className="axp-gate__sub">None yet.</p>}
        />
      )}
      <Container title="Longest pass" icon="clock">
        <div className="axp-gate__status">
          <div data-axf-target="setting:vps.passes.maxMinutes"><TextField label="Longest pass (minutes)" type="number" value={max} onChange={setMax} hint="1 to 240. A longer request is cut to this." /></div>
          <div data-axf-target="setting:vps.passes.timeZone"><TextField label="Time zone" value={tz} onChange={setTz} hint="For the plain answers (“until 10:42 AM”), e.g. America/New_York." /></div>
        </div>
        <div className="axp-gate__bar"><Button id="vps-pass-settings-save" icon="save" busy={busy === 'settings'} disabled={!saved || (saved.max === max && saved.tz === tz)} onClick={() => void saveSettings()}>Save</Button></div>
      </Container>
    </>
  );
}

export function PassesTab() {
  const [tab, setTab] = useState<PassTab>(() => takeWantedPassTab() ?? 'veto');
  useEffect(() => onShowPassTab(setTab), []);
  return (
    <TabGroup<PassTab> id="gate.passes.tabs" label="Passes" value={isPassTab(tab) ? tab : 'veto'} onChange={setTab}
      tabs={[{ value: 'veto', label: 'Veto passes', icon: 'key' }, { value: 'hub', label: 'axHub passes', icon: 'clock' }, { value: 'go', label: 'Go pass', icon: 'check' }]}>
      <div className="axp-gate__panel">
        {tab === 'veto' && <VetoPasses />}
        {tab === 'hub' && <HubPasses />}
        {tab === 'go' && <GoPass />}
      </div>
    </TabGroup>
  );
}

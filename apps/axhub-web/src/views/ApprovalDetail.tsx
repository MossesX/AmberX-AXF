/**
 * One request (`#/approvals/<id>`; the hub's old `/auth/admin/approvals/<id>` links land here): the complete call,
 * who asked, its times and history, every action it allows, and Postpone — for a time, until a date, or until a
 * condition from the hub's open registry (a service is healthy, a job is done, an address answers).
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, Note, Segmented, SelectField, TextField, useRuntime } from '../axf/react';
import { checkHubNow } from '../axf/libs/hub/react';
import { hubGet } from '../hub/api';
import { heldActions, localToUtcMinute, pickOf, relTime } from '../hub/core';
import { go, useRouteParams } from '../hub/route';
import { ACTION_LABELS, STATUS_TONE, type ApprovalAction, type ApprovalItem, type AutoState, type PostponeOptions } from '../hub/types';
import { act } from './Approvals';
import { HubGate, useHubJson, when } from './hubPage';
import { CodeSection, WhatItDoes } from './ApprovalParts';
import { HELD_LABELS, HeldBar, isHeld } from './HeldCall';
import type { VetoAction } from '../axf/libs/hub/veto';

/** The two decision buttons on a request that asks (not held): green Approve now, red Deny (the hub's decline). */
const DECIDE_LABELS = { approve: 'Approve now', decline: 'Deny' } as const;

export function ApprovalDetail() {
  return <HubGate admin what="approvals">{() => <Detail />}</HubGate>;
}

function Detail() {
  const rt = useRuntime();
  const params = useRouteParams('approval');
  const id = params.id ?? '';
  const [fast, setFast] = useState(false);
  // A held command counts down: read the hub every 3 s so a Deny elsewhere or the run shows quickly.
  const res = useHubJson<{ item: ApprovalItem; auto: AutoState }>(id ? `/auth/api/approvals/${id}` : null, fast ? 3_000 : 10_000);
  const [busy, setBusy] = useState(false);
  const [postponing, setPostponing] = useState(params.postpone === '1');
  useEffect(() => setPostponing(params.postpone === '1'), [id, params.postpone]);
  const item = res.data?.item;
  const held = !!item && isHeld(item);
  useEffect(() => setFast(held), [held]);
  // The button a notice picked: Approve (= Approve now on a held call, decision 105), Deny, Shelve.
  const pick = pickOf(params.do);
  const heldPick: VetoAction | undefined = !held || !pick ? undefined : pick === 'approve' ? 'approve-now' : pick;
  const confirmPick: ApprovalAction | undefined = held || !pick ? undefined : pick === 'approve' || pick === 'approve-now' ? 'approve' : pick === 'deny' ? 'decline' : undefined;
  const pickedLabel = heldPick ? HELD_LABELS[heldPick] : confirmPick ? DECIDE_LABELS[confirmPick as 'approve' | 'decline'] : '';
  const canPicked = held ? !!heldPick && heldActions(item!).includes(heldPick) : !!confirmPick && !!item?.actions.includes(confirmPick);
  const pickNote = !pickedLabel ? '' : canPicked ? `You picked ${pickedLabel} in the notice: tap ${pickedLabel} below to do it.` : `You picked ${pickedLabel} in the notice, but this request can't take it any more.`;
  // Deny / Approve now first, as one pair the same size (Deny left, as on the rows).
  const decide = item && !held ? (['decline', 'approve'] as const).filter((a) => item.actions.includes(a)) : [];

  const run = async (a: ApprovalAction) => {
    if (!item) return;
    if (a === 'postpone') { setPostponing(true); return; }
    setBusy(true);
    try { const r = await act(item, a); res.setData({ item: r.item, auto: res.data!.auto }); rt.toast(r.message || 'Done.', a === 'approve' ? 'success' : 'info'); checkHubNow(); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); void res.reload(); }
    finally { setBusy(false); }
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Approval request</p>
          <h1>{item ? item.title : 'Request'}</h1>
          {item && <p className="fx-muted">Asked {when(item.createdAt)} by {item.callerId}{item.showExpires ? ` · expires ${relTime(item.expiresAt)}` : ''}</p>}
          {/* Brett (Oct 27 2026): the decision buttons are on the first screen, right under the title, before any
              description or code, so Approve never needs a scroll on a phone. */}
          {/* veto@1: a held command shows its countdown with Deny / Approve now / Shelve (decision 104) in place of the usual actions, on the first screen. */}
          {/* A notice's button (`?do=`, axHub decision 105) opens this page with that button picked: marked and focused,
              one tap decides (a link never decides by itself). */}
          {item && pickNote && <Note tone="info" icon="bell">{pickNote}</Note>}
          {item && held && <HeldBar big item={item} picked={heldPick} onDone={(next) => { if (next) res.setData({ item: next, auto: res.data!.auto }); else void res.reload(); }} />}
          {item && !held && <div className="fx-row fx-row--wrap" data-axf-anchor="approval-actions">
            <Chip tone={STATUS_TONE[item.status]}>{item.statusLabel}</Chip>
            {decide.length > 0 && <div className="axp-axhub-pair">
              {decide.map((a) => (
                <Button key={a} disabled={busy} icon={a === 'approve' ? 'check' : 'x-circle'} tone={a === 'approve' ? 'success' : 'danger'}
                  className={confirmPick === a ? 'is-picked' : undefined} autoFocus={confirmPick === a || undefined}
                  aria-label={`${DECIDE_LABELS[a]}: ${item.title}`} onClick={() => void run(a)}>
                  {DECIDE_LABELS[a]}
                </Button>
              ))}
            </div>}
            {orderActions(item.actions).filter((a) => a !== 'approve' && a !== 'decline').map((a) => (
              <Button key={a} disabled={busy} tone={a === 'revoke' ? 'danger' : 'neutral'} onClick={() => void run(a)}>
                {ACTION_LABELS[a]}
              </Button>
            ))}
            {item.actions.length === 0 && <span className="fx-muted">Nothing more to do with this one{item.decidedBy ? ` (decided by ${item.decidedBy})` : ''}.</span>}
          </div>}
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="arrow-left" onClick={() => go(rt, 'home')}>All requests</Button>
          <Button icon="refresh" onClick={() => void res.reload()}>Check</Button>
        </div>
      </header>

      {!id && <Note tone="warning">No such request.</Note>}
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {!item && !res.error && id && <p className="fx-muted">Reading the hub…</p>}

      {item && (
        <>
          {item.reviewRequired && <Note tone="warning" icon="alert">Postponed for over 2 hours: look at it again.</Note>}

          <Container title="What it does" icon="info" collapsible defaultOpen>
            <WhatItDoes item={item} />
          </Container>

          <CodeSection item={item} />

          {postponing && item.actions.includes('postpone') && (
            <PostponePanel item={item} onCancel={() => setPostponing(false)} onDone={(next) => { setPostponing(false); res.setData({ item: next, auto: res.data!.auto }); checkHubNow(); }} />
          )}

          {item.postponed && (
            <Container title="Postponed" icon="clock">
              <table className="fx-table">
                <tbody>
                  <tr><th>Waiting for</th><td>{item.postponed.waitingFor}</td></tr>
                  {item.postponed.until && <tr><th>Until</th><td>{when(item.postponed.until)} ({relTime(item.postponed.until)})</td></tr>}
                  <tr><th>Since</th><td>{when(item.postponed.since)}</td></tr>
                  {item.postponed.lastCheck && <tr><th>Last check</th><td>{relTime(item.postponed.lastCheck)}{item.postponed.lastNote ? ` · ${item.postponed.lastNote}` : ''}</td></tr>}
                  {item.postponed.nextReminder && <tr><th>Next reminder</th><td>{relTime(item.postponed.nextReminder)}</td></tr>}
                  <tr><th>Reminders sent</th><td>{item.postponed.reminders}</td></tr>
                </tbody>
              </table>
            </Container>
          )}

          <Container title="History" icon="list" collapsible defaultOpen={false}>
            {item.history.length === 0 ? <p className="fx-muted">Nothing yet.</p> : (
              <table className="fx-table">
                <tbody>
                  {item.history.map((h, i) => (
                    <tr key={i}><th>{when(h.at)}</th><td>{h.from} → {h.to} · {h.by}{h.note ? ` · ${h.note}` : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Container>
        </>
      )}
    </div>
  );
}

/** Approve first, then the rest in the hub's order (Approve is the one tapped most). */
export function orderActions(actions: ApprovalAction[]): ApprovalAction[] {
  return [...actions.filter((a) => a === 'approve'), ...actions.filter((a) => a !== 'approve')];
}

type Mode = 'in' | 'until' | 'condition';

function PostponePanel({ item, onCancel, onDone }: { item: ApprovalItem; onCancel: () => void; onDone: (next: ApprovalItem) => void }) {
  const rt = useRuntime();
  const [opts, setOpts] = useState<PostponeOptions | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('in');
  const [preset, setPreset] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('hours');
  const [until, setUntil] = useState('');
  const [kind, setKind] = useState('');
  const [cond, setCond] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hubGet<PostponeOptions>(`/auth/api/approvals/${item.id}/postpone`).then((o) => {
      setOpts(o);
      setPreset(o.presets[0] ? String(o.presets[0].minutes) : 'custom');
      setKind(o.conditions.find((c) => c.built)?.kind ?? '');
    }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [item.id]);

  const send = async () => {
    const postpone = mode === 'in' ? { mode, preset, amount, unit } : mode === 'until' ? { mode, until: localToUtcMinute(until) } : { mode, kind, params: cond };
    setBusy(true);
    try { const r = await act(item, 'postpone', { postpone }); rt.toast(r.message || 'Postponed.', 'info'); onDone(r.item); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const condition = opts?.conditions.find((c) => c.kind === kind);
  return (
    <Container title="Postpone" icon="clock">
      {!opts && !error && <p className="fx-muted">Reading the choices…</p>}
      {opts && (
        <div className="fx-stack">
          <p className="fx-muted">It comes back as pending when the time is up or the condition holds; it is never approved by itself. Latest: {when(opts.deadline)} ({opts.maxDays} days from the request).</p>
          <Segmented<Mode> label="Postpone how" value={mode} onChange={setMode} options={[
            { value: 'in', label: 'For a while' }, { value: 'until', label: 'Until' }, { value: 'condition', label: 'Until something happens' },
          ]} />
          {mode === 'in' && (
            <>
              <SelectField label="How long" value={preset} onChange={setPreset}
                options={[...opts.presets.map((p) => ({ value: String(p.minutes), label: p.label })), { value: 'custom', label: 'Something else…' }]} />
              {preset === 'custom' && (
                <div className="fx-row fx-row--wrap">
                  <TextField label="Amount" type="number" value={amount} onChange={setAmount} />
                  <SelectField label="Unit" value={unit} onChange={setUnit} options={opts.units.map((u) => ({ value: u, label: u }))} />
                </div>
              )}
            </>
          )}
          {mode === 'until' && <TextField label="Date and time (your time)" type="datetime-local" value={until} onChange={setUntil} />}
          {mode === 'condition' && (
            <>
              <SelectField label="Wait for" value={kind} onChange={(k) => { setKind(k); setCond({}); }}
                options={opts.conditions.map((c) => ({ value: c.kind, label: c.built ? c.label : `${c.label} (not built yet)`, disabled: !c.built }))} />
              {condition?.params.map((p) => (
                <TextField key={p.name} label={p.label} value={cond[p.name] ?? ''} placeholder={p.placeholder} onChange={(v) => setCond({ ...cond, [p.name]: v })} />
              ))}
            </>
          )}
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="clock" disabled={busy || !opts.allowed} onClick={() => void send()}>Postpone</Button>
            <Button tone="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <Note tone="danger" icon="alert">{error}</Note>}
    </Container>
  );
}

/**
 * Claude accounts manager: the list (page, Terminal column, overlay), the add form, the rename and pick dialogs.
 * Every row carries data-fx-ctx-target="claude-account" so a right-click anywhere gives rename, move and "Claude Code
 * as this account" (index.tsx contextExtras). Rows drag to reorder; the same moves are in the right-click menu for touch.
 */
import { useState, type DragEvent } from 'react';
import { Button, Chip, Icon, Meter, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { CTX, NAME, addAccount, dropOrder, pct, rename, setMode, setOrder, usd, useManager, type Row, type View } from './data';

const STATUS_TONE: Record<Row['status'], 'accent' | 'success' | 'warning' | undefined> = { builder: 'accent', worker: 'success', console: undefined, idle: undefined };

function UsageLine({ r }: { r: Row }) {
  if (r.kind === 'api') {
    return <span className="axp-cam-usage">{r.totalUsd != null ? `${usd(r.usedUsd)} of ${usd(r.totalUsd)} (${r.usdBasis}) · ${usd(r.leftUsd)} left` : `${usd(r.usedUsd)} this week · no cap set`}</span>;
  }
  if (r.usedPct == null) return <span className="axp-cam-usage fx-muted">No usage reading yet</span>;
  return (
    <span className="axp-cam-usage">
      {pct(r.usedPct)} used · <b>{pct(r.leftPct)} left</b>
      {r.totalUsd != null && <> · {usd(r.usedUsd)} of {usd(r.totalUsd)} this week · {usd(r.leftUsd)} left</>}
      {r.fiveHour && <span className="fx-muted"> · 5-hour {pct(r.fiveHour.usedPct)}</span>}
    </span>
  );
}

/** One account. `compact` = the Terminal column and the overlay: one line and a meter. */
export function AccountRow({ r, compact, fixed, dragging, over, onDrag, onOver, onDrop, onSession }: {
  r: Row; compact?: boolean; fixed?: boolean; dragging?: boolean; over?: boolean;
  onDrag?: (name: string | null) => void; onOver?: (name: string | null) => void; onDrop?: (name: string) => void; onSession?: (name: string) => void;
}) {
  const left = r.leftPct ?? (r.kind === 'api' && r.totalUsd == null ? 100 : 0);
  // fixed = the switch is on Automatic: the order is the dispatcher's, nothing to drag
  const drag = fixed ? {} : {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/plain', r.name); e.dataTransfer.effectAllowed = 'move'; onDrag?.(r.name); },
    onDragEnd: () => { onDrag?.(null); onOver?.(null); },
    onDragOver: (e: DragEvent) => { e.preventDefault(); onOver?.(r.name); },
    onDrop: (e: DragEvent) => { e.preventDefault(); onDrop?.(r.name); },
  };
  return (
    <div role="listitem" className={`axp-cam-row ${compact ? 'axp-cam-row--compact' : ''} ${r.inOrder ? '' : 'axp-cam-row--out'} ${fixed ? 'axp-cam-row--fixed' : ''} ${dragging ? 'is-dragging' : ''} ${over ? 'is-over' : ''}`}
      data-fx-ctx-target={CTX} data-fx-ctx-payload={r.name} title={`${r.display}${r.email ? ` · ${r.email}` : ''} · right-click: rename, move, Claude Code`} {...drag}>
      {!fixed && <span className="axp-cam-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>}
      <span className="axp-cam-n" aria-label={r.n ? `number ${r.n} in the order` : 'not in the order'}>{r.n ?? '–'}</span>
      <div className="axp-cam-who">
        <div className="axp-cam-line">
          <b>{r.display}</b>
          <Chip tone={r.kind === 'api' ? 'warning' : undefined}>{r.kind === 'api' ? 'API' : 'Subscription'}</Chip>
          {!compact && r.plan && r.kind !== 'api' && <Chip>{r.plan}{r.planUsd != null ? ` · ${usd(r.planUsd)}/mo` : ''}</Chip>}
          <Chip tone={STATUS_TONE[r.status]}>{compact ? r.status : r.statusText}</Chip>
          {r.active && <Chip tone="accent">console</Chip>}
          {r.outOfCredits && <Chip tone="danger">Out of credits</Chip>}
        </div>
        {!compact && <p className="axp-cam-sub">{[r.label && r.label !== r.name ? r.name : '', r.email].filter(Boolean).join(' · ') || r.name}</p>}
        <Meter value={Math.max(0, Math.min(100, left))} small label={`${r.display}: ${pct(r.leftPct)} left`} />
        {!compact && <UsageLine r={r} />}
        {compact && <span className="axp-cam-usage">{r.leftUsd != null ? `${usd(r.leftUsd)} left` : r.leftPct != null ? `${pct(r.leftPct)} left` : ''}</span>}
        {(r.outOfCredits || (!r.usable && r.why)) && !compact && <p className="axp-cam-sub">{r.creditsWhy || r.why}</p>}
      </div>
      {onSession && <Button size="sm" tone="ghost" icon="sparkles" title={`Claude Code as ${r.display}`} onClick={() => onSession(r.name)}>{compact ? '' : 'Claude Code'}</Button>}
    </div>
  );
}

/**
 * The Custom / Automatic switch (Brett, Nov 10 2026: "In a switch, a switch if you want to customize it or do that
 * automatically"). On = Custom: the orchestrator follows the drag-and-drop order exactly, subscriptions and API alike.
 * Off = Automatic: subscriptions first, then any API. The drag-and-drop order is kept either way.
 */
export function OrderSwitch({ view, compact }: { view: View; compact?: boolean }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const custom = view.mode !== 'auto';
  const flip = (on: boolean) => {
    setBusy(true);
    setMode(on ? 'custom' : 'auto').then((r) => rt.toast(r.message, 'success'), (e: Error) => rt.toast(e.message, 'danger')).finally(() => setBusy(false));
  };
  return (
    <div className="axp-cam-mode" role="group" aria-label="Account order: Custom or Automatic">
      <Switch label="Custom order" disabled={busy || !view.dispatch} checked={custom} onChange={flip}
        text={compact ? (custom ? 'Drag to order' : 'Automatic: subscriptions, then API')
          : custom ? 'On: the orchestrator follows your drag-and-drop order exactly, subscriptions and API keys alike.'
            : 'Off (Automatic): every subscription first, then any API key. Your drag-and-drop order is kept for when you switch back.'} />
    </div>
  );
}

/** The ordered list with drag and drop. Accounts out of the order (API keys not added yet) sit below a divider. On
 * Automatic the list shows the automatic order (subscriptions, then API) and nothing drags. */
export function AccountList({ view, compact, onSession }: { view: View; compact?: boolean; onSession?: (name: string) => void }) {
  const rt = useRuntime();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const fixed = view.mode === 'auto';
  const drop = (target: string | null) => {
    const from = dragging; setDragging(null); setOver(null);
    if (fixed || !from || from === target) return;
    const order = view.customOrder ?? view.order;
    const toOut = target !== null && !order.includes(target);
    const next = toOut ? order.filter((n) => n !== from) : dropOrder(order, from, target);
    setOrder(next).then((r) => rt.toast(r.message, 'success'), (e: Error) => rt.toast(e.message, 'danger'));
  };
  const listed = view.accounts.filter((r) => r.inOrder);
  const rest = view.accounts.filter((r) => !r.inOrder);
  const row = (r: Row) => <AccountRow key={r.name} r={r} compact={compact} fixed={fixed} dragging={dragging === r.name} over={over === r.name} onDrag={setDragging} onOver={setOver} onDrop={drop} onSession={onSession} />;
  return (
    <div className="axp-cam-list" role="list" aria-label="Claude accounts in order">
      {fixed && !compact && <Note tone="info">Automatic: subscriptions first, then API. Turn on Custom order to drag the accounts into your own order.</Note>}
      {listed.map(row)}
      {rest.length > 0 && <div className="axp-cam-divider" onDragOver={(e) => e.preventDefault()} onDrop={() => drop(rest[0]?.name ?? null)}>Not in the order{compact ? '' : ': takes no build. Drag one up to add it.'}</div>}
      {rest.map(row)}
      {!view.accounts.length && <p className="fx-muted">{view.why || 'No Claude account found on the VPS.'}</p>}
    </div>
  );
}

export function Totals({ view }: { view: View }) {
  const t = view.totals;
  return (
    <div className="axp-cam-totals" role="group" aria-label="Totals">
      <Chip>{t.accounts} accounts</Chip><Chip tone="accent">{t.builders} building</Chip><Chip tone="success">{t.workers} workers</Chip>
      <Chip tone={t.out ? 'danger' : undefined}>{t.out} out of credits</Chip><Chip tone="warning">{t.api} API</Chip>
      <Chip>{usd(t.usedUsd)} used · {usd(t.leftUsd)} left this week</Chip>
    </div>
  );
}

/** Add a subscription login or an API key: opens the Terminal and starts the login (or the hidden key prompt). */
export function AddForm({ kind: initial = 'subscription', onDone }: { kind?: 'subscription' | 'api'; onDone?: () => void }) {
  const rt = useRuntime();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'subscription' | 'api'>(initial);
  const ok = NAME.test(name);
  const go = () => {
    addAccount(name, kind).then((r) => {
      rt.dispatch(`terminal.tab:${encodeURIComponent(JSON.stringify(r.open))}`);
      rt.toast(r.message, 'info'); setName(''); onDone?.();
    }, (e: Error) => rt.toast(e.message, 'danger'));
  };
  return (
    <div className="axp-cam-add">
      <TextField label="New account name" value={name} onChange={(v) => setName(v.trim().toLowerCase().replace(/\s+/g, '-'))} placeholder={kind === 'api' ? 'hulu-api' : 'account-6'}
        hint="Lower-case letters, digits, dashes." error={name && !ok ? 'Use lower-case letters, digits and dashes' : undefined} />
      <SelectField label="Kind" value={kind} onChange={(v) => setKind(v === 'api' ? 'api' : 'subscription')} options={[{ value: 'subscription', label: 'Subscription (Claude login)' }, { value: 'api', label: 'API key' }]} />
      <Button tone="primary" icon="terminal" disabled={!ok} onClick={go}>Add in the Terminal</Button>
    </div>
  );
}

export function RenameForm({ name, close }: { name: string; close: () => void }) {
  const rt = useRuntime();
  const { view } = useManager();
  const r = view?.accounts.find((a) => a.name === name);
  const [label, setLabel] = useState(r?.label ?? '');
  return (
    <div className="fx-stack">
      <TextField label={`Display name for ${name}`} value={label} onChange={setLabel} autoFocus hint="Empty = its name. The saved login keeps its name." />
      <div className="axp-cam-actions">
        <Button tone="primary" icon="check" onClick={() => rename(name, label).then((x) => { rt.toast(x.message, 'success'); close(); }, (e: Error) => rt.toast(e.message, 'danger'))}>Rename</Button>
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

/** The banner widget's drop-down: pick the account it shows. */
export function PickList({ close, onPick }: { close: () => void; onPick: (name: string) => void }) {
  const { view, error } = useManager();
  if (error) return <Note tone="warning">{error}</Note>;
  if (!view) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="axp-cam-list" role="list" aria-label="Pick an account">
      {view.accounts.map((r) => (
        <button key={r.name} type="button" data-fx-row className="axp-cam-pick" data-fx-ctx-target={CTX} data-fx-ctx-payload={r.name} onClick={() => { onPick(r.name); close(); }}>
          <AccountRow r={r} compact />
        </button>
      ))}
    </div>
  );
}

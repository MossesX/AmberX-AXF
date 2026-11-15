import { useId, useState } from 'react';
import { Button, Chip, Container, ControlScope, Icon, PriorityTag, TextField, useControlTarget } from '@console/axf/react';

/*
 * One pending build as one row (build pending-tab-one-collapsed-row-per-2, Brett, Nov 15 2026: "Why are pending builds
 * not 1 expandable row"). Collapsed by default: one line with the title, a status chip that says why it is pending, the
 * PriorityTag, steps done/total and its age. The whole line is the tap target (aria-expanded, data-axf-target
 * row:<build>). The rules (why pending, age, the expanded set per viewer) live in ../pending-rows.mjs. Framework
 * controls only (Container, Button, Chip, PriorityTag); orchestrator.css lays it out with asset tokens.
 */

export type PendingStep = { id: string; text: string; model: string; estimate: string; done: boolean; skip: boolean };
export type PendingSummary = {
  id: string; title: string; status: string; statusLabel: string; why: string; priority: string;
  steps: { done: number; total: number }; createdAt: string; age: string; said: string; nextModel: string;
  stepList: PendingStep[]; notes: { text: string; at: string }[]; actions: string[]; route: string; splitRequested: boolean; expanded: boolean;
};

/** The status chip's tone: something for Brett to do is a warning, work in flight is the accent. */
export function whyTone(why: string): 'warning' | 'accent' | undefined {
  if (/approval|split$|no steps/.test(why)) return 'warning';
  if (/splitting/.test(why)) return 'accent';
  return undefined;
}

export interface PendingRowProps {
  row: PendingSummary;
  expanded: boolean;
  focused?: boolean;
  busy?: boolean;
  onToggle: (id: string) => void;
  /** expand / collapse / toggle from a control target (console_open, set, voice) */
  onCommand: (id: string, op: 'expand' | 'collapse' | 'toggle') => void;
  onQueue: (id: string) => void;
  onEdit: (id: string, title: string) => Promise<boolean>;
  onArchive: (id: string) => void;
  /** Runs on: auto → api → subscription → auto (pipeline/route) */
  onRoute: (id: string, route: string) => void;
  /** ask the orchestrator to (re)split it (pipeline/split) */
  onSplit: (id: string) => void;
}

/** A control `set` value as a row op: expanded / collapsed / toggle (and the usual spoken forms). */
export function rowOpOf(v: unknown): 'expand' | 'collapse' | 'toggle' | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (['expanded', 'expand', 'open', 'on', 'true', 'yes', '1'].includes(t)) return 'expand';
  if (['collapsed', 'collapse', 'close', 'closed', 'off', 'false', 'no', '0'].includes(t)) return 'collapse';
  return t === 'toggle' ? 'toggle' : null;
}

const fmtDate = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export function PendingRow({ row: r, expanded, focused = false, busy = false, onToggle, onCommand, onQueue, onEdit, onArchive, onRoute, onSplit }: PendingRowProps) {
  const bodyId = useId();
  // console-control@1: row:<build> under grid:pending; open / focus expand it, set takes expanded | collapsed | toggle
  const setTarget = useControlTarget({
    address: `row:${r.id}`, kind: 'row', label: r.title, detail: `Pending · ${r.why}`, keywords: [r.id, r.priority, r.statusLabel, 'pending'],
    can: ['open', 'state', 'focus', 'set'], get: () => (expanded ? 'expanded' : 'collapsed'),
    set: (v) => { const op = rowOpOf(v); if (!op) return `"${String(v)}" is not expanded, collapsed or toggle`; onCommand(r.id, op); return undefined; },
    open: () => onCommand(r.id, 'expand'), expand: () => onCommand(r.id, 'expand'),
    state: () => ({ expanded, title: r.title, status: r.status, why: r.why, priority: r.priority, steps: r.steps, age: r.age }),
  }, [expanded, r.why, r.priority, r.steps.done]);
  return (
    <div ref={setTarget} className={`oc-prow${expanded ? ' is-open' : ''}${focused ? ' is-focused' : ''}`} role="listitem" aria-current={focused ? 'true' : undefined}
      data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={r.id}>
      <ControlScope address={`row:${r.id}`}><Container className="oc-prow__card">
        <button data-fx-row className="oc-prow__head" aria-expanded={expanded} aria-controls={bodyId} data-axf-target="button:toggle"
          title={r.said ? `“${r.said}”` : r.id} onClick={() => onToggle(r.id)}>
          <Icon name="chevron-down" size={14} className={`oc-prow__chev${expanded ? '' : ' fx-rot--90'}`} />
          <span className="oc-prow__title">{r.title}</span>
          <span className="oc-prow__chips">
            <Chip tone={whyTone(r.why)}>{r.statusLabel}: {r.why}</Chip>
            <PriorityTag build={r.id} fallback={<Chip>{r.priority}</Chip>} />
            <span className="oc-prow__meta" title={`${r.steps.done} of ${r.steps.total} steps done`}><Icon name="check-circle" size={13} />{r.steps.done}/{r.steps.total}</span>
            {r.age && <span className="oc-prow__meta" title={`Added ${fmtDate(r.createdAt)}`}><Icon name="clock" size={13} />{r.age}</span>}
          </span>
        </button>
        {expanded && <PendingBody id={bodyId} r={r} busy={busy} onQueue={onQueue} onEdit={onEdit} onArchive={onArchive} onRoute={onRoute} onSplit={onSplit} />}
      </Container></ControlScope>
    </div>
  );
}

const ROUTE: Record<string, { label: string; next: string }> = { auto: { label: 'Auto', next: 'api' }, api: { label: 'API', next: 'subscription' }, subscription: { label: 'Subscriptions', next: 'auto' } };

function PendingBody({ id, r, busy, onQueue, onEdit, onArchive, onRoute, onSplit }: { id: string; r: PendingSummary; busy: boolean; onQueue: (id: string) => void; onEdit: (id: string, title: string) => Promise<boolean>; onArchive: (id: string) => void; onRoute: (id: string, route: string) => void; onSplit: (id: string) => void }) {
  const [mode, setMode] = useState<'' | 'edit' | 'archive'>('');
  const [title, setTitle] = useState(r.title);
  const canArchive = r.actions.includes('archive');
  const route = ROUTE[r.route] ?? ROUTE.auto!;
  return (
    <div className="oc-prow__body" id={id}>
      <p className="fx-small fx-muted fx-mono">{r.id}{r.nextModel ? ` · next on ${r.nextModel}` : ''}</p>
      <section className="oc-prow__said" aria-label="What Brett said">
        <h4 className="oc-prow__label">What Brett said</h4>
        {r.said ? <blockquote className="oc-prow__quote">{r.said}</blockquote> : <p className="fx-small fx-muted">Not recorded.</p>}
      </section>
      <section aria-label={`Steps of ${r.title}`}>
        <h4 className="oc-prow__label">Steps · {r.steps.done}/{r.steps.total}</h4>
        {r.stepList.length === 0 ? <p className="fx-small fx-muted">No steps yet: the orchestrator splits it before it can run.</p> : (
          <ol className="oc-prow__steps">
            {r.stepList.map((s) => (
              <li key={s.id} className={s.done || s.skip ? 'is-done' : ''}>
                <Icon name={s.done ? 'check-circle' : s.skip ? 'minus' : 'clock'} size={13} />
                <span className="fx-small fx-mono">{s.id}</span>
                <span className={`oc-model is-${s.model.toLowerCase()}`}>{s.model}</span>
                <span className={`fx-small${s.done || s.skip ? ' oc-done' : ''}`}>{s.text}{s.estimate ? <span className="fx-muted"> · {s.estimate}</span> : null}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {r.notes.length > 0 && (
        <section aria-label="Notes">
          <h4 className="oc-prow__label">Notes</h4>
          {r.notes.map((n, i) => <p key={i} className="fx-small oc-prow__note"><span className="fx-muted">{fmtDate(n.at)}</span> {n.text}</p>)}
        </section>
      )}
      {mode === 'edit' && (
        <TextField label="Title" value={title} autoFocus onChange={setTitle} />
      )}
      {mode === 'archive' && <p className="fx-small">Archive this build? It leaves Pending; Unarchive brings it back.</p>}
      <div className="oc-prow__actions" role="toolbar" aria-label={`Pending build actions: ${r.title}`} data-axf-toolbar="build-orchestrator.pending-row">
        {mode === 'edit' ? <>
          <Button size="sm" tone="primary" icon="save" disabled={busy || !title.trim()} onClick={async () => { if (await onEdit(r.id, title.trim())) setMode(''); }}>Save</Button>
          <Button size="sm" onClick={() => { setTitle(r.title); setMode(''); }}>Cancel</Button>
        </> : mode === 'archive' ? <>
          <Button size="sm" tone="danger" icon="package" id={`pending-archive-confirm-${r.id}`} disabled={busy} onClick={() => { setMode(''); onArchive(r.id); }}>Archive</Button>
          <Button size="sm" onClick={() => setMode('')}>Keep</Button>
        </> : <>
          <Button size="sm" tone="primary" icon="arrow-right" id={`pending-queue-${r.id}`} disabled={busy} title="Send it to the Queue: the dispatcher starts it when its turn comes" onClick={() => onQueue(r.id)}>Queue</Button>
          <Button size="sm" icon="edit" id={`pending-edit-${r.id}`} disabled={busy} onClick={() => setMode('edit')}>Edit</Button>
          <Button size="sm" icon="zap" id={`pending-route-${r.id}`} disabled={busy} title="Where it may run: Auto (subscriptions first, then any API), API (API-key accounts only) or Subscriptions (never API). Tap to switch." onClick={() => onRoute(r.id, route.next)}>Runs on: {route.label}</Button>
          <Button size="sm" icon="edit" id={`pending-split-${r.id}`} disabled={busy || r.splitRequested} title="Ask the orchestrator to (re)split it into short steps on its next tick" onClick={() => onSplit(r.id)}>{r.splitRequested ? 'Splitting…' : 'Split now'}</Button>
          <Button size="sm" icon="package" id={`pending-archive-${r.id}`} disabled={busy || !canArchive} title={canArchive ? 'Move it to the Archive (asks first)' : 'This build cannot be archived now'} onClick={() => setMode('archive')}>Archive</Button>
        </>}
      </div>
    </div>
  );
}

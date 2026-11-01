/**
 * lib-approvals (web) — one expandable approval row, shared by every surface (Brett, Nov 1 2026): the axHub list, the
 * "Waiting for approvals" dropdown (title bar popover), AmberX's approvals view and the console's approvals banner.
 *
 *   <ApprovalRow scope="banner" details={detailsOfItem(item)} onDecide={(d) => decide(item, d)} busy={busy} hub={hub} />
 *
 * Collapsed: source badge, the reason title, who/tool/time, the surface's own quick buttons (optional), and the caret on
 * the far right. Tapping the row or the caret drops it open in place (no navigation) with the real details: the full
 * reason, the exact command and arguments (monospace, scrollable, Copy), who asked, tool + policy + risk, the timeline,
 * the result once it ran (exit code + last lines of output, from the job stream) with a link to the approval page, and
 * Deny (red) + Approve (green) while it still waits.
 *
 * Open rows live in `approvalsOpenStore` (outside React), so a live refresh updates the row in place and never folds it.
 * Framework controls (Button, Chip, Icon, fx-iconbtn) and theme tokens only (approvals.css, `axf-apx`).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Icon, registerMenuRowDetails, useOptionalRuntime } from '../../react';
import { decideApproval, openHubPage } from './host';
import { followVeto, formatCountdown } from '../hub/veto';
import { DECISION_LABELS, rowOrder, type ApprovalDecision, type ApprovalItem } from './core';
import {
  approvalsOpenStore, clientLine, detailsOfItem, lookupApproval, collapsedLine, detailsCountdown, exitLine, hasResult, isWaitingPhase, tailLines, timelineOf,
  PHASE_LABELS, POLICY_LABELS, SOURCE_ICONS, SOURCE_LABELS, SOURCE_TONES, type ApprovalDetails, type ApprovalsOpenStore,
} from './details';

/** Lines of output the open row keeps. */
export const RESULT_LINES = 12;

export interface ApprovalRowProps {
  details: ApprovalDetails;
  /** The surface ('popover', 'banner', 'axhub', 'amberx' …): open rows are kept per surface. */
  scope: string;
  /** Deny / Approve inside the open row (and wherever the surface calls it). Absent: no buttons inside. */
  onDecide?: (d: ApprovalDecision) => void;
  /** `<id>:<decision>` being sent now (that button spins, the others wait). */
  busy?: string;
  /** The surface's own buttons on the collapsed row, left of the caret (e.g. Deny / Approve now). */
  actions?: ReactNode;
  /** More inside the open row, after the details (e.g. axHub's Postpone / Ignore). */
  children?: ReactNode;
  /** How the approval page opens (default a new tab). */
  openPage?: (url: string) => void;
  /** The hub, to follow the job stream for the output (no hub: exit code only). */
  hub?: string;
  /** Follow the job stream while open (default true). */
  follow?: boolean;
  /** Tighter spacing (popover, banner). */
  compact?: boolean;
  /** The quick buttons on their own line under the title (narrow surfaces: the popover). */
  stack?: boolean;
  className?: string;
  /** Another open-row store (tests). */
  store?: ApprovalsOpenStore;
}

function useOpen(store: ApprovalsOpenStore, scope: string, id: string): [boolean, () => void] {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return [store.isOpen(scope, id), () => { store.toggle(scope, id); }];
}

function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => setN((n) => n + 1), 1_000); return () => clearInterval(t); }, [on]);
}

interface Tail { lines: string[]; exitCode: number | null | undefined; error: string }

/** The job's output while the row is open (the hub replays it to late watchers); one stream per open row. */
function useJobTail(hub: string | undefined, streamUrl: string | null, on: boolean): Tail {
  const [tail, setTail] = useState<Tail>({ lines: [], exitCode: undefined, error: '' });
  useEffect(() => {
    if (!on || !hub || !streamUrl) return;
    const ctl = new AbortController();
    let text = '';
    void followVeto(streamUrl, hub, (e) => {
      if (e.type === 'output') { text = (text + e.text).slice(-16_000); setTail((t) => ({ ...t, lines: tailLines(text, RESULT_LINES) })); }
      else if (e.type === 'done') setTail((t) => ({ ...t, exitCode: e.exitCode }));
    }, { signal: ctl.signal }).catch((err: unknown) => { if (!ctl.signal.aborted) setTail((t) => ({ ...t, error: (err as Error)?.message || 'No output stream.' })); });
    return () => ctl.abort();
  }, [hub, streamUrl, on]);
  return tail;
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" icon={done ? 'check' : 'copy'} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1_200); }, () => undefined); }}>
      {done ? 'Copied' : label}
    </Button>
  );
}

/** The source badge (Claude.ai / Claude Code / Headless / Console / Agent / System). */
export function SourceBadge({ details: d }: { details: Pick<ApprovalDetails, 'source'> }) {
  if (!d.source) return null;
  const tone = SOURCE_TONES[d.source.kind];
  return <span className={`fx-chip${tone ? ` fx-chip--${tone}` : ''} axf-apx__src`} data-source={d.source.kind}><Icon name={SOURCE_ICONS[d.source.kind]} size={12} />{SOURCE_LABELS[d.source.kind]}</span>;
}

/** Deny (red) and Approve (green), the safe one first. */
function Decide({ d, busy, onDecide }: { d: ApprovalDetails; busy: string; onDecide: (x: ApprovalDecision) => void }) {
  const left = detailsCountdown(d);
  return (
    <div className="axf-apx__decide">
      {rowOrder(d.decisions).map((x) => (
        <Button key={x} tone={x === 'approve' ? 'success' : 'danger'} icon={x === 'approve' ? (d.kind === 'held' ? 'play' : 'check') : 'x-circle'}
          busy={busy === `${d.id}:${x}`} disabled={!!busy || (d.kind === 'held' && left === 0 && !d.veto?.shelved)}
          aria-label={`${DECISION_LABELS[x]}: ${d.title}`} onClick={() => onDecide(x)}>
          {DECISION_LABELS[x]}
        </Button>
      ))}
    </div>
  );
}

export function ApprovalRow({ details: d, scope, onDecide, busy = '', actions, children, openPage, hub, follow = true, compact, stack, className, store = approvalsOpenStore }: ApprovalRowProps) {
  const [open, flip] = useOpen(store, scope, d.id);
  const bodyId = useId();
  const box = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const toggle = () => { opened.current = !open; flip(); };
  // Opened by a tap: bring it into view inside a scrolling host (the banner frame, a popover); a refresh never scrolls.
  useEffect(() => { if (open && opened.current) { opened.current = false; box.current?.scrollIntoView?.({ block: 'nearest' }); } }, [open]);
  const left = detailsCountdown(d);
  useTick(left !== null);
  const urgent = left !== null && left <= 30 && !d.veto?.shelved;
  return (
    <div ref={box} className={`axf-apx${open ? ' is-open' : ''}${d.kind === 'held' ? ' is-held' : ''}${compact ? ' axf-apx--compact' : ''}${stack ? ' axf-apx--stack' : ''} ${className ?? ''}`.trim()} data-approval-id={d.id} data-phase={d.phase}>
      <div className="axf-apx__head">
        <button type="button" data-fx-row className="axf-apx__sum" aria-expanded={open} aria-controls={bodyId} onClick={toggle} title={d.title}>
          <span className="axf-apx__top">
            <SourceBadge details={d} />
            <strong className="axf-apx__title">{d.title}</strong>
          </span>
          <span className={`fx-small axf-apx__line${urgent ? ' is-urgent' : ''}`} role={left !== null ? 'timer' : undefined}>
            <Chip>{d.tool}</Chip>
            <span className="axf-apx__when">{collapsedLine({ ...d, tool: '' })}</span>
          </span>
        </button>
        {actions && <div className="axf-apx__quick">{actions}</div>}
        <button type="button" className="fx-iconbtn axf-apx__caret" aria-expanded={open} aria-controls={bodyId} aria-label={open ? 'Fold the details' : 'Show the details'} title={open ? 'Fold' : 'Details'} onClick={toggle}>
          <Icon name="chevron-down" size={16} className={open ? 'axf-apx__flip' : ''} />
        </button>
      </div>
      {open && <ApprovalDetailsPanel id={bodyId} details={d} onDecide={onDecide} busy={busy} openPage={openPage} hub={hub} follow={follow}>{children}</ApprovalDetailsPanel>}
    </div>
  );
}

export interface ApprovalDetailsPanelProps extends Pick<ApprovalRowProps, 'details' | 'onDecide' | 'busy' | 'children' | 'openPage' | 'hub' | 'follow'> {
  id?: string;
  className?: string;
}

/**
 * The open part on its own (a surface that draws its own collapsed row, e.g. the application menu's live list): the
 * reason, the exact call, who asked, tool + policy + risk, the timeline, the result, the approval page link and Deny /
 * Approve while it waits. Ticks every second while a countdown or a run is live; follows the job stream for the output.
 */
export function ApprovalDetailsPanel({ id, details: d, onDecide, busy = '', children, openPage, hub, follow = true, className }: ApprovalDetailsPanelProps) {
  const left = detailsCountdown(d);
  useTick(left !== null || d.phase === 'running');
  const tail = useJobTail(hub, d.streamUrl, follow && hasResult(d));
  const waiting = isWaitingPhase(d.phase);
  const urgent = left !== null && left <= 30 && !d.veto?.shelved;
  const exitCode = d.exitCode !== undefined ? d.exitCode : tail.exitCode;
  const page = (e: { preventDefault: () => void }) => { if (openPage) { e.preventDefault(); openPage(d.url); } };
  const timeline = timelineOf(d);
  return (
    <div className={`axf-apx__body ${className ?? ''}`.trim()} id={id}>
      <section className="axf-apx__sec">
        <p className="fx-eyebrow">What it does{d.reasonGiven === true ? " (Claude's words)" : d.reasonGiven === false ? ' (from the hub)' : ''}</p>
        <p className="axf-apx__title-full">{d.title}</p>
        {d.description ? <p className="axf-apx__text">{d.description}</p> : <p className="fx-small fx-muted axf-apx__text">No reason was given. Read the command before you approve it.</p>}
      </section>

      <section className="axf-apx__sec">
        <p className="fx-eyebrow">Exact call</p>
        {d.command && <pre className="fx-mono axf-apx__code" aria-label="Command">{d.command}</pre>}
        <pre className="fx-mono axf-apx__code" aria-label="Arguments">{d.arguments || '(no arguments)'}</pre>
        <div className="axf-apx__row">
          {d.command && <CopyText text={d.command} label="Copy command" />}
          <CopyText text={d.arguments} label="Copy arguments" />
        </div>
      </section>

      <section className="axf-apx__sec axf-apx__grid">
        <div>
          <p className="fx-eyebrow">Who asked</p>
          {d.source ? (
            <dl className="axf-apx__dl">
              <dt>Source</dt><dd><SourceBadge details={d} /></dd>
              {d.source.session && <><dt>Name</dt><dd className="fx-mono">{d.source.session}</dd></>}
              {clientLine(d.source) && <><dt>Client</dt><dd>{clientLine(d.source)}</dd></>}
              {d.callerId && <><dt>Caller</dt><dd className="fx-mono">{d.callerId}</dd></>}
            </dl>
          ) : (
            <dl className="axf-apx__dl"><dt>Source</dt><dd className="fx-muted">Not recorded</dd>{d.callerId && <><dt>Caller</dt><dd className="fx-mono">{d.callerId}</dd></>}</dl>
          )}
        </div>
        <div>
          <p className="fx-eyebrow">Tool and policy</p>
          <dl className="axf-apx__dl">
            <dt>Tool</dt><dd className="fx-mono">{d.tool}</dd>
            <dt>Policy</dt><dd><Chip tone={d.policy === 'veto' ? 'warning' : undefined}>{POLICY_LABELS[d.policy]}</Chip></dd>
            <dt>State</dt><dd>{PHASE_LABELS[d.phase]}</dd>
          </dl>
          {d.risk.length > 0 && <div className="axf-apx__row" aria-label="Risk">{d.risk.map((r) => <Chip key={r} tone={r === 'destructive' || r === 'deletes' || r === 'secrets' ? 'danger' : r === 'read-only' ? 'success' : 'warning'}>{r}</Chip>)}</div>}
          {d.toolDescription && <p className="fx-small fx-muted axf-apx__text">{d.toolDescription}</p>}
        </div>
      </section>

      {timeline.length > 0 && (
        <section className="axf-apx__sec">
          <p className="fx-eyebrow">Timeline</p>
          <dl className="axf-apx__dl axf-apx__timeline">
            {timeline.map((t) => <span key={t.id} className="axf-apx__step" data-step={t.id}><dt>{t.label}</dt><dd className={t.id === 'countdown' && urgent ? 'is-urgent' : ''} role={t.live ? 'timer' : undefined}>{t.text}</dd></span>)}
          </dl>
        </section>
      )}

      {hasResult(d) && (
        <section className="axf-apx__sec">
          <p className="fx-eyebrow">Result</p>
          <p className={`axf-apx__exit${exitCode !== undefined && exitCode !== null && exitCode !== 0 ? ' is-bad' : exitCode === 0 ? ' is-good' : ''}`}>{exitLine({ phase: d.phase, exitCode })}</p>
          {tail.lines.length > 0 && <pre className="fx-mono axf-apx__code axf-apx__out" aria-label="Last lines of output">{tail.lines.join('\n')}</pre>}
          {tail.error && tail.lines.length === 0 && <p className="fx-small fx-muted axf-apx__text">Output isn't readable here ({tail.error}); the approval page has it.</p>}
        </section>
      )}

      <div className="axf-apx__row axf-apx__foot">
        <a className="fx-small axf-apx__link" href={d.url} target="_blank" rel="noopener noreferrer" onClick={page}>Full approval page <Icon name="external" size={12} /></a>
        {left !== null && <span className={`fx-small axf-apx__count${urgent ? ' is-urgent' : ''}`}>{d.veto?.shelved ? 'Shelved' : left > 0 ? `Runs in ${formatCountdown(left)}` : 'Running'}</span>}
      </div>

      {children}
      {waiting && onDecide && d.decisions.length > 0 && <Decide d={d} busy={busy} onDecide={onDecide} />}
    </div>
  );
}

/* ---------------------------------------------------------------- the application menu's rows */

/**
 * The open part of an approval row in the application menu's "Waiting for approval" list (`expand: approval:<id>`,
 * framework AppMenu LiveRow): the same details panel, live (re-read every second from the list that showed it), with
 * Deny / Approve inside through that list's deciding path.
 */
function MenuApprovalDetails({ id }: { id: string }) {
  const rt = useOptionalRuntime();
  useTick(true);
  const [busy, setBusy] = useState('');
  const found = lookupApproval(id);
  if (!found) return <p className="fx-small fx-muted axf-apx__gone">No longer waiting on axHub.</p>;
  const { item, lookup } = found;
  const hub = lookup.hub();
  const decide = async (d: ApprovalDecision) => {
    setBusy(`${item.id}:${d}`);
    try {
      const r = await (lookup.decide ?? ((i: ApprovalItem, x: ApprovalDecision) => decideApproval(hub, i, x)))(item, d);
      if (!r.opened) rt?.toast(r.message, r.ok ? 'success' : 'danger', 'Approvals');
    } catch (e) {
      rt?.toast((e as Error)?.message || 'Something went wrong.', 'danger', 'Approvals');
    } finally { setBusy(''); }
  };
  return <ApprovalDetailsPanel className="axf-apx--menu" details={detailsOfItem(item)} hub={hub} busy={busy} onDecide={(d) => void decide(d)} openPage={openHubPage} />;
}
registerMenuRowDetails('approval', (id) => <MenuApprovalDetails id={id} />);

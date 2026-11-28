/**
 * Plan Studio 2.0, sent plans on the page: the state badge, the "From orchestrator" mark, the lock, the read-only
 * editor of a sent row with the orchestrator's actions, the history dialog and the settings panel for how each state
 * looks. Display only: every value drawn here was read from the builds store by the server (live-core.mjs), every
 * button sends one tap to the server, and every look is a set of classes drawn from theme tokens.
 */
import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Container, Icon, Note, SelectField, Switch, useAxfState, useRuntime } from '@console/axf/react';
import { LoadingSkeleton } from '@console/emptyState';
import { ShippedPanel } from './shipped';
import * as tc from './tree-core.mjs';
import type { Item, Live, State } from './tree-core.mjs';
import * as live from './live-core.mjs';
import type { HistoryRow, LiveState, Look, OrchAction } from './live-core.mjs';
import { CTX_TARGET, KEYS, historyOf, orchestrate, restoreSteps } from './api';

const B = 'axp-plan-studio-2';
const T = 'Plan Studio 2.0';
type Rt = ReturnType<typeof useRuntime>;
export type OrchMark = 'both' | 'badge' | 'tint';
export const ORCH_MARKS: { value: OrchMark; label: string }[] = [{ value: 'both', label: 'A badge and a tinted row' }, { value: 'badge', label: 'A badge only' }, { value: 'tint', label: 'A tinted row only' }];

/** The saved looks over the defaults, and how orchestrator steps are marked (Settings → Plugins → Plan Studio 2.0). */
export function readLooks(rt: Rt): Record<LiveState, Look> { try { return live.normLooks(rt.settings.get(KEYS.stateLooks)); } catch { return live.normLooks(null); } }
export function readOrchMark(rt: Rt): OrchMark { try { const v = rt.settings.get(KEYS.orchMark); return ORCH_MARKS.some((m) => m.value === v) ? (v as OrchMark) : 'both'; } catch { return 'both'; } }
const chipTone = (t: string): 'accent' | 'success' | 'warning' | 'danger' | undefined => (t === 'accent' || t === 'success' || t === 'warning' || t === 'danger' ? t : undefined);

/** The sent plan a row belongs to: its own `live`, else the nearest one above it. */
export function sentOf(state: State, item: Item): Live | null {
  if (item.live) return item.live;
  for (const a of [...tc.ancestors(state, item.id)].reverse()) if (a.live) return a.live;
  return null;
}

/** The state badge. `data-status` is the status the VPS sent, so a status style or a badge pack picks it up. */
export function LiveBadge({ l, look }: { l: Live; look: Look }) {
  const tip = [l.label, l.build && `build ${l.build}`, l.step && `step ${l.step}`, l.pr && `PR #${l.pr}`, l.held && 'on hold'].filter(Boolean).join(' · ');
  return <span className={`${B}__state`} data-status={l.status} data-ps2-state={l.state} title={tip}><Chip tone={chipTone(look.tone)}>{l.state === 'failed' ? l.label : l.stateLabel}{l.held ? ' (on hold)' : ''}</Chip></span>;
}
/** "From orchestrator": the step was filed by the orchestrator, not designed here. */
export function OrchBadge() {
  return <span className={`${B}__from`} data-ps2-origin={live.ORIGIN} title="Filed by the orchestrator: read from the builds store, not one of your own steps"><Chip>{live.ORIGIN_LABEL}</Chip></span>;
}
/** The lock on a sent row (where the drag grip sits on an open one). */
export function LockMark({ orch }: { orch: boolean }) {
  return <span className={`${B}__grip is-locked`} title={orch ? 'Filed by the orchestrator: not changed here' : 'Locked: sent to the orchestrator'} aria-label="Locked"><Icon name="lock" size={14} /></span>;
}
/** How a sent step shows done: a check box, a check mark or nothing (the state's look). Never tappable: the orchestrator checks it off. */
export function LiveMark({ item, look }: { item: Item; look: Look }) {
  const tip = item.done ? 'Done (checked off by the orchestrator)' : 'Not done yet';
  if (look.mark === 'none') return <span className={`${B}__fold is-leaf`} />;
  if (look.mark === 'check') return <span className={`${B}__mark${item.done ? ' is-on' : ''}`} title={tip}><Icon name={item.done ? 'check' : 'minus'} size={14} /></span>;
  return <Checkbox label="" title={tip} checked={item.done} disabled onChange={() => undefined} />;
}

const ACTION_ICON: Record<OrchAction, string> = { queue: 'list', hold: 'pause', release: 'play', retry: 'refresh', rebuild: 'hammer', 'run-ci': 'shield', land: 'check', cancel: 'x' };
/** Send one orchestrator action for a row and say what the server answered. */
export function runOrchAction(rt: Rt, id: string, action: OrchAction): void {
  void orchestrate(id, action).then((r) => rt.toast(r.say ?? (r.ok ? 'Done.' : r.error ?? 'That did not work.'), r.ok ? 'success' : 'danger', T), (e: Error) => rt.toast(e.message, 'warning', T));
}
/** Open a sent row's build in the orchestrator. */
export function openInOrchestrator(rt: Rt, build: string): void {
  if (!build || !rt.dispatch(`build-orchestrator.open:${build}`)) rt.toast(build ? `Build ${build}: the build orchestrator is not installed here.` : 'That is not sent to the orchestrator yet.', 'warning', T);
}

/** The editor of a sent row: read-only, with what the orchestrator may be asked to do with it. */
export function SentEditor({ item, state }: { item: Item; state: State }) {
  const rt = useRuntime();
  useAxfState();
  const looks = readLooks(rt);
  const sent = sentOf(state, item);
  const orch = item.origin === live.ORIGIN;
  const path = tc.ancestors(state, item.id);
  const own = item.live ?? null;
  return (
    <section className={`${B}__editor fx-card`} data-fx-ctx-target={CTX_TARGET} data-fx-ctx-payload={item.id}>
      <p className="fx-eyebrow">{path.length ? path.map((a) => a.title).join(' › ') : 'Top level'} · {tc.KIND_LABEL[item.kind]}{orch ? ` · ${live.ORIGIN_LABEL}` : ''}</p>
      <Note tone="info" icon="lock">{orch
        ? 'The orchestrator filed this step. It is read from the builds store and checks off here as the orchestrator moves it; it is not changed in Plan Studio.'
        : `Sent to the orchestrator${sent ? ` as ${sent.build}` : ''}. Locked until the build lands or is cancelled: nothing in it is edited, moved, added or deleted.`}</Note>
      <p className={`${B}__senttitle`}>{item.title}</p>
      {item.body.trim() && <p className={`${B}__sentbody`}>{item.body}</p>}
      <p className={`${B}__sentmeta`}>
        {own && <LiveBadge l={own} look={looks[own.state as LiveState]} />}
        {orch && <OrchBadge />}
        {sent && <span className={`${B}__n`}>Build {sent.build}</span>}
        {own?.step && <span className={`${B}__n`}>Step {own.step}</span>}
        {own?.pr && <span className={`${B}__n`}>PR #{own.pr}</span>}
        {own && own.attempt > 1 && <span className={`${B}__n`}>Attempt {own.attempt}</span>}
        {item.model && <span className={`${B}__n`}>{item.model}</span>}
        {item.minutes > 0 && <span className={`${B}__n`}>{item.minutes} min</span>}
        {own?.steps && own.steps.total > 0 && <span className={`${B}__n`}>{own.steps.done}/{own.steps.total} steps done</span>}
      </p>
      <ShippedPanel item={item} />
      <div className={`${B}__editrow`} role="group" aria-label="Orchestrator actions">
        {live.ACTIONS.map((a) => <Button key={a} size="sm" icon={ACTION_ICON[a]} tone={a === 'cancel' ? 'danger' : undefined} onClick={() => runOrchAction(rt, item.id, a)}>{live.ACTION_LABEL[a]}</Button>)}
        <Button size="sm" tone="quiet" icon="external" onClick={() => openInOrchestrator(rt, sent?.build ?? '')}>Open in orchestrator</Button>
      </div>
      <p className={`${B}__hint fx-muted`}>Each action is sent to the orchestrator, which decides whether it fits where the build is and answers here.</p>
    </section>
  );
}

/** The planning steps a send replaced, kept on the item: read them, bring them back once the plan is no longer locked. */
export function HistoryDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const id = typeof props.id === 'string' ? props.id : '';
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (id) void historyOf(id).then(setRows, (e: Error) => setErr(e.message)); }, [id]);
  const back = (entry: string) => void restoreSteps(id, entry).then((r) => { rt.toast(r.say ?? 'Brought back.', 'success', T); close(); }, (e: Error) => setErr(e.message));
  return (
    <div className={`${B}__dialog fx-stack`}>
      <p className="fx-muted">When the orchestrator files its own steps for a sent plan, the planning steps that were sent leave the list and are kept here. A build cancelled before it lands gives them back by itself.</p>
      {err && <Note tone="danger">{err}</Note>}
      {!rows && !err ? <LoadingSkeleton rows={2} label="Loading the history" /> : rows && !rows.length ? <Note tone="info">Nothing here: no send has replaced this item's steps.</Note> : (
        <ul className={`${B}__history`} aria-label="Replaced planning steps">
          {(rows ?? []).map((h) => (
            <li key={h.id}>
              <p className={`${B}__n`}>{h.title} · {new Date(h.at).toLocaleString()}{h.restoredAt ? ` · brought back ${new Date(h.restoredAt).toLocaleString()}` : ''}</p>
              <ol className={`${B}__steps`}>{h.steps.map((s) => <li key={s.id}>{s.title}</li>)}</ol>
              {!h.restoredAt && <Button size="sm" icon="undo" onClick={() => back(h.id)}>Bring these steps back</Button>}
            </li>
          ))}
        </ul>
      )}
      <div className={`${B}__editrow`}><Button tone="quiet" onClick={close}>Close</Button></div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings: how each state looks */

const pickOptions = (xs: readonly string[], none: string, names: Record<string, string> = {}) => xs.map((x) => ({ value: x, label: x ? names[x] ?? `${x.charAt(0).toUpperCase()}${x.slice(1)}` : none }));
const MARK_NAMES = { box: 'Check box', check: 'Check mark', none: 'Nothing' };
const FONT_NAMES = { mono: 'Monospace', display: 'Display' };
const sample = (s: LiveState): Item => ({ ...tc.normItem({ id: `sample-${s}`, kind: 'step', title: 'A step the orchestrator filed', done: s === 'landed' }), origin: 'orchestrator', locked: true });
const sampleLive = (s: LiveState): Live => ({ $axf: 'plan-live@1', build: 'sample', profile: '', step: 's1', status: s === 'ci' ? 'running-ci' : s === 'sent' ? 'pending' : s === 'waiting' ? 'completed' : s === 'merging' ? 'merging-pr' : s === 'recompiling' ? 'pr-pulling-main' : s, label: live.STATE_LABEL[s], state: s, stateLabel: live.STATE_LABEL[s], attempt: 1, at: '' });

/** Settings → Plugins → Plan Studio 2.0: the look of each state a sent step can be in. */
export function StateLooksPanel() {
  const rt = useRuntime();
  useAxfState();
  const looks = readLooks(rt);
  const set = (s: LiveState, patch: Partial<Look>) => rt.settings.set(KEYS.stateLooks, { ...looks, [s]: live.normLook({ ...looks[s], ...patch }, s) } as never);
  return (
    <div className={`${B}__looks fx-stack`}>
      <p className="fx-muted">How a sent plan's steps look in each state: a check box, a check mark, a state badge, strike-through, colours, font, weight and style, in any combination. Every pick is drawn from the theme, so it follows the skin. The badge carries the orchestrator's status, so a status style or a badge pack applies to it too.</p>
      {live.STATES.map((s) => {
        const l = looks[s];
        return (
          <Container key={s} title={live.STATE_LABEL[s]} collapsible defaultOpen={false}>
            <ul className={`${B}__tree ${B}__lookdemo`} aria-label={`${live.STATE_LABEL[s]} sample`}>
              <li className={`${B}__row is-live ${live.lookClasses(l)}`} data-ps2-state={s}>
                <LiveMark item={sample(s)} look={l} />
                <span className={`${B}__title`}><span className={`${B}__text`}>A step the orchestrator filed</span></span>
                {l.badge && <LiveBadge l={sampleLive(s)} look={l} />}
              </li>
            </ul>
            <div className={`${B}__fields`}>
              <SelectField label="Done mark" value={l.mark} options={pickOptions(live.LOOK_MARKS, '', MARK_NAMES)} onChange={(v) => set(s, { mark: v as Look['mark'] })} />
              <SelectField label="Text colour" value={l.tone} options={pickOptions(live.LOOK_TONES, 'Normal')} onChange={(v) => set(s, { tone: v })} />
              <SelectField label="Background" value={l.fill} options={pickOptions(live.LOOK_TONES, 'None')} onChange={(v) => set(s, { fill: v })} />
              <SelectField label="Font" value={l.font} options={pickOptions(live.LOOK_FONTS, 'Normal', FONT_NAMES)} onChange={(v) => set(s, { font: v })} />
              <SelectField label="Weight" value={l.weight} options={pickOptions(live.LOOK_WEIGHTS, 'Normal')} onChange={(v) => set(s, { weight: v })} />
              <SelectField label="Style" value={l.style} options={pickOptions(live.LOOK_STYLES, 'Normal')} onChange={(v) => set(s, { style: v })} />
            </div>
            <div className={`${B}__editrow`}>
              <Switch label="State badge" checked={l.badge} onChange={(v) => set(s, { badge: v })} />
              <Switch label="Strike-through" checked={l.strike} onChange={(v) => set(s, { strike: v })} />
            </div>
          </Container>
        );
      })}
      <div className={`${B}__editrow`}><Button icon="undo" onClick={() => { rt.settings.set(KEYS.stateLooks, null as never); rt.toast('State looks are back to the defaults.', 'info', T); }}>Reset every state</Button></div>
    </div>
  );
}

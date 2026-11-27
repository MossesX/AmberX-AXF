/**
 * Plan Studio 2.0, the build under a sent plan: the build number, the state badge with the plain status line, the
 * waiting reason, who split it, the merge line, a clash with what may be done instead, and the build's steps in a
 * table (the step's unique id in its own column, the split mark, the model the triage gate gave it, its status).
 *
 * Display only. Everything shown was read from the builds store by the server (GET plans/<planId>/build), follows the
 * builds event stream (build-feed.ts) and is never kept in the plan tree. The words come from live-core.mjs
 * (buildSummary), so the CLI and the page say the same thing. Until the first read answers, the rows the tree already
 * carries for the build are listed, so the panel is never empty for a split build.
 */
import { Button, Chip, Icon, Note, useRuntime } from '@console/axf/react';
import type { Item } from './tree-core.mjs';
import * as live from './live-core.mjs';
import type { BuildInfo, ClashOption, LiveState, Look, OrchAction, StepInfo } from './live-core.mjs';
import { orchestrate, select } from './api';
import { usePlanBuild } from './build-feed';
import { openInOrchestrator } from './live';

const B = 'axp-plan-studio-2';
const T = 'Plan Studio 2.0';
type Tone = 'accent' | 'success' | 'warning' | 'danger' | undefined;
const chipTone = (t: string): Tone => (t === 'accent' || t === 'success' || t === 'warning' || t === 'danger' ? t : undefined);
const stepTone = (s: StepInfo): Tone => (s.status === 'failed' ? 'danger' : s.waitsFor && !s.done ? 'warning' : s.done ? 'success' : s.state === 'building' ? 'accent' : undefined);

/** A step row of the tree (already read with the tree) as the table lists it, until the build's own read answers. */
function fromRow(i: Item): StepInfo {
  const l = i.live;
  return {
    id: l?.step ?? '', uid: '', row: i.id, title: i.title, text: i.body, model: i.model, modelBy: '', splitBy: '', status: l?.status ?? '', label: l?.label ?? '',
    state: (l?.state ?? 'sent') as LiveState, stateLabel: l?.stateLabel ?? '', attempt: l?.attempt ?? 1, done: i.done, minutes: i.minutes, ...(l?.pr ? { pr: l.pr } : {}),
  };
}
/** The plan row's own state as a build, until the build's own read answers (the raw status, no pipeline view). */
function fromLive(item: Item): BuildInfo | null {
  const l = item.live;
  if (!l) return null;
  return { id: l.build, number: l.number ?? '', title: item.title, status: l.status, label: l.label, state: l.state as LiveState, stateLabel: l.stateLabel, attempt: l.attempt, at: l.at, pipelineView: null, split: null, clash: null, pr: 0, prUrl: '', branch: '', held: !!l.held, landed: l.state === 'landed' };
}

/** The split mark: who cut the build into steps ("Split by Fable on the VPS"). */
export function SplitBadge({ by, model = '' }: { by: string; model?: string }) {
  const text = live.splitLabel(by, model);
  if (!text) return null;
  return <span className={`${B}__splitmark`} data-ps2-split={by} title="The VPS splitting stage designed these steps so that none touches another's files"><Chip tone="accent">{text}</Chip></span>;
}

/** A clash answered by hand (it never blocks; the pipeline answers run-all itself): each option is one tap sent to the orchestrator, which decides. */
function ClashOptions({ planId, options }: { planId: string; options: ClashOption[] }) {
  const rt = useRuntime();
  const pick = (o: ClashOption) => void orchestrate(planId, o.action as OrchAction).then((r) => rt.toast(r.say ?? (r.ok ? 'Done.' : r.error ?? 'That did not work.'), r.ok ? 'success' : 'danger', T), (e: Error) => rt.toast(e.message, 'warning', T));
  return (
    <ul className={`${B}__clash`} aria-label="What you can do instead">
      {options.map((o) => (
        <li key={o.id || o.label}>
          <div className={`${B}__editrow`}>
            {o.action ? <Button size="sm" icon={o.id === 'run-all' ? 'play' : 'clock'} onClick={() => pick(o)}>{o.label}</Button> : <span className={`${B}__senttitle`}>{o.label}</span>}
            {o.line && <span className="fx-muted">{o.line}</span>}
          </div>
          {o.steps.length > 0 && (
            <ul className={`${B}__deferred`} aria-label="Deferred steps">
              {o.steps.map((s) => <li key={s.uid || s.step}><span className={`${B}__uid`}>{s.uid || s.step}</span>{s.title ? ` ${s.title}` : ''}{s.waitsFor ? `: ${live.deferLine(s.waitsFor)}, starts by itself once it lands` : ''}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The panel under a sent plan's row. `rows` are the step rows the tree carries for this plan (they open the step in
 * the editor and stand in until the build is read); `open` is whether the plan is unfolded (folded: no table).
 */
export function BuildPanel({ item, rows, open, depth, selected, looks }: { item: Item; rows: Item[]; open: boolean; depth: number; selected: string | null; looks: Record<LiveState, Look> }) {
  const rt = useRuntime();
  const l = item.live;
  const { data, error } = usePlanBuild(item.id, l ? `${l.build}|${l.status}|${l.at}|${l.steps?.done ?? 0}/${l.steps?.total ?? 0}` : '');
  const build = data?.build ?? fromLive(item);
  if (!build) return null;
  const steps = data?.build ? data.steps : rows.filter((r) => r.live?.build === build.id).map(fromRow);
  const sum = live.buildSummary(build);
  const byRow = new Map(rows.map((r) => [r.id, r]));
  const done = steps.filter((s) => s.done).length;
  return (
    <li className={`${B}__buildrow`} role="none" style={{ ['--axp-ps2-depth' as string]: depth + 1 }} data-ps2-build={build.id} data-ps2-pipeline={sum.state}>
      <section className={`${B}__build`} aria-label={`Build ${sum.name} of ${item.title}`}>
        <p className={`${B}__buildhead`}>
          <button type="button" data-fx-row className={`${B}__buildno`} data-axf-target={`button:build.${build.id}`} title={`Build ${build.id}: open it in the orchestrator`} onClick={() => openInOrchestrator(rt, build.id)}>Build {sum.name}</button>
          <span className={`${B}__state`} data-status={sum.state} data-ps2-raw={sum.raw ? '' : undefined} title={sum.raw ? `Status ${build.status}` : `${sum.label} · status ${build.status}`}>
            <Chip tone={chipTone(sum.tone)}>{sum.icon && <Icon name={sum.icon} size={12} />} {sum.label}{build.held ? ' (on hold)' : ''}</Chip>
          </span>
          {build.split && <SplitBadge by={build.split.by} model={build.split.model} />}
          {build.emergency && <Chip tone="danger">Emergency</Chip>}
          {sum.attempt > 1 && <span className={`${B}__n`}>Attempt {sum.attempt}</span>}
          {build.pr > 0 && <span className={`${B}__n`}>PR #{build.pr}</span>}
          {steps.length > 0 && <span className={`${B}__n`} title="Steps done">{done}/{steps.length} steps</span>}
        </p>
        {sum.line && <p className={`${B}__buildline`} data-ps2-line="status">{sum.line}</p>}
        {sum.waiting && <p className={`${B}__buildline is-waiting`} data-ps2-line="waiting"><Icon name="clock" size={14} /> {sum.waiting}</p>}
        {sum.merge && <p className={`${B}__buildline is-merge`} data-ps2-line="merge"><Icon name="branch" size={14} /> {sum.merge.charAt(0).toUpperCase()}{sum.merge.slice(1)}</p>}
        {build.clash && (
          <div className={`${B}__clashbox`} data-ps2-clash>
            <Note tone="warning" icon="alert">Clash: {build.clash.reason || 'it touches work that is not on main yet'}{build.clash.with.length ? ` (${build.clash.with.map(live.refName).join(', ')})` : ''} {build.clash.auto ? 'It carries on by itself: every step runs, and a conflict with main is fixed by a session.' : `Answered${build.clash.answeredBy ? ` by ${build.clash.answeredBy}` : ''}: ${build.clash.answer === 'defer' ? 'the clashing steps wait' : 'every step runs'}.`}</Note>
            {build.clash.options.length > 0 && <ClashOptions planId={item.id} options={build.clash.options} />}
          </div>
        )}
        {error && !data && <p className={`${B}__hint fx-muted`}>The build could not be read just now ({error}); showing what the tree last read.</p>}
        {open && steps.length > 0 && (
          <>
            {sum.splitByVps && <p className={`${B}__hint fx-muted`}>Steps defined by the VPS: they are read from the builds store and check off here as the orchestrator moves them.</p>}
            <div className="fx-tablewrap">
              <table className={`fx-table ${B}__stepstable`} aria-label={`Steps of build ${sum.name}`}>
                <thead><tr><th scope="col">Step ID</th><th scope="col">Step</th><th scope="col">Split</th><th scope="col">Model</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {steps.map((s) => {
                    const look = looks[s.state];
                    const row = byRow.get(s.row);
                    return (
                      <tr key={s.id || s.row} aria-selected={selected === s.row} className={`is-live ${live.lookClasses(look)}`} data-ps2-state={s.state} data-fx-ctx-target={row ? 'axp-plan-studio-2-item' : undefined} data-fx-ctx-payload={row ? s.row : undefined}>
                        <td className={`${B}__uid`} data-ps2-col="uid" data-label="Step ID">{s.uid || '-'}</td>
                        <td data-ps2-col="step" data-label="Step">
                          <button type="button" data-fx-row className={`${B}__steplink`} data-axf-target={`button:item.${s.row}`} disabled={!row} onClick={() => select(s.row)} title={s.text || s.title}>
                            <span className={`${B}__n`}>{s.id}</span> <span className={`${B}__text`}>{s.title}</span>
                          </button>
                        </td>
                        <td data-ps2-col="split" data-label="Split">{s.splitBy ? <SplitBadge by={s.splitBy} model={build.split?.model ?? ''} /> : <span className="fx-muted">-</span>}</td>
                        <td data-ps2-col="model" data-label="Model">{s.model ? <span title={live.byTriage(s) ? 'Picked by the triage gate' : undefined}><Chip tone={s.model === 'Fable' ? 'accent' : undefined}>{s.model}</Chip>{live.byTriage(s) && <span className={`${B}__n`}> triage</span>}</span> : <span className="fx-muted">{live.modelText(s)}</span>}</td>
                        <td data-ps2-col="status" data-label="Status"><span className={`${B}__state`} data-status={s.status}><Chip tone={stepTone(s)}>{s.label || s.status}{s.pr && s.status === 'in-pr' ? ` #${s.pr}` : ''}</Chip></span>{s.pr && s.status !== 'in-pr' ? <span className={`${B}__n`}> PR #{s.pr}</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </li>
  );
}

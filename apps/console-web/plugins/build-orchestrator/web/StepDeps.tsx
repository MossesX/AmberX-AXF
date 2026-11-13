import { useEffect, useState } from 'react';
import { Button, Chip, ChoiceGrid, Note, useRuntime } from '@console/axf/react';
import { fillApi, type StepState } from './fill';

/*
 * Step dependencies (fill every slot, Nov 13 2026): in a build's detail, every step with what it waits for (dependsOn,
 * resolved: a step without a list waits for the step before it) and its state: done, running in slot N (or in the build's
 * own session), ready, waiting on …, blocked by a merge conflict. Edit opens a multi-select of the earlier steps; Save
 * posts builds/<id>/steps/<step>/deps (the MCP command pipeline-step-deps, `pipeline.mjs fill deps`, the voice action
 * build-orchestrator.pipeline-step-deps). Independent = [] (may run in parallel at once), Sequential = no list.
 * Deep link: console_show `builds/<id>/steps`.
 */

type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
const TONE: Record<StepState['state'], 'success' | 'accent' | 'warning' | 'danger' | undefined> = { done: 'success', skipped: undefined, running: 'accent', ready: 'warning', waiting: undefined, blocked: 'danger' };
export const stepsAnchor = (build: string) => `build-${build}-steps`;

function stateText(s: StepState): string {
  if (s.state === 'running') return s.runningIn?.main ? "running in the build's own session" : `running in slot ${s.runningIn?.n || '?'}`;
  if (s.state === 'waiting') return s.waitingOn.length ? `waiting on ${s.waitingOn.join(', ')}` : s.why || 'waiting';
  if (s.state === 'blocked') return s.why || 'blocked by a merge conflict';
  return s.state;
}

export function StepDeps({ api, build }: { api: Api; build: string }) {
  const rt = useRuntime();
  const fill = fillApi(api);
  const [steps, setSteps] = useState<StepState[] | null>(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { const r = await fill.status(build); setSteps(r.build?.steps ?? []); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [build]);
  const save = async (step: string, deps: string[] | null) => {
    setBusy(true);
    try {
      const r = await fill.deps(build, step, deps);
      rt.toast(`${r.step}: ${r.explicit === null ? 'sequential' : r.dependsOn.length ? `after ${r.dependsOn.join(', ')}` : 'independent'}`, 'success');
      setEdit(''); await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  if (error) return <Note tone="warning">Step dependencies: {error}</Note>;
  if (!steps) return <p className="fx-small fx-muted">Loading step dependencies…</p>;
  if (!steps.length) return null;
  return (
    <section className="pl-deps fx-stack" id={stepsAnchor(build)} aria-label={`${build} step dependencies`}>
      <h4 className="pd-card__title">Step dependencies <span className="fx-muted fx-small">· a step runs beside others once everything it waits for is done</span></h4>
      <ol className="pl-deps__list">
        {steps.map((s, i) => (
          <li key={s.id} className="pl-deps__step">
            <div className="pl-deps__row">
              <span className="fx-mono fx-small">{s.id}</span>
              <span className="fx-small pl-deps__text" title={s.text}>{s.text}</span>
              <Chip tone={TONE[s.state]}>{stateText(s)}</Chip>
              <span className="fx-small fx-muted">{s.explicit === null ? (s.dependsOn.length ? `after ${s.dependsOn.join(', ')} (in order)` : 'first') : s.dependsOn.length ? `after ${s.dependsOn.join(', ')}` : 'independent'}</span>
              {!s.done && !s.skip && <Button size="sm" tone="neutral" icon="edit" disabled={busy} onClick={() => { setEdit(edit === s.id ? '' : s.id); setPick(s.dependsOn); }}>{edit === s.id ? 'Close' : 'Edit'}</Button>}
            </div>
            {edit === s.id && (
              <div className="pl-deps__edit fx-stack">
                {i > 0 ? <ChoiceGrid multiple label={`${s.id} waits for`} selected={pick} onToggle={(id) => setPick((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
                  choices={steps.slice(0, i).map((e) => ({ id: e.id, title: e.id, text: e.text, tag: e.state }))} />
                  : <p className="fx-small fx-muted">The first step waits for nothing.</p>}
                <div className="fx-row fx-row--wrap">
                  <Button size="sm" tone="primary" icon="check" disabled={busy} onClick={() => void save(s.id, pick)}>Save{pick.length ? ` (after ${pick.join(', ')})` : ' (independent)'}</Button>
                  <Button size="sm" tone="neutral" icon="list" disabled={busy} title="No list: it waits for the step before it, as builds always did" onClick={() => void save(s.id, null)}>Sequential</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

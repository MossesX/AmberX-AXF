import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Icon, Segmented, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as P from './packager-core.mjs';

const reloadOrchestrator = () => window.dispatchEvent(new Event('axf-orchestrator-reload')); // ui.tsx RELOAD_EVENT

/*
 * Package builds window (build-package@1, Brett Nov 4 2026). Every waiting step on its own, grouped by source build:
 * tick per step, per group, all, none or invert; the "All Fable work" preset only pre-ticks. The ticked steps are the
 * package in priority order (drag or arrows; steps of one build keep their order). Missing prerequisites are warned
 * about, with Bring along. Then: send to a helper (Session sync) or add to this orchestrator at a position. Nothing is
 * packaged or sent before the ticked list is shown and confirmed. All rules are in packager-core.mjs; the server
 * refuses secondary sessions.
 */

const FOLDER = 'build-orchestrator';
const api = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Cand = P.Candidate;
type Helper = { id: string; account?: string; agent?: string; client?: string; lastSeenAt?: string };
type Listing = { ok: boolean; role: string; hidden?: string; candidates: Cand[]; skipped: { noSteps: string[]; inProgress: string[] }; facets: Record<string, { value: string; n: number }[]>; profiles: string[]; profile: string; helpers: Helper[]; canSend: boolean; sessionSync: boolean; chat: boolean };
type Result = { ok: boolean; build?: { id: string; title: string; steps: unknown[] }; log?: string[]; reanalysis?: { moves: { id: string; from: number; to: number; why: string }[]; conflicts: string[] }; send?: { sent: boolean; why?: string; to?: string }; posted?: boolean; error?: string };
type Filter = typeof P.DEFAULT_FILTER;

export function PackagerDialog({ preset, close }: { preset?: string; close: () => void }) {
  const rt = useRuntime();
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>({ ...P.DEFAULT_FILTER });
  const [sel, setSel] = useState<string[]>([]);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [name, setName] = useState('');
  const [model, setModel] = useState<'keep' | 'Fable' | 'Opus'>('keep');
  const [thinking, setThinking] = useState('high');
  const [dest, setDest] = useState<'helper' | 'mine'>('mine');
  const [to, setTo] = useState('');
  const [now, setNow] = useState(true);
  const [position, setPosition] = useState('0');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState('');

  const load = async () => {
    try { const r = await api.call<Listing>('package/candidates'); setData(r); setError(''); return r; }
    catch (e) { setError((e as Error).message); return null; }
  };
  useEffect(() => {
    void load().then((r) => {
      if (!r || preset !== 'all-fable') return;
      setSel(P.presetKeys(r.candidates, 'all-fable')); setDest(r.canSend ? 'helper' : 'mine'); setNow(true); setModel('keep');
    });
  }, [preset]);

  const all = data?.candidates ?? [];
  const byKey = useMemo(() => new Map(all.map((c) => [c.key, c])), [all]);
  const shown = useMemo(() => P.filterCandidates(all, filter), [all, filter]);
  const groups = useMemo(() => P.groups(shown), [shown]);
  const ordered = useMemo(() => P.keepDeps(sel, all), [sel, all]);
  const picked = ordered.order.map((k) => byKey.get(k)!).filter(Boolean);
  const minutes = picked.reduce((t, c) => t + c.minutes, 0);
  const deps = useMemo(() => P.dependencies(all, sel), [all, sel]);
  const raising = model !== 'keep' ? picked.filter((c) => model === 'Fable' && c.model === 'Opus').length : 0;
  const keys = shown.map((c) => c.key);
  const op = (o: string, k: string[] = keys) => setSel((s) => P.select(s, o, k));
  const set = (k: keyof Filter, v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const opts = (k: string, label: (v: string) => string = (v) => v) => (data?.facets[k] ?? []).map((f) => ({ value: f.value, label: `${label(f.value)} (${f.n})` }));

  if (error) return <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>;
  if (!data) return <div className="fx-empty">Reading every waiting step…</div>;
  if (data.role !== 'primary') return <div className="fx-empty">{data.hidden ?? 'Packaging is the primary session\'s job.'}</div>;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<Result>('package', {
        order: ordered.order, confirmed: true, name: name.trim() || undefined, model, thinking,
        position: position === 'end' ? 'end' : Number(position), dest, to: dest === 'helper' ? to : undefined, now: dest === 'helper' ? now : undefined,
      });
      setResult(r); setConfirming(false); setSel([]);
      rt.terminal.log('orchestrator', `package ${r.build?.id}: ${(r.log ?? []).join('; ')}`, 'ok');
      rt.toast(r.send?.sent ? `Package sent to ${r.send.to}` : `Package ${r.build?.id} added`, r.send && dest === 'helper' && !r.send.sent ? 'warning' : 'success');
      void load(); reloadOrchestrator();
    } catch (e) { rt.toast((e as Error).message, 'danger'); rt.terminal.log('orchestrator', (e as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  if (result) return (
    <div className="fx-stack oc-pack">
      <p className="pl-note is-ok"><Icon name="check-circle" size={14} />Package <b className="fx-mono">{result.build?.id}</b> made: {result.build?.steps.length} steps.</p>
      {dest === 'helper' && <p className={`pl-note ${result.send?.sent ? 'is-ok' : 'is-warn'}`}><Icon name={result.send?.sent ? 'rocket' : 'alert'} size={14} />{result.send?.sent ? `Sent to ${result.send.to}${now ? ' (do it now)' : ''}.` : result.send?.why}</p>}
      {(result.reanalysis?.moves ?? []).length > 0 && <div className="pd-thread"><h3>Order re-analyzed</h3>{result.reanalysis!.moves.map((m) => <p key={m.id} className="fx-small">{m.id}: {m.from + 1} → {m.to + 1} · {m.why}</p>)}</div>}
      {(result.reanalysis?.conflicts ?? []).map((c) => <p key={c} className="fx-small fx-muted">{c}</p>)}
      {!result.posted && <p className="fx-small fx-muted">The Breakroom Sessions channel isn't available here, so nothing was posted.</p>}
      <div className="fx-row fx-row--wrap"><Button icon="plus" onClick={() => setResult(null)}>Package more</Button><Button tone="primary" icon="check" onClick={close}>Done</Button></div>
    </div>
  );

  return (
    <div className="fx-stack oc-pack">
      <div className="oc-pack__filters">
        <SelectField label="Model" value={filter.model} empty="Any model" options={opts('model')} onChange={(v) => set('model', v)} />
        <SelectField label="Thinking" value={filter.thinking} empty="Any" options={opts('thinking')} onChange={(v) => set('thinking', v)} />
        <SelectField label="Area" value={filter.area} empty="Any area" options={opts('area')} onChange={(v) => set('area', v)} />
        <SelectField label="Profile" value={filter.profile} empty="Any profile" options={opts('profile')} onChange={(v) => set('profile', v)} />
        <SelectField label="Status" value={filter.status} empty="Any status" options={opts('status')} onChange={(v) => set('status', v)} />
        <TextField label="Search" value={filter.q} onChange={(v) => set('q', v)} placeholder="step, build, category" />
      </div>
      <div className="oc-bar" role="toolbar" aria-label="Package selection">
        <Button size="sm" icon="check-circle" onClick={() => op('all')}>Select all</Button>
        <Button size="sm" icon="minus" onClick={() => op('none')}>Select none</Button>
        <Button size="sm" icon="shuffle" onClick={() => op('invert')}>Invert</Button>
        <Button size="sm" icon="zap" title={P.PRESETS['all-fable']!.label + ' (ticks every Fable step; you confirm before anything is sent)'} onClick={() => { setSel(P.presetKeys(all, 'all-fable')); setDest(data.canSend ? 'helper' : 'mine'); setNow(true); }}>All Fable work</Button>
        <span className="fx-small fx-muted">{shown.length} shown · <b>{sel.length}</b> ticked{minutes ? ` · ~${P.fmtMinutes(minutes)}` : ''}</span>
      </div>
      {groups.length === 0 ? <div className="fx-empty">Nothing waiting matches.</div> : (
        <div className="oc-pack__list" role="list" aria-label="Waiting steps">
          {groups.map((g) => {
            const gk = g.items.map((c) => c.key); const n = gk.filter((k) => sel.includes(k)).length;
            return (
              <section key={g.build} className="oc-pack__group" role="listitem">
                <div className="oc-pack__ghead">
                  <Checkbox label={<span><b>{g.title}</b> <span className="fx-muted fx-small fx-mono">{g.build}</span></span>} checked={n === gk.length} indeterminate={n > 0 && n < gk.length} onChange={() => op('toggle', gk)} />
                  <span className="fx-small fx-muted">{g.status} · {n}/{gk.length}{g.minutes ? ` · ~${P.fmtMinutes(g.minutes)}` : ''}</span>
                  <button className="fx-iconbtn" aria-expanded={!shut[g.build]} title={shut[g.build] ? 'Show steps' : 'Hide steps'} onClick={() => setShut((s) => ({ ...s, [g.build]: !s[g.build] }))}><Icon name={shut[g.build] ? 'chevron-down' : 'chevron-up'} size={13} /></button>
                </div>
                {!shut[g.build] && g.items.map((c) => (
                  <div key={c.key} className="oc-pack__row">
                    <Checkbox title={c.fullText ?? c.text} label={<span className="oc-pack__text">{c.text}</span>} checked={sel.includes(c.key)} onChange={(v) => op(v ? 'add' : 'remove', [c.key])} />
                    <span className="oc-pack__meta">
                      <span className={`oc-model is-${c.model.toLowerCase()}`} title={c.recommendedModel && c.recommendedModel !== c.model ? `Audit recommends ${c.recommendedModel}` : c.why}>{c.model}{c.recommendedModel && c.recommendedModel !== c.model ? ` → ${c.recommendedModel}` : ''}</span>
                      {c.thinking && <span className="oc-flag">{c.thinking}</span>}
                      {c.estimate && <span className="oc-flag">~{c.estimate}</span>}
                      {c.areas.slice(0, 3).map((a) => <span key={a} className="oc-flag fx-mono">{a}</span>)}
                      <span className="oc-flag fx-mono">{c.step}</span>
                    </span>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {data.skipped.inProgress.length > 0 && <p className="fx-small fx-muted">{data.skipped.inProgress.length} step(s) are being built right now by their own session and aren't listed. {data.skipped.noSteps.length ? `${data.skipped.noSteps.length} build(s) have no steps yet: split them first.` : ''}</p>}

      {picked.length > 0 && (
        <div className="pd-thread">
          <h3>Package order (priority) · {picked.length} steps</h3>
          {ordered.fixed.length > 0 && <p className="fx-small fx-muted">Steps of one build keep their order, so their dependencies hold.</p>}
          <ol className="oc-pack__order">
            {picked.map((c, i) => (
              <li key={c.key} draggable className={`oc-pack__orow ${drag === c.key ? 'is-drag' : ''}`}
                onDragStart={() => setDrag(c.key)} onDragEnd={() => setDrag('')} onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (drag) setSel(P.move(ordered.order, drag, i)); setDrag(''); }}>
                <Icon name="grip" size={13} />
                <span className={`oc-model is-${c.model.toLowerCase()}`}>{c.model}</span>
                <span className="oc-pack__text" title={c.fullText ?? c.text}>{c.text}</span>
                <span className="fx-small fx-muted fx-mono">{c.build}</span>
                <button className="fx-iconbtn" disabled={i === 0} title="Higher priority" onClick={() => setSel(P.move(ordered.order, c.key, i - 1))}><Icon name="chevron-up" size={13} /></button>
                <button className="fx-iconbtn" disabled={i === picked.length - 1} title="Lower priority" onClick={() => setSel(P.move(ordered.order, c.key, i + 1))}><Icon name="chevron-down" size={13} /></button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {deps.length > 0 && <DepsNote deps={deps} onBring={() => setSel((s) => P.bringAlong(s, deps))} />}

      {picked.length > 0 && (
        <div className="pd-thread">
          <h3>The package</h3>
          <div className="oc-pack__filters">
            <TextField label="Name" value={name} onChange={setName} placeholder={P.suggestName(picked, model === 'keep' ? 'Fable' : model)} />
            <SelectField label="Model" value={model} onChange={(v) => setModel(v as typeof model)} options={[{ value: 'keep', label: 'Keep each step\'s model' }, { value: 'Fable', label: 'Fable for all' }, { value: 'Opus', label: 'Opus for all' }]} />
            <SelectField label="Thinking" value={thinking} onChange={setThinking} options={P.THINKING.map((t) => ({ value: t, label: t }))} />
          </div>
          {raising > 0 && <p className="pl-note is-warn"><Icon name="alert" size={14} />{raising} Opus step(s) would be raised to Fable: a model upgrade only you can approve (your click here counts; a session's doesn't).</p>}
          <Segmented label="Then" value={dest} onChange={setDest} options={[{ value: 'helper', label: 'Send to helper', icon: 'rocket' }, { value: 'mine', label: 'Add to my orchestrator', icon: 'layers' }]} />
          {dest === 'helper' ? (
            data.canSend ? (
              <div className="oc-pack__filters">
                <SelectField label="Helper" value={to} empty="Any free helper" options={data.helpers.map((h) => ({ value: h.id, label: `${h.agent || h.id}${h.account ? ` · ${h.account}` : ''}` }))} onChange={setTo} />
                <Switch label="Do it now" hint="Top priority on that helper" checked={now} onChange={setNow} />
              </div>
            ) : <p className="pl-note is-warn"><Icon name="alert" size={14} />No helper session can take work here yet (Session sync isn't running or can't take offers). The package goes to your orchestrator instead.</p>
          ) : (
            <SelectField label="Queue position" value={position} onChange={setPosition} options={[{ value: '0', label: 'Top of the queue' }, { value: '1', label: '2nd' }, { value: '2', label: '3rd' }, { value: '4', label: '5th' }, { value: 'end', label: 'End of the queue' }]} />
          )}
          {!confirming ? (
            <div className="fx-row fx-row--wrap"><Button tone="primary" icon="check" disabled={busy} onClick={() => setConfirming(true)}>Review {picked.length} ticked step{picked.length === 1 ? '' : 's'}…</Button><Button onClick={close}>Cancel</Button></div>
          ) : (
            <div className="pl-note oc-pack__confirm">
              <p><b>Package exactly these, in this order?</b></p>
              <ol className="fx-small">{P.confirmLines(all, sel).map((l) => <li key={l}>{l.replace(/^\d+\.\s/, '')}</li>)}</ol>
              <div className="fx-row fx-row--wrap">
                <Button tone="primary" icon={dest === 'helper' && data.canSend ? 'rocket' : 'layers'} disabled={busy} onClick={submit}>{dest === 'helper' && data.canSend ? `Package & send${now ? ' now' : ''}` : 'Package & add'}</Button>
                <Button disabled={busy} onClick={() => setConfirming(false)}>Back</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DepsNote({ deps, onBring }: { deps: P.Dependency[]; onBring: () => void }) {
  const can = deps.some((d) => d.needs.some((n) => n.selectable));
  return (
    <div className="pl-note is-warn oc-pack__deps">
      <p><Icon name="alert" size={14} /> {deps.length} ticked step{deps.length === 1 ? ' needs' : 's need'} steps that aren't in the package:</p>
      <ul className="fx-small">{deps.slice(0, 8).map((d) => <li key={d.key}>{d.text.slice(0, 80)} ← {d.needs.map((n) => `${n.text.slice(0, 50)}${n.inProgress ? ' (being built now)' : n.packaged ? ` (in ${n.packaged})` : n.helper ? ' (with a helper)' : ''}`).join('; ')}</li>)}</ul>
      {can && <Button size="sm" icon="plus" onClick={onBring}>Bring the prerequisites along</Button>}
    </div>
  );
}

/** Toolbar / header button that opens the window. */
export function PackageButton() {
  const rt = useRuntime();
  return <Button icon="package" onClick={() => rt.openDialog('build-orchestrator.package')} title="Pick waiting steps (Fable by default) and combine them into one build">Package builds…</Button>;
}

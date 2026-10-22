/**
 * The installer window: opens when you tap Assemble prompt. While the real work runs (POST /assemble: make the kit
 * current on GitHub, then build the prompt), it walks every real file and item of the kit, grouped by category, with
 * an overall meter, a meter per category, read / write / files / data gauges, a checklist that crosses itself off and
 * a live log. Deliberately unhurried (about 75 s; "Faster" speeds it up). The publish step holds until GitHub answers.
 *
 * Gauges and meters are the framework's (`Gauge` / `Meter`: the app's active gauge and progress-meter assets); the
 * installer's own layout (Classic / Dashboard / Compact / Focus, gauges on/off, log lines, groups side) comes from the
 * installer look (look.ts, saved on axHub). Demo mode (Tools → Installer preview) runs the same plan with example
 * machines, never publishes, and takes the prompt from a preview build.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Gauge, Icon, Meter, Note, TextField, useRuntime } from '@console/axf/react';
import {
  type Category, type Plan, buildCategories, formatBytes, phaseLabel, stepBytes, totalBytes, totalMs,
} from './installer-core';
import type { InstallerLayout } from './look-core';
import { installerLayout, useLook } from './look';
import { type Assembled, type LastAssembly, type RunSummary, ago, api, refresh, set } from './store';

export interface Run {
  ci: number; si: number; p: number; elapsed: number;
  read: number; written: number; filesDone: number;
  readSpeed: number; writeSpeed: number; log: string[]; done: boolean; failed: string;
}
const fresh = (): Run => ({ ci: 0, si: 0, p: 0, elapsed: 0, read: 0, written: 0, filesDone: 0, readSpeed: 0, writeSpeed: 0, log: [], done: false, failed: '' });
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stamp = (ms: number) => `[${clock(ms)}]`;

const LOG_KEEP = 200;
/** What the server keeps of a finished run (numbers rounded, the last 200 log lines, each at most 400 characters). */
export function summaryOf(r: Run): RunSummary {
  return {
    elapsed: Math.round(r.elapsed), read: Math.round(r.read), written: Math.round(r.written), filesDone: r.filesDone,
    failed: r.failed.slice(0, 2000), log: r.log.slice(-LOG_KEEP).map((l) => l.slice(0, 400)),
  };
}

/** A finished run rebuilt from a saved summary (the results page of an earlier assembly). */
export function finishedRun(cats: Category[], s: RunSummary | null): Run {
  return { ...fresh(), ci: cats.length, si: 0, done: true, ...(s ?? {}), readSpeed: 0, writeSpeed: 0, log: s?.log ?? [], failed: s?.failed ?? '' };
}

/** Example machines for the preview when none have sent their files yet (sizes only). */
export function withDemoData(p: Plan): Plan {
  const machines = p.machines.length ? p.machines : [
    { host: 'vps', files: [{ path: '.claude/CLAUDE.md', kind: 'user-instructions', bytes: 3200 }, { path: '.claude/commands/deploy.md', kind: 'command', bytes: 900 }, { path: '.claude/agents/reviewer.md', kind: 'agent', bytes: 2100 }, { path: '.claude/projects/-root-AmberX-AXF/memory/notes.md', kind: 'auto-memory', bytes: 5400 }] },
    { host: 'laptop', files: [{ path: '.claude/CLAUDE.md', kind: 'user-instructions', bytes: 1800 }, { path: '.claude/skills/release/SKILL.md', kind: 'skill', bytes: 3600 }] },
  ];
  return { ...p, machines, memory: true };
}

interface Result { done: boolean; ok?: Assembled; err?: string }

/** Runs one install: loads the plan, starts the real work (or the demo stand-in) and animates through the steps. */
function useInstallRun(demo: boolean, runKey: number) {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [project, setProject] = useState('AmberX AXF');
  const [error, setError] = useState('');
  const [, setFrame] = useState(0);
  const run = useRef<Run>(fresh());
  const speed = useRef(1);
  const result = useRef<Result>({ done: false });

  useEffect(() => {
    let live = true;
    run.current = fresh();
    speed.current = 1;
    result.current = { done: false };
    setCats(null);
    api.call<Plan>('plan').then((p0) => {
      if (!live) return;
      const p = demo ? withDemoData(p0) : p0;
      setProject(p.project.displayName || p.project.name || 'the project');
      setCats(buildCategories(p));
    }, (e: Error) => live && setError(e.message));
    if (demo) {
      // the preview never publishes: GitHub "answers" after a few seconds and the prompt comes from a preview build
      const wait = new Promise((ok) => setTimeout(ok, 3500 + Math.random() * 2500));
      Promise.all([api.post<{ prompt: string }>('preview', {}), wait]).then(
        ([r]) => { result.current = { done: true, ok: { prompt: r.prompt, current: true, note: '', published: { pushed: true, sha: 'preview' } } }; },
        (e: Error) => { result.current = { done: true, err: e.message }; },
      );
    } else {
      api.post<Assembled>('assemble', { publish: true }).then(
        (r) => { result.current = { done: true, ok: r }; },
        (e: Error) => { result.current = { done: true, err: e.message }; },
      );
    }
    return () => { live = false; };
  }, [demo, runKey]);

  useEffect(() => {
    if (!cats) return;
    let raf = 0;
    let last = performance.now();
    let paint = 0;
    const r = run.current;
    const say = (line: string) => { r.log = [...r.log.slice(-199), `${stamp(r.elapsed)} ${line}`]; };
    say(`Installing ${project}: ${cats.reduce((n, c) => n + c.steps.length, 0)} steps in ${cats.length} groups${demo ? ' (preview: nothing is published)' : ''}`);
    say(`▸ ${cats[0]!.label}`);
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (!r.done) {
        r.elapsed += dt;
        const cat = cats[r.ci]!;
        const s = cat.steps[r.si]!;
        const before = stepBytes(s, r.p);
        if (s.kind === 'wait') {
          const res = result.current;
          r.p = res.done ? Math.min(1, r.p + dt / 500) : Math.min(0.9, r.p + (dt / s.ms) * speed.current);
        } else r.p = Math.min(1, r.p + (dt / s.ms) * speed.current);
        const after = stepBytes(s, r.p);
        const jitter = 0.85 + Math.random() * 0.3;
        const k = dt > 0 ? 1000 / dt : 0;
        r.readSpeed = r.readSpeed * 0.85 + (after.read - before.read) * k * jitter * 0.15;
        r.writeSpeed = r.writeSpeed * 0.85 + (after.written - before.written) * k * jitter * 0.15;
        if (r.p >= 1) {
          const { read, written } = stepBytes(s, 1);
          r.read += read;
          r.written += written;
          if (s.kind !== 'skip' && s.kind !== 'check' && s.kind !== 'wait') r.filesDone += 1;
          if (s.kind === 'wait') {
            const res = result.current;
            if (res.err) { r.failed = res.err; say(`✗ ${s.label}: ${res.err}`); }
            else say(res.ok?.published?.pushed ? `✓ ${s.label}: pushed ${res.ok.published.sha ?? ''}` : `✓ ${s.label}: GitHub already had it`);
          } else say(`${s.kind === 'skip' ? '–' : '✓'} ${s.label}${s.bytes ? ` (${formatBytes(s.bytes)})` : ''}`);
          r.p = 0;
          r.si += 1;
          if (r.si >= cat.steps.length) {
            say(`✔ ${cat.label} done`);
            r.si = 0;
            r.ci += 1;
            if (r.ci >= cats.length) {
              r.done = true; r.readSpeed = 0; r.writeSpeed = 0;
              say(r.failed ? 'Finished with a problem' : 'Install complete: the prompt is ready');
              if (!demo && result.current.ok) set({ assembled: result.current.ok });
              if (!demo) {
                // keep this run with the last assembly, so Last assembly can show the same results page later
                if (result.current.ok) void api.post('last-assembly/run', summaryOf(r)).catch(() => undefined);
                void refresh();
              }
            } else say(`▸ ${cats[r.ci]!.label}`);
          }
        }
      } else { r.readSpeed *= 0.9; r.writeSpeed *= 0.9; }
      if (now - paint > 60) { paint = now; setFrame((f) => f + 1); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cats, project, demo]);

  const faster = () => { speed.current = speed.current >= 8 ? 1 : speed.current * 4; setFrame((f) => f + 1); };
  return { cats, project, error, run: run.current, speed: speed.current, result: result.current, faster };
}

/** Everything the view needs, worked out from the plan and the run. */
export function viewModel(cats: Category[], r: Run, speed = 1) {
  const all = totalMs(cats);
  const msOf = (c: Category) => c.steps.reduce((m, s) => m + s.ms, 0);
  const cur = cats[Math.min(r.ci, cats.length - 1)]!;
  const doneMs = cats.slice(0, r.ci).reduce((n, c) => n + msOf(c), 0)
    + (cats[r.ci]?.steps.slice(0, r.si).reduce((m, s) => m + s.ms, 0) ?? 0) + (cats[r.ci]?.steps[r.si]?.ms ?? 0) * r.p;
  const stepsTotal = cats.reduce((n, c) => n + c.steps.length, 0);
  const curStep = r.done ? null : cur.steps[r.si] ?? null;
  const live = curStep ? stepBytes(curStep, r.p) : { read: 0, written: 0 };
  const catPct = (i: number) => {
    if (i < r.ci || r.done) return 1;
    if (i > r.ci) return 0;
    const c = cats[i]!;
    return (c.steps.slice(0, r.si).reduce((m, s) => m + s.ms, 0) + (c.steps[r.si]?.ms ?? 0) * r.p) / (msOf(c) || 1);
  };
  return {
    pct: r.done ? 100 : Math.min(99, Math.floor((doneMs / all) * 100)),
    stepsTotal,
    stepNo: r.done ? stepsTotal : cats.slice(0, r.ci).reduce((n, c) => n + c.steps.length, 0) + r.si + 1,
    filesTotal: cats.reduce((n, c) => n + c.steps.filter((s) => s.kind === 'index' || s.kind === 'copy' || s.kind === 'write').length, 0),
    bytesAll: totalBytes(cats),
    cur, curStep,
    processed: r.read + r.written + live.read + live.written,
    left: r.done ? 0 : Math.max(0, (all - doneMs) / speed),
    catPct,
  };
}

/** The installer, drawn in the given layout (also used still, as the look dialog's preview). */
export function InstallerView({ cats, run: r, project, layout, speed = 1, footer, compactPreview }: {
  cats: Category[]; run: Run; project: string; layout: InstallerLayout; speed?: number; footer?: React.ReactNode; compactPreview?: boolean;
}) {
  const v = viewModel(cats, r, speed);
  const { cur, curStep } = v;
  const variant = layout.variant;
  const gauges = layout.gauges && variant !== 'compact' && (
    <div className={`axp-claude-handoff-inst__gauges is-${variant}`}>
      <Gauge label="Read" value={r.readSpeed / 1024} max={256} unit="KB/s" />
      <Gauge label="Write" value={r.writeSpeed / 1024} max={256} unit="KB/s" />
      <Gauge label="Files" value={r.filesDone} max={v.filesTotal} unit={`of ${v.filesTotal}`} integer />
      <Gauge label="Data" value={v.processed / 1024} max={Math.max(1, (v.bytesAll * 1.6) / 1024)} unit="KB" integer />
    </div>
  );
  const catState = (i: number) => (v.catPct(i) >= 1 ? 'done' : i === r.ci ? 'working' : 'queued');
  const catCount = (i: number, c: Category) => `${catState(i) === 'done' ? c.steps.length : i === r.ci ? r.si : 0}/${c.steps.length}`;
  const catList = (
    <ol className="axp-claude-handoff-inst__cats">
      {cats.map((c, i) => (
        <li key={c.id} className={`axp-claude-handoff-inst__cat is-${catState(i)}`}>
          <span className="axp-claude-handoff-inst__caticon" aria-hidden><Icon name={catState(i) === 'done' ? 'check' : c.icon} size={14} /></span>
          <span className="axp-claude-handoff-inst__catname">{c.label}</span>
          <span className="axp-claude-handoff-inst__catcount">{catCount(i, c)}</span>
          <span className="axp-claude-handoff-inst__catmeter"><Meter small value={v.catPct(i) * 100} active={catState(i) === 'working'} done={catState(i) === 'done'} label={c.label} /></span>
        </li>
      ))}
    </ol>
  );
  const catCards = (
    <div className="axp-claude-handoff-inst__cards">
      {cats.map((c, i) => (
        <div key={c.id} className={`axp-claude-handoff-inst__card is-${catState(i)}`}>
          <span className="axp-claude-handoff-inst__cardhead"><Icon name={catState(i) === 'done' ? 'check' : c.icon} size={14} /><span>{c.label}</span><span className="axp-claude-handoff-inst__catcount">{catCount(i, c)}</span></span>
          <Meter small value={v.catPct(i) * 100} active={catState(i) === 'working'} done={catState(i) === 'done'} label={c.label} />
        </div>
      ))}
    </div>
  );
  const catChips = (
    <div className="axp-claude-handoff-inst__chips">
      {cats.map((c, i) => <Chip key={c.id} tone={catState(i) === 'done' ? 'success' : catState(i) === 'working' ? 'accent' : undefined}>{c.label} {catCount(i, c)}</Chip>)}
    </div>
  );
  const panel = (
    <section className="axp-claude-handoff-inst__now-panel">
      <div className="axp-claude-handoff-inst__nowhead">
        <Icon name={cur.icon} size={16} /><strong>{cur.label}</strong>
        <Chip tone={r.done ? 'success' : 'accent'}>{r.done ? 'done' : `${Math.round(v.catPct(r.ci) * 100)}%`}</Chip>
      </div>
      <ul className="axp-claude-handoff-inst__features">
        {cur.features.map((f, k) => {
          const fdone = r.done || v.catPct(r.ci) >= (k + 1) / cur.features.length;
          return <li key={f} className={fdone ? 'is-done' : ''}><Icon name={fdone ? 'check' : 'minus'} size={12} />{f}</li>;
        })}
      </ul>
      <StepList cats={cats} r={r} cur={cur} short={variant === 'compact' || compactPreview} />
    </section>
  );
  const log = layout.logLines > 0 && <pre className="axp-claude-handoff-inst__log" style={{ minHeight: `${Math.min(layout.logLines, 7) * 1.5}em` }} aria-label="Install log">{r.log.slice(-layout.logLines).join('\n')}</pre>;

  return (
    <div className={`axp-claude-handoff-inst is-${variant}${r.done ? ' is-done' : ''}${layout.groupsSide === 'right' ? ' is-groups-right' : ''}`}>
      <header className="axp-claude-handoff-inst__head">
        <span className={`axp-claude-handoff-inst__logo${r.done ? '' : ' is-busy'}`} aria-hidden><Icon name={r.done ? (r.failed ? 'alert' : 'check-circle') : 'rocket'} size={26} /></span>
        <div className="axp-claude-handoff-inst__title">
          <strong>{r.done ? (r.failed ? 'Finished, with a problem' : 'Ready for the new account') : `Installing ${project} on a new Claude account`}</strong>
          <span className="axp-claude-handoff-inst__now" aria-live="polite">{curStep ? `${cur.label} › ${curStep.label} — ${phaseLabel(curStep, r.p)}` : `${v.stepsTotal} steps, ${cats.length} groups, ${formatBytes(v.processed)} handled`}</span>
        </div>
        <span className="axp-claude-handoff-inst__pct">{v.pct}<small>%</small></span>
      </header>
      <Meter value={v.pct} active={!r.done} done={r.done} label="Overall progress" />
      <div className="axp-claude-handoff-inst__meta">
        <span>Step {v.stepNo} of {v.stepsTotal}</span><span>Elapsed {clock(r.elapsed)}</span><span>{r.done ? 'Done' : `About ${clock(v.left)} left`}</span>
      </div>
      {variant === 'focus' ? (
        <>
          <div className="axp-claude-handoff-inst__focus">
            <span className="axp-claude-handoff-inst__focuslabel">{cur.label}</span>
            <strong className="axp-claude-handoff-inst__focusstep">{curStep ? curStep.label : 'All groups done'}</strong>
            <span className="axp-claude-handoff-inst__focusdetail">{curStep ? phaseLabel(curStep, r.p) : `${v.stepsTotal} steps finished`}</span>
            {curStep && <Meter value={r.p * 100} active label={curStep.label} />}
          </div>
          {gauges}
          {catChips}
        </>
      ) : variant === 'dashboard' ? (
        <>{gauges}{catCards}{panel}</>
      ) : variant === 'compact' ? (
        <>{catChips}{panel}</>
      ) : (
        <>{gauges}<div className="axp-claude-handoff-inst__body">{catList}{panel}</div></>
      )}
      {log}
      {footer}
    </div>
  );
}

function StepList({ cats: _cats, r, cur, short }: { cats: Category[]; r: Run; cur: Category; short?: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // keep the current step in view by scrolling the list only (scrollIntoView would also scroll the page / dialog)
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('.is-current');
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight;
  });
  const steps = short ? cur.steps.slice(Math.max(0, r.si - 1), r.si + 3) : cur.steps;
  const offset = short ? Math.max(0, r.si - 1) : 0;
  return (
    <ol className="axp-claude-handoff-inst__steps" ref={listRef}>
      {steps.map((s, kk) => {
        const k = kk + offset;
        const state = r.done || k < r.si ? 'done' : k === r.si ? 'current' : 'todo';
        return (
          <li key={s.id} className={`axp-claude-handoff-inst__step is-${state}${s.kind === 'skip' ? ' is-skip' : ''}`}>
            <span className="axp-claude-handoff-inst__tick" aria-hidden>
              {state === 'done' ? <Icon name={s.kind === 'skip' ? 'minus' : 'check'} size={12} /> : state === 'current' ? <span className="axp-claude-handoff-inst__spin"><Icon name="refresh" size={12} /></span> : null}
            </span>
            <span className="axp-claude-handoff-inst__steptext">
              <span className="axp-claude-handoff-inst__steplabel">{s.label}</span>
              <span className="axp-claude-handoff-inst__stepdetail">{state === 'current' ? phaseLabel(s, r.p) : s.detail}</span>
              {state === 'current' && <Meter small value={r.p * 100} active label={s.label} />}
            </span>
            {s.bytes > 0 && <span className="axp-claude-handoff-inst__size">{formatBytes(s.bytes)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The installer as a dialog (Assemble prompt) or inline (the preview page, demo = true). */
export function InstallerDialog({ close, demo = false }: { close?: () => void; demo?: boolean }) {
  const rt = useRuntime();
  useLook();
  const [runKey, setRunKey] = useState(0);
  const { cats, project, error, run: r, speed, result, faster } = useInstallRun(demo, runKey);
  const layout = installerLayout();

  if (error) return (
    <div className="fx-stack">
      <Note tone="danger">Couldn't read what the kit is made of: {error}</Note>
      {close && <div><Button onClick={close}>Close</Button></div>}
    </div>
  );
  if (!cats) return <div className="axp-claude-handoff-inst__loading"><span className="axp-claude-handoff-inst__spin" aria-hidden><Icon name="refresh" size={22} /></span> Preparing the installer…</div>;

  const look = <Button tone="ghost" icon="palette" size="sm" onClick={() => rt.openDialog('claude-handoff.look')}>Look</Button>;
  const footer = r.done ? (
    <Results ok={result.ok} failed={r.failed} demo={demo} close={close} again={demo ? () => setRunKey((k) => k + 1) : undefined} />
  ) : (
    <div className="axp-claude-handoff-inst__foot">
      {look}
      {demo && <Button tone="ghost" icon="refresh" size="sm" onClick={() => setRunKey((k) => k + 1)}>Restart</Button>}
      <Button tone="ghost" icon="zap" size="sm" onClick={faster}>{speed >= 8 ? 'Normal speed' : 'Faster'}</Button>
    </div>
  );
  return <InstallerView cats={cats} run={r} project={project} layout={layout} speed={speed} footer={footer} />;
}

/**
 * The results under a finished installer: the prompt, notes, Copy prompt. It takes the focus when it appears (the
 * dialog scrolls to it), both when a run finishes and when Last assembly reopens an earlier one.
 */
function Results({ ok, failed, demo, close, again, when }: {
  ok?: Assembled; failed: string; demo?: boolean; close?: () => void; again?: () => void; when?: string;
}) {
  const rt = useRuntime();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const published = ok?.published?.pushed ? `published ${ok.published.sha ?? ''}`.trim() : ok ? 'GitHub already had this kit' : '';
  return (
    <div className="fx-stack axp-claude-handoff-inst__results" ref={ref} tabIndex={-1} aria-label="Results">
      {when && <p className="axp-claude-handoff-inst__resultsmeta"><Icon name="clock" size={12} /> Assembled {when}{published ? ` · ${published}` : ''}</p>}
      {failed && <Note tone="warning">{failed}</Note>}
      {ok?.note && <Note tone="warning">{ok.note}</Note>}
      {ok && <TextField label={`The handoff prompt (paste it into a new session on the new account)${demo ? ' — preview build, nothing was published' : ''}`} value={ok.prompt} onChange={() => undefined} rows={8} mono />}
      <div className="axp-claude-handoff-inst__foot">
        <Button tone="ghost" icon="palette" size="sm" onClick={() => rt.openDialog('claude-handoff.look')}>Look</Button>
        {again && <Button icon="refresh" onClick={again}>Run again</Button>}
        {ok && <Button tone="primary" icon="copy" onClick={() => { void navigator.clipboard?.writeText(ok.prompt).then(() => rt.toast('Prompt copied', 'success', 'Claude handoff'), () => undefined); }}>Copy prompt</Button>}
        {close && <Button onClick={close}>Close</Button>}
      </div>
    </div>
  );
}

/** Last assembly: the installer's results page for the last prompt assembled on this console, rebuilt from what was saved. */
export function LastAssemblyDialog({ close }: { close?: () => void }) {
  useLook();
  const [last, setLast] = useState<LastAssembly | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.call<LastAssembly>('last-assembly').then(setLast, (e: Error) => setError(e.message)); }, []);
  if (error) return (
    <div className="fx-stack">
      <Note tone="info">{error}</Note>
      {close && <div><Button onClick={close}>Close</Button></div>}
    </div>
  );
  if (!last) return <div className="axp-claude-handoff-inst__loading"><span className="axp-claude-handoff-inst__spin" aria-hidden><Icon name="refresh" size={22} /></span> Loading the last assembly…</div>;
  const cats = last.plan ? buildCategories(last.plan) : [];
  const footer = <Results ok={last.result} failed={last.run?.failed ?? ''} close={close} when={ago(last.at)} />;
  if (!cats.length) return footer;
  const project = last.plan?.project?.displayName || last.plan?.project?.name || 'the project';
  return <InstallerView cats={cats} run={finishedRun(cats, last.run)} project={project} layout={installerLayout()} footer={footer} />;
}

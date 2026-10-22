/**
 * The installer window: opens when you tap Assemble prompt. While the real work runs (POST /assemble: make the kit
 * current on GitHub, then build the prompt), it walks every real file and item of the kit, grouped by category, with
 * an overall bar, a bar per category, read / write speed gauges, a checklist that crosses itself off and a live log.
 * Deliberately unhurried (about 75 s; "Faster" speeds it up). The publish step holds until GitHub has answered.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Icon, Note, TextField, useRuntime } from '@console/axf/react';
import {
  type Category, type Plan, buildCategories, formatBytes, phaseLabel, stepBytes, totalBytes, totalMs,
} from './installer-core';
import { type Assembled, api, refresh, set } from './store';

interface Run {
  ci: number; si: number; p: number; elapsed: number;
  read: number; written: number; filesDone: number;
  readSpeed: number; writeSpeed: number; log: string[]; done: boolean; failed: string;
}
const fresh = (): Run => ({ ci: 0, si: 0, p: 0, elapsed: 0, read: 0, written: 0, filesDone: 0, readSpeed: 0, writeSpeed: 0, log: [], done: false, failed: '' });
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stamp = (ms: number) => `[${clock(ms)}]`;

export function InstallerDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [project, setProject] = useState('AmberX AXF');
  const [error, setError] = useState('');
  const [, setFrame] = useState(0);
  const run = useRef<Run>(fresh());
  const speed = useRef(1);
  const result = useRef<{ done: boolean; ok?: Assembled; err?: string }>({ done: false });
  const listRef = useRef<HTMLOListElement>(null);

  // the real work and the plan start together
  useEffect(() => {
    let live = true;
    api.call<Plan>('plan').then((p) => { if (!live) return; setProject(p.project.displayName || p.project.name || 'the project'); setCats(buildCategories(p)); },
      (e: Error) => live && setError(e.message));
    api.post<Assembled>('assemble', { publish: true }).then(
      (r) => { result.current = { done: true, ok: r }; },
      (e: Error) => { result.current = { done: true, err: e.message }; },
    );
    return () => { live = false; };
  }, []);

  // the animation loop
  useEffect(() => {
    if (!cats) return;
    let raf = 0;
    let last = performance.now();
    let paint = 0;
    const r = run.current;
    const say = (line: string) => { r.log = [...r.log.slice(-199), `${stamp(r.elapsed)} ${line}`]; };
    say(`Installing ${project}: ${cats.reduce((n, c) => n + c.steps.length, 0)} steps in ${cats.length} groups`);
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
        } else {
          r.p = Math.min(1, r.p + (dt / s.ms) * speed.current);
        }
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
            if (r.ci >= cats.length) { r.done = true; r.readSpeed = 0; r.writeSpeed = 0; say(r.failed ? 'Finished with a problem' : 'Install complete: the prompt is ready'); if (result.current.ok) set({ assembled: result.current.ok }); void refresh(); }
            else say(`▸ ${cats[r.ci]!.label}`);
          }
        }
      } else {
        r.readSpeed *= 0.9;
        r.writeSpeed *= 0.9;
      }
      if (now - paint > 60) { paint = now; setFrame((f) => f + 1); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cats, project]);

  // keep the current step in view
  useEffect(() => {
    const el = listRef.current?.querySelector('.is-current');
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  });

  if (error) return (
    <div className="fx-stack">
      <Note tone="danger">Couldn't read what the kit is made of: {error}</Note>
      <div><Button onClick={close}>Close</Button></div>
    </div>
  );
  if (!cats) return <div className="axp-claude-handoff-inst__loading"><span className="axp-claude-handoff-inst__spin" aria-hidden><Icon name="refresh" size={22} /></span> Preparing the installer…</div>;

  const r = run.current;
  const all = totalMs(cats);
  const doneMs = cats.slice(0, r.ci).reduce((n, c) => n + c.steps.reduce((m, s) => m + s.ms, 0), 0)
    + (cats[r.ci]?.steps.slice(0, r.si).reduce((m, s) => m + s.ms, 0) ?? 0) + (cats[r.ci]?.steps[r.si]?.ms ?? 0) * r.p;
  const pct = r.done ? 100 : Math.min(99, Math.floor((doneMs / all) * 100));
  const stepsTotal = cats.reduce((n, c) => n + c.steps.length, 0);
  const stepNo = r.done ? stepsTotal : cats.slice(0, r.ci).reduce((n, c) => n + c.steps.length, 0) + r.si + 1;
  const filesTotal = cats.reduce((n, c) => n + c.steps.filter((s) => s.kind === 'index' || s.kind === 'copy' || s.kind === 'write').length, 0);
  const bytesAll = totalBytes(cats);
  const cur = cats[Math.min(r.ci, cats.length - 1)]!;
  const curStep = r.done ? null : cur.steps[r.si] ?? null;
  const live = curStep ? stepBytes(curStep, r.p) : { read: 0, written: 0 };
  const processed = r.read + r.written + live.read + live.written;
  const left = r.done ? 0 : Math.max(0, (all - doneMs) / speed.current);
  const catPct = (i: number) => {
    if (i < r.ci || r.done) return 1;
    if (i > r.ci) return 0;
    const c = cats[i]!;
    const t = c.steps.reduce((m, s) => m + s.ms, 0);
    return (c.steps.slice(0, r.si).reduce((m, s) => m + s.ms, 0) + (c.steps[r.si]?.ms ?? 0) * r.p) / (t || 1);
  };
  const ok = result.current.ok;

  return (
    <div className={`axp-claude-handoff-inst${r.done ? ' is-done' : ''}`}>
      <header className="axp-claude-handoff-inst__head">
        <span className={`axp-claude-handoff-inst__logo${r.done ? '' : ' is-busy'}`} aria-hidden><Icon name={r.done ? (r.failed ? 'alert' : 'check-circle') : 'rocket'} size={26} /></span>
        <div className="axp-claude-handoff-inst__title">
          <strong>{r.done ? (r.failed ? 'Finished, with a problem' : 'Ready for the new account') : `Installing ${project} on a new Claude account`}</strong>
          <span className="axp-claude-handoff-inst__now" aria-live="polite">{curStep ? `${cur.label} › ${curStep.label} — ${phaseLabel(curStep, r.p)}` : `${stepsTotal} steps, ${cats.length} groups, ${formatBytes(processed)} handled`}</span>
        </div>
        <span className="axp-claude-handoff-inst__pct">{pct}<small>%</small></span>
      </header>

      <div className="axp-claude-handoff-inst__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress">
        <div className={`axp-claude-handoff-inst__fill${r.done ? '' : ' is-moving'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="axp-claude-handoff-inst__meta">
        <span>Step {stepNo} of {stepsTotal}</span><span>Elapsed {clock(r.elapsed)}</span><span>{r.done ? 'Done' : `About ${clock(left)} left`}</span>
      </div>

      <div className="axp-claude-handoff-inst__gauges">
        <Gauge label="Read" value={r.readSpeed / 1024} max={256} unit="KB/s" />
        <Gauge label="Write" value={r.writeSpeed / 1024} max={256} unit="KB/s" />
        <Gauge label="Files" value={r.filesDone} max={filesTotal} unit={`of ${filesTotal}`} integer />
        <Gauge label="Data" value={processed / 1024} max={Math.max(1, (bytesAll * 1.6) / 1024)} unit="KB" integer />
      </div>

      <div className="axp-claude-handoff-inst__body">
        <ol className="axp-claude-handoff-inst__cats">
          {cats.map((c, i) => {
            const cp = catPct(i);
            const state = cp >= 1 ? 'done' : i === r.ci ? 'working' : 'queued';
            return (
              <li key={c.id} className={`axp-claude-handoff-inst__cat is-${state}`}>
                <span className="axp-claude-handoff-inst__caticon" aria-hidden><Icon name={state === 'done' ? 'check' : c.icon} size={14} /></span>
                <span className="axp-claude-handoff-inst__catname">{c.label}</span>
                <span className="axp-claude-handoff-inst__catcount">{state === 'done' ? c.steps.length : i === r.ci ? r.si : 0}/{c.steps.length}</span>
                <span className="axp-claude-handoff-inst__mini"><span style={{ width: `${Math.round(cp * 100)}%` }} /></span>
              </li>
            );
          })}
        </ol>

        <section className="axp-claude-handoff-inst__now-panel">
          <div className="axp-claude-handoff-inst__nowhead">
            <Icon name={cur.icon} size={16} /><strong>{cur.label}</strong>
            <Chip tone={r.done ? 'success' : 'accent'}>{r.done ? 'done' : `${Math.round(catPct(r.ci) * 100)}%`}</Chip>
          </div>
          <ul className="axp-claude-handoff-inst__features">
            {cur.features.map((f, k) => {
              const fdone = r.done || catPct(r.ci) >= (k + 1) / cur.features.length;
              return <li key={f} className={fdone ? 'is-done' : ''}><Icon name={fdone ? 'check' : 'minus'} size={12} />{f}</li>;
            })}
          </ul>
          <ol className="axp-claude-handoff-inst__steps" ref={listRef}>
            {cur.steps.map((s, k) => {
              const state = r.done || k < r.si ? 'done' : k === r.si ? 'current' : 'todo';
              return (
                <li key={s.id} className={`axp-claude-handoff-inst__step is-${state}${s.kind === 'skip' ? ' is-skip' : ''}`}>
                  <span className="axp-claude-handoff-inst__tick" aria-hidden>
                    {state === 'done' ? <Icon name={s.kind === 'skip' ? 'minus' : 'check'} size={12} /> : state === 'current' ? <span className="axp-claude-handoff-inst__spin"><Icon name="refresh" size={12} /></span> : null}
                  </span>
                  <span className="axp-claude-handoff-inst__steptext">
                    <span className="axp-claude-handoff-inst__steplabel">{s.label}</span>
                    <span className="axp-claude-handoff-inst__stepdetail">{state === 'current' ? phaseLabel(s, r.p) : s.detail}</span>
                    {state === 'current' && <span className="axp-claude-handoff-inst__mini is-step"><span style={{ width: `${Math.round(r.p * 100)}%` }} /></span>}
                  </span>
                  {s.bytes > 0 && <span className="axp-claude-handoff-inst__size">{formatBytes(s.bytes)}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <pre className="axp-claude-handoff-inst__log" aria-label="Install log">{r.log.slice(-7).join('\n')}</pre>

      {r.done ? (
        <div className="fx-stack">
          {r.failed && <Note tone="warning">{r.failed}</Note>}
          {ok?.note && <Note tone="warning">{ok.note}</Note>}
          {ok && <TextField label="The handoff prompt (paste it into a new session on the new account)" value={ok.prompt} onChange={() => undefined} rows={8} mono />}
          <div className="axp-claude-handoff-inst__foot">
            {ok && <Button tone="primary" icon="copy" onClick={() => { void navigator.clipboard?.writeText(ok.prompt).then(() => rt.toast('Prompt copied', 'success', 'Claude handoff'), () => undefined); }}>Copy prompt</Button>}
            <Button onClick={close}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="axp-claude-handoff-inst__foot">
          <Button tone="ghost" icon="zap" size="sm" onClick={() => { speed.current = speed.current >= 8 ? 1 : speed.current * 4; setFrame((f) => f + 1); }}>{speed.current >= 8 ? 'Normal speed' : 'Faster'}</Button>
        </div>
      )}
    </div>
  );
}

/** A half-circle gauge with a needle (theme tokens only). */
function Gauge({ label, value, max, unit, integer }: { label: string; value: number; max: number; unit: string; integer?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const shown = integer ? Math.round(value).toLocaleString() : value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString();
  return (
    <figure className="axp-claude-handoff-gauge">
      <svg viewBox="0 0 120 70" role="img" aria-label={`${label}: ${shown} ${unit}`}>
        <path className="axp-claude-handoff-gauge__track" d="M 10 62 A 50 50 0 0 1 110 62" pathLength={100} />
        <path className="axp-claude-handoff-gauge__value" d="M 10 62 A 50 50 0 0 1 110 62" pathLength={100} strokeDasharray={`${pct} 100`} />
        <line className="axp-claude-handoff-gauge__needle" x1="60" y1="62" x2="60" y2="20" style={{ transform: `rotate(${-90 + pct * 1.8}deg)` }} />
        <circle className="axp-claude-handoff-gauge__hub" cx="60" cy="62" r="4" />
      </svg>
      <figcaption><strong>{shown}</strong> <span>{unit}</span><em>{label}</em></figcaption>
    </figure>
  );
}

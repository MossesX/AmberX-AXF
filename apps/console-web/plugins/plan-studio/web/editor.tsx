import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Checkbox, Chip, Icon, IconButton, Markdown, SelectField, Segmented, TextField, useRuntime } from '@console/axf/react';
import * as pc from './plan-core.mjs';
import type { History, ListId, Plan, Step, TextItem } from './plan-core.mjs';
import { call, deletePlan, fmtWhen, getPlan, KEYS, restorePlan, savePlan, statusInfo, turnIntoBuild, useBusy, useStudio, type SaveResult } from './api';
import { CommandBox, VoicePanel } from './ai';
import { canListen } from './voice';

/*
 * The plan editor: one page, sections you jump between (phone: a sideways strip of section chips), every plan@1 field.
 * Drafts autosave to the device on every keystroke and, for plans already saved, to the store after a pause (each
 * autosave is one coalesced version). New plans save on Save, after the duplicate check.
 */

const SECTIONS = [
  { id: 'basics', label: 'Basics', icon: 'edit' }, { id: 'filing', label: 'Filing', icon: 'folder' }, { id: 'steps', label: 'Steps', icon: 'list' },
  { id: 'lists', label: 'Requirements & risks', icon: 'check-circle' }, { id: 'links', label: 'Links & catalog', icon: 'external' }, { id: 'notes', label: 'Notes', icon: 'file' },
  { id: 'files', label: 'Attachments', icon: 'upload' }, { id: 'build', label: 'Build', icon: 'play' }, { id: 'history', label: 'History', icon: 'clock' }, { id: 'comments', label: 'Comments', icon: 'info' },
] as const;
const draftKey = (id: string) => `plan-studio.draft.${id}`;
const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: unknown) => { try { const v = rt.settings.get(k); return v === undefined || v === null ? d : v; } catch { return d; } };

function Sec({ id, title, icon, children, aside }: { id: string; title: string; icon: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={`axp-ps-${id}`} className="axp-plan-studio__sec" aria-labelledby={`axp-ps-${id}-h`}>
      <h2 id={`axp-ps-${id}-h`} className="axp-plan-studio__sech"><Icon name={icon} size={13} />{title}{aside && <span className="axp-plan-studio__grow" />}{aside}</h2>
      {children}
    </section>
  );
}

export function PlanEditor({ initial, isNew, onClose, onOpen }: { initial: Plan; isNew: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const rt = useRuntime();
  const { state } = useStudio();
  const [plan, setPlan] = useState<Plan>(() => {
    try { const d = localStorage.getItem(draftKey(initial.id)); if (d) { const p = pc.normalize(JSON.parse(d)); if (p.updatedAt >= initial.updatedAt || isNew) return p; } } catch { /* no drafts on this device */ }
    return initial;
  });
  const [saved, setSaved] = useState<Plan | null>(isNew ? null : initial);
  const [hist, setHist] = useState<History | null>(null);
  const [dups, setDups] = useState<SaveResult['duplicates']>([]);
  const [voice, setVoice] = useState(false);
  const { busy, error, run, setError } = useBusy();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosave = setting(rt, KEYS.autosave, true) !== false;

  // the store changed under us (an AI edit, another tab, the build syncing): take it when we have no unsaved edits
  const live = state?.plans.find((p) => p.id === plan.id);
  useEffect(() => {
    if (!live || !saved || live.version === saved.version) return;
    if (!pc.diff(saved, plan).length) { setPlan(live); setSaved(live); }
  }, [live?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isNew) void getPlan(initial.id).then((r) => setHist(r.history)).catch(() => undefined); }, [initial.id, isNew, saved?.version]);

  const dirty = !saved || pc.diff(saved, plan).length > 0;
  const edit = (patch: Partial<Plan>) => setPlan((p) => {
    const n = pc.normalize({ ...p, ...patch, updatedAt: p.updatedAt });
    try { localStorage.setItem(draftKey(n.id), JSON.stringify(n)); } catch { /* storage full or off */ }
    return n;
  });
  useEffect(() => {
    if (!autosave || isNew || !saved || !dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void savePlan(plan, { kind: 'autosave', note: 'Autosave' }).then((r) => { if (r.ok) { setSaved(r.plan); try { localStorage.removeItem(draftKey(plan.id)); } catch { /* fine */ } } }).catch(() => undefined); }, 2500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [plan, autosave, isNew, saved, dirty]);

  const save = (force = false) => run(async () => {
    const r = await savePlan(plan, { kind: 'save', note: isNew ? 'Created' : 'Saved', force });
    if (!r.ok && r.duplicates?.length) { setDups(r.duplicates); return; }
    if (!r.ok) throw new Error(r.error || 'Not saved.');
    setDups([]); setSaved(r.plan); setPlan(r.plan);
    try { localStorage.removeItem(draftKey(plan.id)); } catch { /* fine */ }
    if (isNew) onOpen(r.plan.id);
    rt.toast(`Saved ${r.plan.title}`, 'success');
  });
  const t = pc.totals(plan);
  const cats = useMemo(() => pc.withParents([...(state?.categories.paths ?? []), ...(state?.plans ?? []).map((p) => p.category).filter(Boolean)]), [state]);
  const jump = (id: string) => document.getElementById(`axp-ps-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="axp-plan-studio__editor">
      <div className="axp-plan-studio__edbar" role="toolbar" aria-label="Plan">
        <IconButton icon="arrow-left" label="Back to plans" onClick={onClose} />
        <b className="axp-plan-studio__edtitle">{plan.title || 'New plan'}</b>
        <Chip tone={statusInfo(plan.status).tone || undefined}>{statusInfo(plan.status).label}</Chip>
        <span className="fx-muted axp-plan-studio__n">{dirty ? (isNew ? 'not saved yet' : autosave ? 'saving…' : 'unsaved changes') : `saved ${fmtWhen(saved?.updatedAt ?? '')}`}</span>
        <span className="axp-plan-studio__grow" />
        {canListen() && <Button size="sm" icon="mic" onClick={() => setVoice(true)} title="Talk the plan through">Talk</Button>}
        <Button size="sm" tone="primary" icon="save" busy={busy} disabled={!dirty && !isNew} onClick={() => void save()}>{isNew ? 'Save plan' : 'Save'}</Button>
      </div>
      {error && <p className="fx-error" role="alert">{error} <IconButton icon="x" label="Dismiss" onClick={() => setError('')} /></p>}
      {!!dups?.length && (
        <div className="axp-plan-studio__dups" role="alert">
          <b>This looks like a plan you already have:</b>
          <ul>{dups.map((d) => <li key={d.id}><button type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => onOpen(d.id)}>{d.title}</button> <span className="fx-muted">{d.status} · {Math.round(d.score * 100)}% alike</span></li>)}</ul>
          <div className="fx-row"><Button size="sm" tone="primary" onClick={() => void save(true)}>Save as a new plan anyway</Button><Button size="sm" tone="quiet" onClick={() => setDups([])}>Keep editing</Button></div>
        </div>
      )}
      {voice && <VoicePanel plan={saved} onClose={() => setVoice(false)} onOpen={onOpen} />}
      {!isNew && <CommandBox plan={saved} onOpen={onOpen} />}
      <nav className="axp-plan-studio__jump" aria-label="Sections">{SECTIONS.map((s) => <button key={s.id} type="button" className="fx-chip" onClick={() => jump(s.id)}><Icon name={s.icon} size={11} />{s.label}</button>)}</nav>
      <div className="axp-plan-studio__strip" aria-label="Totals">
        <span><b>{t.steps}</b> steps</span><span><b>{t.progress}%</b> done</span><span><b>{pc.fmtMinutes(t.minutes) || '0 min'}</b> effort</span>
        <span><b>{pc.fmtMinutes(t.left) || '0 min'}</b> left</span><span><b>{pc.fmtCost(t.cost) || '$0'}</b> est. cost</span>
        {t.acceptance.total > 0 && <span><b>{t.acceptance.done}/{t.acceptance.total}</b> accepted</span>}
      </div>

      <Sec id="basics" title="Basics" icon="edit">
        <TextField label="Title" value={plan.title} onChange={(v) => edit({ title: v })} required autoFocus={isNew} />
        <TextField label="Summary" value={plan.summary} onChange={(v) => edit({ summary: v })} rows={2} placeholder="One or two lines: what this is." />
        <TextField label="Goal" value={plan.goal} onChange={(v) => edit({ goal: v })} rows={2} placeholder="What is true once it's done." />
        <TextField label="Why" value={plan.why} onChange={(v) => edit({ why: v })} rows={2} placeholder="Why it's worth doing." />
      </Sec>

      <Sec id="filing" title="Filing" icon="folder">
        <div className="axp-plan-studio__grid2">
          <SelectField label="Status" value={plan.status} onChange={(v) => edit({ status: v as Plan['status'] })} options={pc.STATUSES.map((s) => ({ value: s.id, label: s.label }))} />
          <SelectField label="Priority" value={plan.priority} onChange={(v) => edit({ priority: v as Plan['priority'] })} options={pc.PRIORITIES.map((p) => ({ value: p, label: `${p}${p === 'P0' ? ' (most urgent)' : ''}` }))} />
          <CategoryPicker value={plan.category} paths={cats} onChange={(v) => edit({ category: v })} />
          <SelectField label="Build profile" value={plan.profile} empty="None yet" onChange={(v) => edit({ profile: v })} options={(state?.profiles ?? []).map((p) => ({ value: p.id, label: p.label }))} />
          <TextField label="Project" value={plan.project} onChange={(v) => edit({ project: v })} mono placeholder="amberx-axf" />
          <TextField label="Owner" value={plan.owner} onChange={(v) => edit({ owner: v })} placeholder="Brett" />
          <TextField label="Target date" type="date" value={plan.targetDate} onChange={(v) => edit({ targetDate: v })} />
          <TextField label="Tags" value={plan.tags.join(', ')} onChange={(v) => edit({ tags: v.split(',').map((x) => x.trim()) })} hint="Comma separated" />
        </div>
        <TouchesField plan={plan} onChange={(touches) => edit({ touches })} />
      </Sec>

      <Sec id="steps" title={`Steps (${plan.steps.length})`} icon="list" aside={<span className="fx-muted axp-plan-studio__n">{pc.fmtMinutes(t.minutes)} · {pc.fmtCost(t.cost)}</span>}>
        <StepsEditor steps={plan.steps} onChange={(steps) => edit({ steps })} />
      </Sec>

      <Sec id="lists" title="Requirements, acceptance, decisions, questions, risks" icon="check-circle">
        {pc.LIST_IDS.map((k) => <ListEditor key={k} id={k} items={plan[k]} onChange={(items) => edit({ [k]: items } as Partial<Plan>)} />)}
      </Sec>

      <Sec id="links" title="Links & catalog features" icon="external">
        <LinksEditor plan={plan} plans={state?.plans ?? []} onChange={(links) => edit({ links })} onOpen={onOpen} />
        {plan.features.length > 0 && (
          <ul className="axp-plan-studio__feats">
            {plan.features.map((f, i) => (
              <li key={`${f.entry}#${f.feature || f.title}`}>
                <Checkbox label={<><b>{f.title || f.feature}</b> <span className="fx-muted">{f.entry}</span></>} checked={f.state === 'have'} onChange={(v) => edit({ features: plan.features.map((x, j) => (j === i ? { ...x, state: v ? 'have' : 'planned' } : x)) })} />
                <Chip tone={f.state === 'have' ? 'success' : f.state === 'planned' ? 'accent' : undefined}>{f.state}</Chip>
                <IconButton icon="x" label="Remove" onClick={() => edit({ features: plan.features.filter((_, j) => j !== i) })} />
              </li>
            ))}
          </ul>
        )}
        <p className="fx-muted axp-plan-studio__hint">Add catalog features from the Catalog tab (“Plan this” or “Add to a plan”), or tell the AI: “mark AmberX voice as planned”.</p>
      </Sec>

      <Sec id="notes" title="Notes (Markdown)" icon="file">
        <BodyEditor value={plan.body} onChange={(body) => edit({ body })} />
      </Sec>

      <Sec id="files" title={`Attachments (${plan.attachments.length})`} icon="upload">
        <Attachments plan={plan} onChange={(attachments) => edit({ attachments })} />
      </Sec>

      <Sec id="build" title="Build" icon="play">
        {isNew ? <p className="fx-muted">Save the plan first.</p> : <BuildPanel plan={saved ?? plan} dirty={dirty} />}
      </Sec>

      <Sec id="history" title={`History${hist ? ` (${hist.versions.length})` : ''}`} icon="clock">
        {isNew ? <p className="fx-muted">Saved versions show here.</p> : <HistoryPanel history={hist} current={plan} onRestore={(v) => run(async () => { const r = await restorePlan(plan.id, v); setSaved(r.plan); setPlan(r.plan); rt.toast(`Restored version ${v}`, 'success'); })} />}
      </Sec>

      <Sec id="comments" title={`Comments (${plan.comments.length})`} icon="info">
        <Comments plan={plan} onChange={(comments) => edit({ comments })} />
      </Sec>

      {!isNew && (
        <div className="fx-row axp-plan-studio__danger">
          <Button size="sm" tone="quiet" icon="copy" onClick={() => run(async () => { const copy = pc.normalize({ ...plan, id: undefined, title: `${plan.title} (copy)`, build: null, createdAt: undefined, updatedAt: undefined, version: 1 }); const r = await savePlan(copy, { force: true, note: `Copied from ${plan.id}` }); onOpen(r.plan.id); })}>Duplicate</Button>
          <Button size="sm" tone="quiet" icon="star" onClick={() => run(async () => { const label = window.prompt('Template name', plan.title); if (!label) return; await call('template-save', { template: pc.asTemplate(plan, label) }); rt.toast(`Template “${label}” saved`, 'success'); })}>Save as template</Button>
          <Button size="sm" tone="danger" icon="trash" confirm={`Delete “${plan.title}”? Its history stays, so it can be restored.`} onClick={() => run(async () => { await deletePlan(plan.id); onClose(); })}>Delete</Button>
        </div>
      )}
    </div>
  );
}

function CategoryPicker({ value, paths, onChange }: { value: string; paths: string[]; onChange: (v: string) => void }) {
  const [own, setOwn] = useState(false);
  if (own) return <TextField label="Category" value={value} onChange={onChange} hint="Parts joined by > (Product > Installer). New ones are added." />;
  return (
    <div className="axp-plan-studio__catpick">
      <SelectField label="Category" value={value} empty="Uncategorized" onChange={(v) => (v === '__new' ? setOwn(true) : onChange(v))} options={[...paths.map((p) => ({ value: p, label: `${'· '.repeat(pc.pathParts(p).length - 1)}${pc.leafName(p)}` })), { value: '__new', label: '+ New category…' }]} />
    </div>
  );
}

function TouchesField({ plan, onChange }: { plan: Plan; onChange: (t: Plan['touches']) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="axp-plan-studio__touches">
      <span className="fx-field__label">Plugins & apps it touches</span>
      <div className="fx-row fx-row--wrap">
        {plan.touches.map((t) => <span key={t.key} className="axp-plan-studio__tchip"><Chip>{t.name || t.key}</Chip><IconButton icon="x" label={`Remove ${t.key}`} onClick={() => onChange(plan.touches.filter((x) => x.key !== t.key))} /></span>)}
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onChange([...plan.touches, { key: text.trim() }]); setText(''); } }} className="axp-plan-studio__tadd">
          <label className="fx-search"><Icon name="plus" size={12} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="plugin:build-breaker · app:amberx-droid" aria-label="Add a catalog key" /></label>
        </form>
      </div>
      <p className="fx-muted axp-plan-studio__hint">Pick them from the Catalog tab (“Add to a plan”) or type a catalog key.</p>
    </div>
  );
}

function StepsEditor({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const [text, setText] = useState('');
  const [model, setModel] = useState<Step['model']>('Opus');
  const [mins, setMins] = useState('20');
  const upd = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x!); onChange(n); };
  const add = () => { if (!text.trim()) return; let k = steps.length + 1; while (steps.some((s) => s.id === `s${k}`)) k += 1; onChange([...steps, { id: `s${k}`, text: text.trim(), model, minutes: pc.minutesOf(mins) || 20, dependsOn: [], done: false, doneAt: '', phase: '' }]); setText(''); };
  const big = steps.filter((s) => s.minutes > 30);
  return (
    <div className="axp-plan-studio__steps">
      {big.length > 0 && <p className="fx-muted axp-plan-studio__hint"><Icon name="alert" size={11} /> {big.map((s) => s.id).join(', ')} {big.length === 1 ? 'is' : 'are'} over 30 minutes: split {big.length === 1 ? 'it' : 'them'} (small-steps rule).</p>}
      <ol>
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? 'is-done' : ''}>
            <input type="checkbox" className="fx-check" checked={s.done} onChange={(e) => upd(i, { done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : '' })} aria-label={`${s.id} done`} />
            <span className="axp-plan-studio__sid">{s.id}</span>
            <input className="fx-input axp-plan-studio__stext" value={s.text} onChange={(e) => upd(i, { text: e.target.value })} aria-label={`${s.id} text`} />
            <select className="fx-input axp-plan-studio__smodel" value={s.model} onChange={(e) => upd(i, { model: e.target.value as Step['model'] })} aria-label={`${s.id} model`}>{pc.MODELS.map((m) => <option key={m}>{m}</option>)}</select>
            <input className="fx-input axp-plan-studio__smin" inputMode="numeric" value={s.minutes || ''} onChange={(e) => upd(i, { minutes: pc.minutesOf(e.target.value) })} aria-label={`${s.id} minutes`} placeholder="min" />
            <input className="fx-input axp-plan-studio__sdep" value={s.dependsOn.join(',')} onChange={(e) => upd(i, { dependsOn: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} aria-label={`${s.id} depends on`} placeholder="after…" />
            <span className="axp-plan-studio__sact">
              <IconButton icon="chevron-up" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon="chevron-down" label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon="trash" label={`Remove ${s.id}`} onClick={() => onChange(steps.filter((_, j) => j !== i).map((x) => ({ ...x, dependsOn: x.dependsOn.filter((d) => d !== s.id) })))} />
            </span>
          </li>
        ))}
      </ol>
      <form className="axp-plan-studio__sadd" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="fx-input axp-plan-studio__stext" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a step…" aria-label="New step" />
        <Segmented size="sm" label="Model" value={model} onChange={setModel} options={pc.MODELS.map((m) => ({ value: m, label: m }))} />
        <input className="fx-input axp-plan-studio__smin" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} aria-label="Minutes" />
        <Button size="sm" icon="plus" type="submit" disabled={!text.trim()}>Add</Button>
      </form>
    </div>
  );
}

function ListEditor({ id, items, onChange }: { id: ListId; items: TextItem[]; onChange: (x: TextItem[]) => void }) {
  const [text, setText] = useState('');
  const meta = pc.LISTS[id];
  const extra = id === 'questions' ? 'answer' : id === 'risks' ? 'mitigation' : '';
  return (
    <div className="axp-plan-studio__list">
      <h3>{meta.label} <span className="axp-plan-studio__n">{items.length}</span></h3>
      <ul>
        {items.map((x, i) => (
          <li key={i}>
            {meta.item === 'check' && <input type="checkbox" className="fx-check" checked={!!x.done} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y)))} aria-label="Done" />}
            <input className="fx-input" value={x.text} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} aria-label={meta.label} />
            {extra && <input className="fx-input" value={String(x[extra] ?? '')} placeholder={extra === 'answer' ? 'Answer' : 'Mitigation'} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, [extra]: e.target.value } : y)))} aria-label={extra} />}
            <IconButton icon="x" label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onChange([...items, { text: text.trim() }]); setText(''); } }} className="axp-plan-studio__ladd">
        <input className="fx-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add to ${meta.label.toLowerCase()}…`} aria-label={`Add to ${meta.label}`} />
        <IconButton icon="plus" label="Add" type="submit" />
      </form>
    </div>
  );
}

function LinksEditor({ plan, plans, onChange, onOpen }: { plan: Plan; plans: Plan[]; onChange: (l: Plan['links']) => void; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState('related');
  const [ref, setRef] = useState('');
  const rel = ['depends', 'blocks', 'part-of', 'related'];
  const back = plans.filter((p) => p.id !== plan.id && p.links.some((l) => rel.includes(l.kind) && l.ref === plan.id));
  return (
    <div className="axp-plan-studio__links">
      <ul>
        {plan.links.map((l, i) => {
          const target = rel.includes(l.kind) ? plans.find((p) => p.id === l.ref) : null;
          const href = /^https?:/.test(l.ref) ? l.ref : l.kind === 'pr' && /^\d+$/.test(l.ref) ? `https://github.com/MossesX/AmberX-AXF/pull/${l.ref}` : '';
          return (
            <li key={i}>
              <Chip>{l.kind}</Chip>
              {target ? <button type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => onOpen(target.id)}>{target.title}</button> : href ? <a href={href} target="_blank" rel="noreferrer">{l.label || l.ref}</a> : <span className="fx-mono">{l.ref}</span>}
              {l.label && !target && href === '' && <span className="fx-muted">{l.label}</span>}
              <IconButton icon="x" label="Remove link" onClick={() => onChange(plan.links.filter((_, j) => j !== i))} />
            </li>
          );
        })}
      </ul>
      {back.length > 0 && <p className="fx-muted axp-plan-studio__hint">Linked from: {back.map((p) => <button key={p.id} type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => onOpen(p.id)}>{p.title}</button>)}</p>}
      <form className="axp-plan-studio__ladd" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) { onChange([...plan.links, { kind, ref: ref.trim(), label: '' }]); setRef(''); } }}>
        <select className="fx-input axp-plan-studio__smodel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Link kind">{pc.LINK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        {rel.includes(kind)
          ? <select className="fx-input" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Plan"><option value="">Pick a plan…</option>{plans.filter((p) => p.id !== plan.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
          : <input className="fx-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={kind === 'pr' ? '159' : kind === 'branch' ? 'claude/plans' : kind === 'build' ? 'angel:plan-studio' : 'https://…'} aria-label="Link" />}
        <IconButton icon="plus" label="Add link" type="submit" />
      </form>
    </div>
  );
}

function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit');
  const toc = pc.outline(value);
  return (
    <div className="axp-plan-studio__body">
      <div className="fx-row"><Segmented size="sm" label="Notes view" value={mode} onChange={setMode} options={[{ value: 'edit', label: 'Write' }, { value: 'preview', label: 'Preview' }, { value: 'split', label: 'Both' }]} /></div>
      {toc.length > 1 && <nav className="axp-plan-studio__toc" aria-label="Outline">{toc.map((h, i) => <span key={i} className={`is-l${h.level}`}>{h.text}</span>)}</nav>}
      <div className={`axp-plan-studio__bodypanes is-${mode}`}>
        {mode !== 'preview' && <textarea className="fx-input fx-mono" rows={14} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Notes in Markdown" placeholder="# Notes&#10;Anything else: background, sketches, links…" />}
        {mode !== 'edit' && <div className="axp-plan-studio__preview"><Markdown text={value || '_Nothing yet._'} /></div>}
      </div>
    </div>
  );
}

function Attachments({ plan, onChange }: { plan: Plan; onChange: (a: Plan['attachments']) => void }) {
  const [err, setErr] = useState('');
  const add = async (files: FileList | null) => {
    setErr('');
    const list = [...plan.attachments];
    for (const f of Array.from(files ?? [])) {
      if (f.size > 2_000_000) { setErr(`${f.name} is over 2 MB: link it instead (Links → url).`); continue; }
      const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(f); });
      const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'voice' : 'file';
      list.push({ id: `a-${pc.rid()}`, kind, name: f.name, url, size: f.size, transcript: '' });
    }
    onChange(list);
  };
  return (
    <div className="axp-plan-studio__files">
      <label className="fx-btn fx-btn--sm"><Icon name="upload" size={12} /> Add images, files or voice notes<input type="file" multiple hidden accept="image/*,audio/*,.pdf,.md,.txt,.json" onChange={(e) => void add(e.target.files)} /></label>
      {err && <p className="fx-error">{err}</p>}
      <ul>
        {plan.attachments.map((a, i) => (
          <li key={a.id}>
            {a.kind === 'image' && a.url ? <img src={a.url} alt={a.name} className="axp-plan-studio__thumb" /> : <Icon name={a.kind === 'voice' ? 'mic' : 'file'} size={14} />}
            <span className="axp-plan-studio__fname">{a.url ? <a href={a.url} download={a.name}>{a.name}</a> : a.name}</span>
            {a.kind === 'voice' && <><audio controls src={a.url} className="axp-plan-studio__audio" /><input className="fx-input" placeholder="Transcript" value={a.transcript} onChange={(e) => onChange(plan.attachments.map((x, j) => (j === i ? { ...x, transcript: e.target.value } : x)))} aria-label="Transcript" /></>}
            <IconButton icon="trash" label={`Remove ${a.name}`} onClick={() => onChange(plan.attachments.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BuildPanel({ plan, dirty }: { plan: Plan; dirty: boolean }) {
  const rt = useRuntime();
  const { state } = useStudio();
  const [profile, setProfile] = useState(plan.profile || state?.activeProfile || '');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof turnIntoBuild>> | null>(null);
  const { busy, error, run } = useBusy();
  if (plan.build) {
    return (
      <div className="axp-plan-studio__build">
        <p><b>Orchestrator build</b> <span className="fx-mono">{plan.build.profile}:{plan.build.id}</span> · {plan.build.status} · {plan.build.progress ?? 0}%</p>
        <div className="axp-plan-studio__bar" role="progressbar" aria-valuenow={plan.build.progress ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${plan.build.progress ?? 0}%` }} /></div>
        <div className="fx-row"><Button size="sm" icon="layers" onClick={() => rt.dispatch('nav:build-orchestrator')}>Open the orchestrator</Button><Button size="sm" tone="quiet" icon="refresh" busy={busy} onClick={() => run(async () => { await call('sync-builds'); })}>Check progress</Button></div>
        <p className="fx-muted axp-plan-studio__hint">The plan ticks its steps as the build does, and turns done (its planned features to have) when the build completes.</p>
      </div>
    );
  }
  return (
    <div className="axp-plan-studio__build">
      <div className="axp-plan-studio__grid2">
        <SelectField label="Build profile" value={profile} onChange={setProfile} options={(state?.profiles ?? []).map((p) => ({ value: p.id, label: p.label }))} />
        <div className="fx-row axp-plan-studio__bottom"><Button size="sm" icon="eye" busy={busy} disabled={dirty || !plan.steps.length} onClick={() => run(async () => { const r = await turnIntoBuild(plan.id, profile, true); if (!r.ok) throw new Error(r.error); setPreview(r); })}>Preview steps</Button></div>
      </div>
      {dirty && <p className="fx-muted axp-plan-studio__hint">Save first.</p>}
      {!plan.steps.length && <p className="fx-muted axp-plan-studio__hint">Add steps first: each one becomes an orchestrator step with its model and estimate.</p>}
      {error && <p className="fx-error">{error}</p>}
      {preview?.change && (
        <div className="axp-plan-studio__diff">
          <p className="axp-plan-studio__difftitle">Build <span className="fx-mono">{preview.change.id}</span> in {profile} · {preview.change.steps.length} steps · {pc.fmtMinutes(preview.minutes ?? 0)}</p>
          <ol>{preview.change.steps.map((s, i) => <li key={i}>{s.text} <span className="fx-muted">({s.model}, {s.estimate})</span></li>)}</ol>
          <div className="fx-row">
            <Button size="sm" tone="primary" icon="play" busy={busy} onClick={() => run(async () => { const r = await turnIntoBuild(plan.id, profile, false); if (!r.ok) throw new Error(r.error); setPreview(null); rt.toast(`Build ${r.build?.id} added to the ${profile} orchestrator`, 'success'); })}>Add to the orchestrator</Button>
            <Button size="sm" tone="quiet" icon="x" onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ history, current, onRestore }: { history: History | null; current: Plan; onRestore: (v: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!history) return <p className="fx-muted">Loading the history…</p>;
  const vs = [...history.versions].reverse();
  return (
    <ol className="axp-plan-studio__hist">
      {vs.map((v) => {
        const d = pc.describeDiff(pc.diff(v.plan, current));
        return (
          <li key={v.v}>
            <button type="button" data-fx-row className="axp-plan-studio__hrow" aria-expanded={open === v.v} onClick={() => setOpen(open === v.v ? null : v.v)}>
              <b>v{v.v}</b> <span>{v.note || v.kind}</span> <span className="fx-muted">{v.by && `${v.by} · `}{fmtWhen(v.at)}</span>
            </button>
            {open === v.v && (
              <div className="axp-plan-studio__hbody">
                {d.length ? <><p className="fx-muted">From this version to now:</p><ul>{d.slice(0, 40).map((x, i) => <li key={i} className={x.startsWith('+') ? 'is-add' : x.startsWith('−') ? 'is-del' : ''}>{x}</li>)}</ul></> : <p className="fx-muted">Same as now.</p>}
                {d.length > 0 && <Button size="sm" icon="restore" onClick={() => onRestore(v.v)}>Restore v{v.v}</Button>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Comments({ plan, onChange }: { plan: Plan; onChange: (c: Plan['comments']) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="axp-plan-studio__comments">
      <ul>{plan.comments.map((c) => <li key={c.id}><b>{c.by || 'Someone'}</b> <span className="fx-muted">{fmtWhen(c.at)}</span><p>{c.text}</p></li>)}</ul>
      <form className="axp-plan-studio__ladd" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onChange([...plan.comments, { id: `c-${pc.rid()}`, by: 'Brett', at: new Date().toISOString(), text: text.trim() }]); setText(''); } }}>
        <input className="fx-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" aria-label="Comment" />
        <IconButton icon="plus" label="Add comment" type="submit" />
      </form>
    </div>
  );
}

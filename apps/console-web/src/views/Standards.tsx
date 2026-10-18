import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, useRuntime } from '../axf/react';
import * as api from '../api';
import { RULE_OPS, ruleSeverity, validateProjectManifest, validateProjectRules, type ProjectRule, type ProjectRules, type RuleOp, type RuleSeverity } from '../axf/core/project';

/*
 * Standards: the rules every project must meet. First standard: project manifests (project.manifest.json,
 * project-manifest@1). The build engine never loads or compiles a project whose manifest fails these rules.
 *   Projects        every project in the repo, its hub folder (/projects/<name>), its repo and its validation
 *   Manifest rules  the rules themselves (framework/schemas/project-rules.json, the shared copy on the hub):
 *                   severity per rule, vocabularies, custom rules, and a scratch pad to try a manifest
 * Locked rules are always errors and can't be removed or changed; the server refuses a rules file that tries.
 */

const SEVERITIES: RuleSeverity[] = ['error', 'warn', 'off'];
const SEV_LABEL: Record<RuleSeverity, string> = { error: 'Error', warn: 'Warning', off: 'Off' };
const OP_HELP: Partial<Record<RuleOp, string>> = {
  equals: 'Exactly this value', pattern: 'Text matching a pattern', notIn: 'Not one of these values', string: 'Text of a given length',
  oneOf: 'One of a vocabulary', eachOneOf: 'Every item from a vocabulary', boolean: 'true or false', relativePaths: 'Paths inside the project',
  pathsExist: 'Paths that exist', requiredWhen: 'Required when another field has a value', knownKeys: 'No unknown top-level fields',
};

function checkSummary(r: ProjectRule): string {
  const c = r.check;
  const req = c.required ? ' (required)' : '';
  switch (c.op) {
    case 'equals': return `${c.path} = ${JSON.stringify(c.value)}${req}`;
    case 'pattern': return `${c.path} matches ${c.pattern}${req}`;
    case 'notIn': return `${c.path} not in ${(c.values ?? []).map((v) => JSON.stringify(v)).join(', ')}`;
    case 'string': return `${c.path}: ${c.min ?? 0}–${c.max ?? '∞'} characters${req}`;
    case 'oneOf': case 'eachOneOf': return `${c.path} ${c.op === 'oneOf' ? 'is one of' : 'items are from'} ${c.vocab ? `vocab "${c.vocab}"` : (c.values ?? []).join(', ')}${req}`;
    case 'requiredWhen': return `${c.path} required when ${c.when?.path} = ${JSON.stringify(c.when?.equals)}`;
    case 'knownKeys': return 'top-level fields from the known list only';
    default: return `${c.path}: ${OP_HELP[c.op] ?? c.op}${req}`;
  }
}

export function Standards({ tab }: { tab: 'projects' | 'rules' }) {
  const rt = useRuntime();
  const log = (t: string, l: 'info' | 'ok' | 'warn' | 'error' = 'info') => rt.terminal.log('standards', t, l);
  const [projects, setProjects] = useState<api.ProjectRow[] | null>(null);
  const [rulesFile, setRulesFile] = useState('');
  const [saved, setSaved] = useState<ProjectRules | null>(null);
  const [base, setBase] = useState<ProjectRules | null>(null);
  const [draft, setDraft] = useState<ProjectRules | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [p, r] = await Promise.all([api.loadProjects(), api.loadProjectRules()]);
      setProjects(p.items); setRulesFile(r.file); setSaved(r.rules); setBase(r.base); setDraft(structuredClone(r.rules)); setError('');
    } catch (e) { setError((e as Error).message); setProjects([]); }
  };
  useEffect(() => { void load(); }, []);

  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const problems = useMemo(() => (draft && base ? validateProjectRules(draft, base) : []), [draft, base]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.saveProjectRules(draft);
      if (!r.ok) { log(r.error ?? 'save failed', 'error'); rt.toast(r.error ?? 'Rules were not saved', 'danger'); return; }
      for (const l of r.log ?? []) log(l, 'ok');
      rt.toast('Rules saved', 'success');
      await load();
    } finally { setBusy(false); }
  };

  if (!projects || !draft) return <div className="fx-empty">{error || 'Loading standards…'}</div>;
  const failing = projects.filter((p) => !p.validation.ok).length;

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Standards · project manifests · {projects.length} projects · {draft.rules.length} rules</p>
          <h1>{tab === 'projects' ? 'Projects' : 'Manifest rules'}</h1>
          <p className="fx-muted">
            {tab === 'projects'
              ? 'Every project has a project.manifest.json. Its name is the project’s folder on the hub (/projects/<name>). The build engine never loads or compiles a project whose manifest fails the rules.'
              : 'The rules every project manifest must pass. Locked rules are always errors. Changes apply to the build engine, the CLI and this console as soon as they are saved.'}
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" disabled={busy} onClick={() => load().then(() => log('reloaded', 'ok'))}>Reload</Button>
          {tab === 'rules' && <Button tone="primary" icon="save" disabled={busy || !dirty || problems.length > 0} onClick={save}>Save rules</Button>}
        </div>
      </header>

      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}

      {tab === 'projects' ? (
        <>
          <div className="st-strip">
            <div className="st-count"><b>{projects.length - failing}</b><span>Valid</span></div>
            <div className={`st-count ${failing ? 'is-bad' : ''}`}><b>{failing}</b><span>Can’t build</span></div>
            <div className="st-count"><b>{projects.reduce((n, p) => n + p.validation.warnings.length, 0)}</b><span>Warnings</span></div>
          </div>
          <div className="st-list" role="list">
            {projects.map((p) => <ProjectCard key={p.dir} p={p} />)}
          </div>
          <p className="fx-small fx-muted">New apps get a manifest from their template (<span className="fx-mono">axf init</span>); add one to any folder with <span className="fx-mono">axf project init &lt;dir&gt;</span>. Rules in force: <span className="fx-mono">{rulesFile}</span>.</p>
        </>
      ) : (
        <RulesEditor draft={draft} setDraft={setDraft} base={base} problems={problems} dirty={dirty} busy={busy} onReset={() => saved && setDraft(structuredClone(saved))} />
      )}
    </div>
  );
}

function ProjectCard({ p }: { p: api.ProjectRow }) {
  const m = p.manifest;
  const v = p.validation;
  const repo = m?.repo;
  return (
    <article className={`st-card ${v.ok ? '' : 'is-bad'}`} role="listitem">
      <div className="st-card__top">
        <h2 className="st-card__title">{m?.displayName ?? p.dir}<span className="fx-muted fx-small fx-mono"> {m?.name ?? 'no manifest'}</span></h2>
        <span className={`st-badge ${v.ok ? (v.warnings.length ? 'is-warn' : 'is-ok') : 'is-bad'}`}>{v.ok ? (v.warnings.length ? `${v.warnings.length} warning${v.warnings.length > 1 ? 's' : ''}` : 'Valid') : `${v.errors.length} error${v.errors.length > 1 ? 's' : ''}`}</span>
      </div>
      <div className="st-meta">
        <span className="fx-mono">{p.dir}</span>
        {m?.kind && <span>{m.kind}{m.framework?.relation ? ` · ${m.framework.relation}` : ''}</span>}
        {m?.name && <span className="fx-mono">/projects/{m.name}</span>}
        {repo && <span><Icon name="github" size={12} /> {repo.owner}/{repo.name} {repo.exists ? '' : '(reserved)'}</span>}
        {m?.data?.shared?.length ? <span>{m.data.shared.length} shared data path{m.data.shared.length > 1 ? 's' : ''}</span> : null}
      </div>
      {(v.errors.length > 0 || v.warnings.length > 0) && (
        <ul className="st-issues">
          {v.errors.map((e, i) => <li key={`e${i}`} className="is-bad"><Icon name="x-circle" size={13} />{e.message}<span className="fx-mono fx-muted"> {e.rule}</span></li>)}
          {v.warnings.map((w, i) => <li key={`w${i}`} className="is-warn"><Icon name="alert" size={13} />{w.message}<span className="fx-mono fx-muted"> {w.rule}</span></li>)}
        </ul>
      )}
    </article>
  );
}

function RulesEditor({ draft, setDraft, base, problems, dirty, busy, onReset }: {
  draft: ProjectRules; setDraft: (r: ProjectRules) => void; base: ProjectRules | null; problems: string[]; dirty: boolean; busy: boolean; onReset: () => void;
}) {
  const baseIds = new Set((base?.rules ?? []).map((r) => r.id));
  const update = (i: number, patch: Partial<ProjectRule>) => setDraft({ ...draft, rules: draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const remove = (i: number) => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) });
  return (
    <>
      {dirty && (
        <div className={`pl-note ${problems.length ? 'is-error' : ''}`}>
          <Icon name={problems.length ? 'alert' : 'info'} size={14} />
          <span>{problems.length ? `Can’t save yet: ${problems.join('; ')}` : 'Unsaved changes.'}</span>
          <Button tone="ghost" disabled={busy} onClick={onReset}>Discard</Button>
        </div>
      )}
      <div className="st-list" role="list">
        {draft.rules.map((r, i) => (
          <article key={r.id + i} className={`st-card st-rule ${ruleSeverity(r) === 'off' ? 'is-off' : ''}`} role="listitem">
            <div className="st-card__top">
              <h2 className="st-card__title">{r.locked && <Icon name="lock" size={13} />} {r.title}<span className="fx-muted fx-small fx-mono"> {r.id}</span></h2>
              <div className="st-seg" role="group" aria-label={`Severity of ${r.title}`}>
                {SEVERITIES.map((s) => (
                  <button key={s} className={`st-seg__b is-${s}`} aria-pressed={ruleSeverity(r) === s} disabled={r.locked || busy} title={r.locked ? 'Locked: always an error' : undefined} onClick={() => update(i, { severity: s })}>{SEV_LABEL[s]}</button>
                ))}
              </div>
            </div>
            {r.description && <p className="st-desc">{r.description}</p>}
            <div className="st-meta"><span className="fx-mono">{checkSummary(r)}</span>{!baseIds.has(r.id) && <span className="st-tag">custom</span>}</div>
            {!r.locked && !baseIds.has(r.id) && <div><Button icon="trash" disabled={busy} onClick={() => remove(i)}>Remove rule</Button></div>}
          </article>
        ))}
      </div>
      <Vocab draft={draft} setDraft={setDraft} busy={busy} />
      <AddRule draft={draft} setDraft={setDraft} busy={busy} />
      <TryManifest rules={draft} />
    </>
  );
}

function Vocab({ draft, setDraft, busy }: { draft: ProjectRules; setDraft: (r: ProjectRules) => void; busy: boolean }) {
  const [adding, setAdding] = useState<Record<string, string>>({});
  const set = (name: string, values: string[]) => setDraft({ ...draft, vocab: { ...draft.vocab, [name]: values } });
  return (
    <details className="st-panel">
      <summary>Vocabularies</summary>
      <p className="fx-small fx-muted">The values “one of” rules accept (kinds, statuses, platforms…). Removing a value a project uses makes that project fail.</p>
      <div className="fx-stack">
        {Object.entries(draft.vocab).map(([name, values]) => (
          <div key={name} className="st-vocab">
            <h3 className="fx-mono">{name}</h3>
            <div className="st-chips">
              {values.map((v) => (
                <span key={v} className="st-chip">{v}<button aria-label={`Remove ${v}`} disabled={busy} onClick={() => set(name, values.filter((x) => x !== v))}><Icon name="x" size={11} /></button></span>
              ))}
              <form className="st-chipadd" onSubmit={(e) => { e.preventDefault(); const v = (adding[name] ?? '').trim(); if (v && !values.includes(v)) set(name, [...values, v]); setAdding({ ...adding, [name]: '' }); }}>
                <input className="fx-input" value={adding[name] ?? ''} onChange={(e) => setAdding({ ...adding, [name]: e.target.value })} placeholder="add value" aria-label={`Add to ${name}`} />
              </form>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function AddRule({ draft, setDraft, busy }: { draft: ProjectRules; setDraft: (r: ProjectRules) => void; busy: boolean }) {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [op, setOp] = useState<RuleOp>('pattern');
  const [path, setPath] = useState('');
  const [param, setParam] = useState('');
  const [required, setRequired] = useState(false);
  const [severity, setSeverity] = useState<RuleSeverity>('warn');
  const needsParam = op === 'equals' || op === 'pattern' || op === 'notIn' || op === 'oneOf' || op === 'eachOneOf' || op === 'string' || op === 'requiredWhen';
  const hint = op === 'pattern' ? 'Pattern, e.g. ^[a-z]+$' : op === 'equals' ? 'Value (JSON or text)' : op === 'notIn' ? 'Values, comma separated' : op === 'string' ? 'min,max e.g. 1,200'
    : op === 'requiredWhen' ? 'other.path=value (JSON value), e.g. repo.exists=false' : 'Vocabulary name, or values comma separated';
  const parseValue = (t: string): unknown => { try { return JSON.parse(t); } catch { return t; } };
  const add = () => {
    const check: Record<string, unknown> = { op };
    if (op !== 'knownKeys') check.path = path.trim();
    if (required) check.required = true;
    const t = param.trim();
    if (op === 'equals') check.value = parseValue(t);
    if (op === 'pattern') check.pattern = t;
    if (op === 'notIn') check.values = t.split(',').map((s) => s.trim()).filter(Boolean);
    if (op === 'string') { const [min, max] = t.split(',').map((n) => Number(n.trim())); check.min = Number.isFinite(min) ? min : 0; if (Number.isFinite(max)) check.max = max; }
    if (op === 'oneOf' || op === 'eachOneOf') { if (t in draft.vocab) check.vocab = t; else check.values = t.split(',').map((s) => s.trim()).filter(Boolean); }
    if (op === 'requiredWhen') { const [p, v] = t.split('='); check.when = { path: (p ?? '').trim(), equals: parseValue((v ?? '').trim()) }; }
    setDraft({ ...draft, rules: [...draft.rules, { id: id.trim(), title: title.trim(), description: description.trim() || undefined, severity, locked: false, check: check as unknown as ProjectRule['check'] }] });
    setId(''); setTitle(''); setDescription(''); setPath(''); setParam(''); setRequired(false);
  };
  return (
    <details className="st-panel">
      <summary>Add a rule</summary>
      <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="pd-two">
          <label className="pd-field">Id<input className="fx-input fx-mono" required value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="e.g. description-required" pattern="[a-z0-9][a-z0-9-]{0,63}" /></label>
          <label className="pd-field">Title<input className="fx-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short name" /></label>
        </div>
        <label className="pd-field">Why (shown with the rule)<input className="fx-input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="pd-two">
          <label className="pd-field">Check<select className="fx-input" value={op} onChange={(e) => setOp(e.target.value as RuleOp)}>{RULE_OPS.map((o) => <option key={o} value={o}>{OP_HELP[o] ?? o}</option>)}</select></label>
          {op !== 'knownKeys' && <label className="pd-field">Field (dot path)<input className="fx-input fx-mono" required value={path} onChange={(e) => setPath(e.target.value)} placeholder="e.g. description or repo.visibility" /></label>}
        </div>
        {needsParam && <label className="pd-field">{hint}<input className="fx-input fx-mono" value={param} onChange={(e) => setParam(e.target.value)} /></label>}
        <div className="fx-row fx-row--wrap">
          <label className="fx-row"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required</label>
          <div className="st-seg" role="group" aria-label="Severity">
            {SEVERITIES.map((s) => <button type="button" key={s} className={`st-seg__b is-${s}`} aria-pressed={severity === s} onClick={() => setSeverity(s)}>{SEV_LABEL[s]}</button>)}
          </div>
        </div>
        <div><Button tone="primary" icon="plus" type="submit" disabled={busy || !id.trim() || !title.trim()}>Add rule</Button> <span className="fx-small fx-muted">Then Save rules at the top.</span></div>
      </form>
    </details>
  );
}

function TryManifest({ rules }: { rules: ProjectRules }) {
  const [text, setText] = useState('');
  const result = useMemo(() => {
    if (!text.trim()) return null;
    try { return validateProjectManifest(JSON.parse(text), rules); } catch (e) { return { ok: false, errors: [{ rule: 'json', path: '', message: (e as Error).message }], warnings: [] }; }
  }, [text, rules]);
  return (
    <details className="st-panel">
      <summary>Try a manifest against these rules</summary>
      <textarea className="fx-input fx-mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='Paste a project.manifest.json, e.g. {"$manifest": "project-manifest@1", "name": "my-app", …}' />
      {result && (
        result.ok && !result.warnings.length ? <div className="pl-note"><Icon name="check-circle" size={14} />Valid: this project could be loaded and compiled.</div> : (
          <ul className="st-issues">
            {result.errors.map((e, i) => <li key={`e${i}`} className="is-bad"><Icon name="x-circle" size={13} />{e.message}<span className="fx-mono fx-muted"> {e.rule}</span></li>)}
            {result.warnings.map((w, i) => <li key={`w${i}`} className="is-warn"><Icon name="alert" size={13} />{w.message}<span className="fx-mono fx-muted"> {w.rule}</span></li>)}
          </ul>
        )
      )}
    </details>
  );
}

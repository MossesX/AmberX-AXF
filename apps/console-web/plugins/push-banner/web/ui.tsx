/** Push banner UI: the banner (open pull requests + branches not on main, grouped by what's ready) and the settings panel. Theme tokens only. */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Icon, Switch, useAxfState, useBannerLaunchOpen, useRuntime } from '@console/axf/react';
import { ago, bannerOn, doneKeys, doneRows, fixWithClaude, load, loadDetail, mergePr, needsPull, openPr, PULL_ALL, pullAll, pullMain, pullRows, removeDone, rows, saveClaude, setHidden, useStore, type Done, type PullRow, type Row } from './store';

const CI_WORD: Record<string, string> = { success: 'CI passed', failure: 'CI failed', running: 'CI running', none: 'no CI yet', unknown: 'CI unknown' };
const CI_ICON: Record<string, string> = { success: 'check-circle', failure: 'x-circle', running: 'refresh', none: 'clock', unknown: 'help' };
const short = (repo: string) => repo.split('/')[1] ?? repo;

function Note({ k }: { k: string }) {
  const s = useStore();
  return s.note?.key === k ? <span className={`axp-push-banner__note is-${s.note.tone}`} role="status">{s.note.text}</span> : null;
}

/** Pull the default branch into this branch (tap twice): GitHub's "update branch" for a PR, a merge commit otherwise. */
function PullMainButton({ k, repo, base, number, branch }: { k: string; repo: string; base: string; number?: number; branch?: string }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  if (sure) return (
    <>
      <Button size="sm" tone="success" icon="check" disabled={s.busy === k} onClick={() => { setSure(false); void pullMain({ key: k, repo, base, number, branch }); }}>Pull {base} in?</Button>
      <Button size="sm" tone="quiet" onClick={() => setSure(false)}>Cancel</Button>
    </>
  );
  return <Button size="sm" tone="neutral" icon="download" disabled={s.busy === k} title={`Bring ${base}'s newer commits into this branch`} onClick={() => setSure(true)}>Pull {base} in</Button>;
}

/** "Fix with Claude" (setting on): hands a conflicted or failing entry to headless Claude Code on the VPS (tap twice). */
function ClaudeButton({ k, repo, number, branch }: { k: string; repo: string; number?: number; branch?: string }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  if (!s.claude?.on) return null;
  const job = s.claude.jobs.find((j) => j.key === k);
  if (job && (job.state === 'asking' || job.state === 'waiting')) return <span className="axp-push-banner__note is-ok">{job.state === 'waiting' ? 'Claude: approve on axHub' : 'Claude: asking axHub…'}</span>;
  if (sure) return (
    <>
      <Button size="sm" tone="primary" icon="sparkles" disabled={s.busy === k} onClick={() => { setSure(false); void fixWithClaude({ key: k, repo, number, branch }); }}>Hand to Claude?</Button>
      <Button size="sm" tone="quiet" onClick={() => setSure(false)}>Cancel</Button>
    </>
  );
  return <Button size="sm" tone="neutral" icon="sparkles" disabled={s.busy === k} title="Headless Claude Code on the VPS fixes it on this branch (you approve the launch on axHub)" onClick={() => setSure(true)}>{job?.state === 'launched' ? 'Claude again' : 'Fix with Claude'}</Button>;
}

const pullBehind = (p: PullRow) => !p.fork && (needsPull(p.behind, p.mergeState) || p.mergeState === 'behind');

function HideButton({ k, label }: { k: string; label: string }) {
  const s = useStore();
  return <button type="button" className="fx-iconbtn" aria-label={`Hide ${label}`} title="Hide (every device)" disabled={s.busy === k} onClick={() => void setHidden({ key: k }, true)}><Icon name="x" size={14} /></button>;
}

const CHECK_ICON = (c: { status: string; conclusion: string }) => c.status !== 'completed' ? 'refresh' : c.conclusion === 'success' ? 'check-circle' : ['skipped', 'neutral'].includes(c.conclusion) ? 'minus' : 'x-circle';
const MERGE_WORD: Record<string, string> = { clean: 'can merge cleanly', behind: 'is behind its base', dirty: 'has conflicts', blocked: 'is blocked (checks or reviews)', unstable: 'can merge, some checks aren’t green', draft: 'is a draft', has_hooks: 'can merge (hooks run)', unknown: 'GitHub is still working it out' };

/** Tap an entry: what's in it (commits), what CI says about its head (each check), and where it stands. */
function Details({ k, repo, number, branch, url, lines }: { k: string; repo: string; number?: number; branch?: string; url: string; lines: string[] }) {
  const s = useStore();
  const d = s.details[k];
  useEffect(() => { void loadDetail({ key: k, repo, number, branch }); }, [k, repo, number, branch]);
  const data = d?.data;
  return (
    <div className="axp-push-banner__detail">
      {lines.filter(Boolean).map((l) => <span key={l} className="axp-push-banner__meta">{l}</span>)}
      {data?.mergeState && <span className="axp-push-banner__meta">GitHub: it {MERGE_WORD[data.mergeState] ?? data.mergeState}{data.files != null ? ` · ${data.files} file(s) changed` : ''}</span>}
      {!data?.mergeState && data?.files != null && <span className="axp-push-banner__meta">{data.files} file(s) changed</span>}
      {d?.loading && !data && <span className="axp-push-banner__meta">Loading…</span>}
      {(d?.error || data?.error) && <span className="axp-push-banner__note is-danger">{d?.error || data?.error}</span>}
      {data && data.checks.length > 0 && (
        <div className="axp-push-banner__sec">
          <h5>Checks on its newest commit ({data.checks.length})</h5>
          <ul>{data.checks.map((c, i) => (
            <li key={`${c.name}-${i}`} className={`is-${c.status !== 'completed' ? 'running' : c.conclusion || 'none'}`}>
              <Icon name={CHECK_ICON(c)} size={11} />
              {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a> : <span>{c.name}</span>}
              <span className="axp-push-banner__meta">{c.status !== 'completed' ? c.status.replace('_', ' ') : c.conclusion || 'done'}</span>
            </li>
          ))}</ul>
        </div>
      )}
      {data && !data.checks.length && !data.error && <span className="axp-push-banner__meta">No checks on its newest commit yet.</span>}
      {data && data.commits.length > 0 && (
        <div className="axp-push-banner__sec">
          <h5>Commits ({data.commits.length}{data.commits.length >= 20 ? '+' : ''}, newest first)</h5>
          <ul>{data.commits.map((c) => (
            <li key={c.sha}>
              <code>{c.sha.slice(0, 7)}</code>
              {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.subject || '(no message)'}</a> : <span>{c.subject}</span>}
              <span className="axp-push-banner__meta">{[c.author, ago(c.date)].filter(Boolean).join(' · ')}</span>
            </li>
          ))}</ul>
        </div>
      )}
      {data?.body && <p className="axp-push-banner__sub">{data.body}</p>}
      <div className="axp-push-banner__foot">
        {url && <a className="fx-btn fx-btn--quiet fx-btn--sm" href={url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />Open on GitHub</a>}
        <Button size="sm" tone="quiet" icon="refresh" disabled={d?.loading} onClick={() => void loadDetail({ key: k, repo, number, branch }, true)}>Reload</Button>
      </div>
    </div>
  );
}

/** The entry's title line: tap to open its details (the chevron says which way). */
function Expander({ open, onToggle, chip, title, label }: { open: boolean; onToggle: () => void; chip: string; title: string; label: string }) {
  return (
    <button type="button" data-fx-row className="axp-push-banner__line axp-push-banner__expand" aria-expanded={open} title={open ? 'Hide the details' : 'Show the details'} aria-label={`${label}: ${open ? 'hide' : 'show'} details`} onClick={onToggle}>
      <span className="axp-push-banner__chip">{chip}</span>
      <span className="axp-push-banner__name is-title">{title}</span>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
    </button>
  );
}

/** An open pull request: why it is or isn't ready, and Merge (tap twice) when it is. */
function PullItem({ p }: { p: PullRow }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  const [open, setOpen] = useState(false);
  const busy = s.busy === p.key;
  const behind = pullBehind(p);
  const why = p.ready ? 'Ready to merge' : p.mergeState === 'dirty' ? 'Has conflicts' : behind ? `Behind ${p.base}` : p.draft ? 'Draft' : p.ci !== 'success' ? (CI_WORD[p.ci] ?? 'CI unknown') : p.mergeable === false ? 'Has conflicts' : 'GitHub is still checking it';
  return (
    <li className={`axp-push-banner__item is-ci-${p.ci}${p.ready ? ' is-ready' : ''}`}>
      <div className="axp-push-banner__entry">
        <Expander open={open} onToggle={() => setOpen(!open)} chip={short(p.repo)} title={`#${p.number} ${p.title}`} label={`Pull request #${p.number}`} />
        <span className="axp-push-banner__line axp-push-banner__meta">
          <span className={`axp-push-banner__pill is-${p.ready ? 'ready' : p.ci}`}><Icon name={p.ready ? 'check-circle' : CI_ICON[p.ci] ?? 'help'} size={11} />{why}</span>
          <span className="axp-push-banner__ref">{p.head} → {p.base}</span>
          {p.ahead != null && <span>{p.ahead} ahead{p.behind ? ` · ${p.behind} behind` : ''}</span>}
          {p.fork && <span>from a fork{p.author ? ` (${p.author})` : ''}</span>}
          {p.updated && <span>{ago(p.updated)}</span>}
        </span>
        <Note k={p.key} />
        {open && <Details k={p.key} repo={p.repo} number={p.number} url={p.url} lines={[`${p.head} → ${p.base}${p.fork ? ` · from a fork (${p.author})` : p.author ? ` · by ${p.author}` : ''}`, p.draft ? 'Draft: GitHub won’t merge it until it’s marked ready.' : '']} />}
      </div>
      <div className="axp-push-banner__acts">
        {!sure && <Button size="sm" tone="success" icon="branch" disabled={busy || !p.ready} title={p.ready ? `Merge #${p.number} into ${p.base}` : `Merges once it's ready (${why.toLowerCase()})`} onClick={() => setSure(true)}>Merge</Button>}
        {sure && <Button size="sm" tone="success" icon="check" disabled={busy} onClick={() => { setSure(false); void mergePr({ key: p.key, repo: p.repo, number: p.number, base: p.base }); }}>Merge #{p.number} into {p.base}?</Button>}
        {sure && <Button size="sm" tone="quiet" onClick={() => setSure(false)}>Cancel</Button>}
        {!sure && behind && <PullMainButton k={p.key} repo={p.repo} base={p.base} number={p.number} />}
        {!sure && !p.fork && (p.mergeState === 'dirty' || p.mergeable === false || p.ci === 'failure') && <ClaudeButton k={p.key} repo={p.repo} number={p.number} />}
        {!sure && <HideButton k={p.key} label={`pull request #${p.number}`} />}
      </div>
    </li>
  );
}

/** A branch ahead of main with no pull request yet: Open PR. */
function BranchItem({ r }: { r: Row }) {
  const s = useStore();
  const busy = s.busy === r.key;
  const [open, setOpen] = useState(false);
  return (
    <li className="axp-push-banner__item">
      <div className="axp-push-banner__entry">
        <Expander open={open} onToggle={() => setOpen(!open)} chip={short(r.repo)} title={r.name} label={`Branch ${r.name}`} />
        <span className="axp-push-banner__line axp-push-banner__meta">
          {r.ahead == null ? <span className="is-danger">couldn’t compare{r.error ? `: ${r.error}` : ''}</span> : <span>{r.ahead} ahead{r.behind ? ` · ${r.behind} behind` : ''}</span>}
          {r.date && <span>{ago(r.date)}</span>}
        </span>
        {r.subject && <span className="axp-push-banner__sub">{r.subject}</span>}
        <Note k={r.key} />
        {open && <Details k={r.key} repo={r.repo} branch={r.name} url={r.url ?? ''} lines={[`${r.name} → ${r.base} · no pull request yet`]} />}
      </div>
      <div className="axp-push-banner__acts">
        <Button size="sm" tone="neutral" icon="upload" disabled={busy || r.ahead == null} onClick={() => void openPr(r)}>Open PR</Button>
        {needsPull(r.behind) && <PullMainButton k={r.key} repo={r.repo} base={r.base} branch={r.name} />}
        {(r.behind ?? 0) > 0 && <ClaudeButton k={r.key} repo={r.repo} branch={r.name} />}
        <HideButton k={r.key} label={r.name} />
      </div>
    </li>
  );
}

/** A merge or a pull that went through: stays (every device) until its trash can takes it off the banner. */
function DoneItem({ d, sha }: { d: Done; sha?: string }) {
  const s = useStore();
  const merged = d.kind === 'merged';
  return (
    <li className="axp-push-banner__item is-done">
      <div className="axp-push-banner__entry">
        <span className="axp-push-banner__line">
          <span className="axp-push-banner__chip" title={d.repo}>{short(d.repo)}</span>
          {d.url ? <a className="axp-push-banner__name is-title" href={d.url} target="_blank" rel="noopener noreferrer" title="Open on GitHub">{d.number ? `#${d.number} ` : ''}{d.title || d.branch}</a>
            : <span className="axp-push-banner__name is-title">{d.title || d.branch}</span>}
        </span>
        <span className="axp-push-banner__line axp-push-banner__meta">
          <span className="axp-push-banner__pill is-ready"><Icon name="check-circle" size={11} />{merged ? 'Merged' : `Pulled ${d.base || 'main'} in`}</span>
          <span>{ago(new Date(d.at).toISOString())}</span>
          {!merged && <span>CI runs again on the new commit</span>}
        </span>
        <Note k={d.key} />
      </div>
      <div className="axp-push-banner__acts">
        <button type="button" className="fx-iconbtn" aria-label={`Remove "${d.title || d.branch}" from the banner`}
          title={sha ? 'Remove from the banner (every device); it comes back if it gets a new commit' : 'Remove from the banner (every device)'}
          disabled={s.busy === d.key} onClick={() => void removeDone(d, sha)}><Icon name="trash" size={14} /></button>
      </div>
    </li>
  );
}

/** "Pull all" on the Needs main pulled in group (tap twice): main into every entry there, one at a time. */
function PullAllButton({ list }: { list: { key: string; repo: string; number?: number; branch?: string; base: string }[] }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  if (list.length < 2) return null;
  const busy = !!s.busy;
  if (sure) return (
    <span className="axp-push-banner__group-act">
      <Button size="sm" tone="success" icon="check" disabled={busy} onClick={() => { setSure(false); void pullAll(list); }}>Pull main into all {list.length}?</Button>
      <Button size="sm" tone="quiet" onClick={() => setSure(false)}>Cancel</Button>
    </span>
  );
  return <span className="axp-push-banner__group-act"><Button size="sm" tone="neutral" icon="download" disabled={busy} title="Bring main's newer commits into every entry in this group" onClick={() => setSure(true)}>{s.busy === PULL_ALL ? 'Pulling…' : 'Pull all'}</Button></span>;
}

function Group({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="axp-push-banner__group" aria-label={title}>
      <div className="axp-push-banner__group-head">
        <h4 className="axp-push-banner__group-title">{title} <span>{count}</span></h4>
        {action}
      </div>
      <ul className="axp-push-banner__list">{children}</ul>
    </section>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PushBanner() {
  const rt = useRuntime();
  useAxfState();
  const s = useStore();
  // Launches expanded like the other banners; "_" folds it to its summary line.
  const [open, setOpen] = useBannerLaunchOpen();
  if (!bannerOn((k) => rt.settings.get(k))) return null;
  const finished = doneRows(s.answer);
  const gone = doneKeys(s.answer);
  // a finished entry shows only in Done (its trash can hides the open one until its next commit)
  const allPulls = pullRows(s.answer);
  const allRows = rows(s.answer);
  const headOf = (key: string) => allPulls.find((p) => p.key === key)?.sha ?? allRows.find((r) => r.key === key)?.sha;
  const pulls = allPulls.filter((p) => !gone.has(p.key));
  const ready = pulls.filter((p) => p.ready);
  const behindPulls = pulls.filter((p) => !p.ready && pullBehind(p));
  const waiting = pulls.filter((p) => !p.ready && !pullBehind(p));
  const allBare = allRows.filter((r) => !r.pr && !gone.has(r.key));
  const behindBare = allBare.filter((r) => needsPull(r.behind));
  const bare = allBare.filter((r) => !needsPull(r.behind));
  const behindCount = behindPulls.length + behindBare.length;
  if (!pulls.length && !allBare.length && !finished.length) return null;
  const repos = [...new Set([...pulls.map((p) => short(p.repo)), ...allBare.map((r) => short(r.repo)), ...finished.map((d) => short(d.repo))])];
  const headline = ready.length ? `${plural(ready.length, 'pull request', 'pull requests')} ready to merge`
    : pulls.length + allBare.length ? plural(pulls.length + allBare.length, 'change waiting for main', 'changes waiting for main')
    : `${plural(finished.length, 'change', 'changes')} done`;
  return (
    <div className={`axp-push-banner${ready.length ? ' is-ready' : ''}`} role="status" aria-live="polite">
      <div className="axp-push-banner__row">
        <span className="axp-push-banner__icon" aria-hidden><Icon name="branch" size={18} /></span>
        <button type="button" data-fx-row className="axp-push-banner__main" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-push-banner__top">
            <strong>{headline}</strong>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          <span className="axp-push-banner__lead">{[pulls.length ? plural(pulls.length, 'pull request', 'pull requests') : '', behindCount ? `${behindCount} need main pulled in` : '', allBare.length ? `${plural(allBare.length, 'branch', 'branches')} without a PR` : '', finished.length ? `${finished.length} done` : '', repos.join(' · ')].filter(Boolean).join(' · ')}</span>
        </button>
      </div>
      {open && (
        <div className="axp-push-banner__body">
          <Group title="Done" count={finished.length}>{finished.map((d) => <DoneItem key={d.key} d={d} sha={d.kind === 'pulled' ? headOf(d.key) : undefined} />)}</Group>
          <Group title="Ready to merge" count={ready.length}>{ready.map((p) => <PullItem key={p.key} p={p} />)}</Group>
          <Group title="Needs main pulled in" count={behindCount} action={<PullAllButton list={[
            ...behindPulls.map((p) => ({ key: p.key, repo: p.repo, number: p.number, base: p.base })),
            ...behindBare.map((r) => ({ key: r.key, repo: r.repo, branch: r.name, base: r.base })),
          ]} />}>
            {behindPulls.map((p) => <PullItem key={p.key} p={p} />)}
            {behindBare.map((r) => <BranchItem key={r.key} r={r} />)}
          </Group>
          <Group title="Pull requests" count={waiting.length}>{waiting.map((p) => <PullItem key={p.key} p={p} />)}</Group>
          <Group title="Branches without a pull request" count={bare.length}>{bare.map((r) => <BranchItem key={r.key} r={r} />)}</Group>
          <div className="axp-push-banner__foot">
            <Button size="sm" tone="quiet" icon="refresh" disabled={s.loading} onClick={() => void load(true)}>{s.loading ? 'Checking…' : 'Check now'}</Button>
            <Button size="sm" tone="quiet" icon="settings" onClick={() => rt.dispatch('settings.open:push-banner')}>Settings</Button>
            <Note k={PULL_ALL} />
            {s.error && <span className="axp-push-banner__note is-danger">{s.error}</span>}
            <button type="button" className="fx-iconbtn axp-push-banner__min" aria-label="Minimize" title="Minimize to one line" onClick={() => setOpen(false)}><Icon name="minimize" size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings → Plugins → Push banner: what it watches, hidden entries (show again), Check now. */
export function PushSettings() {
  const s = useStore();
  const all = rows(s.answer, true);
  const prs = pullRows(s.answer, true);
  const hidden = [...prs.filter((p) => p.hidden).map((p) => ({ key: p.key, repo: p.repo, name: `#${p.number} ${p.title}` })), ...all.filter((r) => r.hidden).map((r) => ({ key: r.key, repo: r.repo, name: r.name }))];
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every open pull request and every branch ahead of main in {s.answer?.repos.map((r) => r.repo).join(', ') || 'the watched repos'}. A branch reaches main only through its pull request: Open PR, then Merge once it is ready (CI passed, no conflicts, not a draft; the server checks again before merging). Needs GITHUB_TOKEN on the console server with Contents + Pull requests write on each repo.</p>
      {s.answer?.error && <p className="fx-small axp-push-banner__note is-danger">{s.answer.error}</p>}
      {s.answer?.repos.filter((r) => r.error).map((r) => <p key={r.repo} className="fx-small axp-push-banner__note is-danger">{r.repo}: {r.error}</p>)}
      <p className="fx-small">{prs.length} pull request(s), {prs.filter((p) => p.ready).length} ready · {all.filter((r) => !r.pr).length} branch(es) without one · {hidden.length} hidden{s.answer ? ` · checked ${ago(new Date(s.answer.checkedAt).toISOString())}` : ''}.</p>
      {hidden.length > 0 && (
        <ul className="axp-push-banner__list">
          {hidden.map((h) => (
            <li key={h.key} className="axp-push-banner__item">
              <span className="axp-push-banner__entry"><span className="axp-push-banner__line"><span className="axp-push-banner__chip">{short(h.repo)}</span><span className="axp-push-banner__name">{h.name}</span></span></span>
              <div className="axp-push-banner__acts"><Button size="sm" tone="neutral" icon="eye" onClick={() => void setHidden({ key: h.key }, false)}>Show</Button></div>
            </li>
          ))}
        </ul>
      )}
      <div className="fx-row"><Button icon="refresh" onClick={() => void load(true)}>{s.loading ? 'Checking…' : 'Check now'}</Button></div>
      <ClaudeSettings />
    </div>
  );
}

/** When a pull or merge fails: hand it to headless Claude Code on the VPS (off by default; every launch approved on axHub). */
function ClaudeSettings() {
  const s = useStore();
  const [err, setErr] = useState('');
  const c = s.claude;
  if (!c) return null;
  const save = (patch: Partial<Record<'claudeOnFail' | 'claudeShell', boolean>>) => { setErr(''); saveClaude(patch).catch((e: Error) => setErr(e.message)); };
  const recent = [...c.jobs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 8);
  return (
    <div className="fx-stack">
      <h4 className="axp-push-banner__group-title">When a pull or merge fails</h4>
      <Switch label="Hand failures to Mosses (Claude Code on the VPS)" checked={c.on} onChange={(v) => save({ claudeOnFail: v })}
        hint="A Pull main in that hits conflicts, or a Merge GitHub refuses (conflicts, failed CI), is handed to Mosses, who asks axHub to start headless Claude Code (Opus) on the VPS on that branch in AmberX-AXF, axHub or Build-Pilot. Nothing starts until you approve it on axHub. It shows in the building banner, pushes only to that branch and never merges. Conflicted entries also get a Fix with Claude button." />
      <Switch label="Let it run any shell command" checked={c.shell} disabled={!c.on} onChange={(v) => save({ claudeShell: v })}
        hint="Off: it can edit files and run git (fetch, merge, commit, push to that branch) only. On: any command on the VPS as root, still approved per launch." />
      {c.on && !c.hubToken && <p className="fx-small axp-push-banner__note is-danger">Needs the axHub token on the console (Keys needed → axHub connection).</p>}
      {c.on && c.mosses === false && <p className="fx-small axp-push-banner__note is-danger">{c.mossesWhy}</p>}
      {c.on && !c.changes && <p className="fx-small fx-muted">The Codebase changes plugin is off, so sessions won’t show in the building banner.</p>}
      {err && <p className="fx-small axp-push-banner__note is-danger">{err}</p>}
      {recent.length > 0 && (
        <ul className="axp-push-banner__list">
          {recent.map((j) => (
            <li key={j.key} className="axp-push-banner__item">
              <span className="axp-push-banner__entry"><span className="axp-push-banner__line"><span className="axp-push-banner__chip">{j.state}</span><span className="axp-push-banner__name">{j.key}</span></span><span className="fx-small fx-muted">{j.message}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

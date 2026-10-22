/** Push banner UI: the banner (open pull requests + branches not on main, grouped by what's ready) and the settings panel. Theme tokens only. */
import { useState, type ReactNode } from 'react';
import { Button, Icon, useAxfState, useRuntime } from '@console/axf/react';
import { ago, bannerOn, load, mergePr, openPr, pullRows, rows, setHidden, useStore, type PullRow, type Row } from './store';

const CI_WORD: Record<string, string> = { success: 'CI passed', failure: 'CI failed', running: 'CI running', none: 'no CI yet', unknown: 'CI unknown' };
const CI_ICON: Record<string, string> = { success: 'check-circle', failure: 'x-circle', running: 'refresh', none: 'clock', unknown: 'help' };
const short = (repo: string) => repo.split('/')[1] ?? repo;

function Note({ k }: { k: string }) {
  const s = useStore();
  return s.note?.key === k ? <span className={`axp-push-banner__note is-${s.note.tone}`} role="status">{s.note.text}</span> : null;
}

function HideButton({ k, label }: { k: string; label: string }) {
  const s = useStore();
  return <button type="button" className="fx-iconbtn" aria-label={`Hide ${label}`} title="Hide (every device)" disabled={s.busy === k} onClick={() => void setHidden({ key: k }, true)}><Icon name="x" size={14} /></button>;
}

/** An open pull request: why it is or isn't ready, and Merge (tap twice) when it is. */
function PullItem({ p }: { p: PullRow }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  const busy = s.busy === p.key;
  const why = p.ready ? 'Ready to merge' : p.draft ? 'Draft' : p.ci !== 'success' ? (CI_WORD[p.ci] ?? 'CI unknown') : p.mergeable === false ? 'Has conflicts' : 'GitHub is still checking it';
  return (
    <li className={`axp-push-banner__item is-ci-${p.ci}${p.ready ? ' is-ready' : ''}`}>
      <div className="axp-push-banner__entry">
        <span className="axp-push-banner__line">
          <span className="axp-push-banner__chip" title={p.repo}>{short(p.repo)}</span>
          <a className="axp-push-banner__name is-title" href={p.url} target="_blank" rel="noopener noreferrer" title="Open on GitHub">#{p.number} {p.title}</a>
        </span>
        <span className="axp-push-banner__line axp-push-banner__meta">
          <span className={`axp-push-banner__pill is-${p.ready ? 'ready' : p.ci}`}><Icon name={p.ready ? 'check-circle' : CI_ICON[p.ci] ?? 'help'} size={11} />{why}</span>
          <span className="axp-push-banner__ref">{p.head} → {p.base}</span>
          {p.ahead != null && <span>{p.ahead} ahead{p.behind ? ` · ${p.behind} behind` : ''}</span>}
          {p.fork && <span>from a fork{p.author ? ` (${p.author})` : ''}</span>}
          {p.updated && <span>{ago(p.updated)}</span>}
        </span>
        <Note k={p.key} />
      </div>
      <div className="axp-push-banner__acts">
        {!sure && <button type="button" className="axp-push-banner__act is-primary" disabled={busy || !p.ready} title={p.ready ? `Merge #${p.number} into ${p.base}` : `Merges once it's ready (${why.toLowerCase()})`} onClick={() => setSure(true)}><Icon name="branch" size={11} />Merge</button>}
        {sure && <button type="button" className="axp-push-banner__act is-primary" disabled={busy} onClick={() => { setSure(false); void mergePr({ key: p.key, repo: p.repo, number: p.number, base: p.base }); }}><Icon name="check" size={11} />Merge #{p.number} into {p.base}?</button>}
        {sure && <button type="button" className="axp-push-banner__act is-quiet" onClick={() => setSure(false)}>Cancel</button>}
        {!sure && <HideButton k={p.key} label={`pull request #${p.number}`} />}
      </div>
    </li>
  );
}

/** A branch ahead of main with no pull request yet: Open PR. */
function BranchItem({ r }: { r: Row }) {
  const s = useStore();
  const busy = s.busy === r.key;
  return (
    <li className="axp-push-banner__item">
      <div className="axp-push-banner__entry">
        <span className="axp-push-banner__line">
          <span className="axp-push-banner__chip" title={r.repo}>{short(r.repo)}</span>
          <a className="axp-push-banner__name" href={r.url} target="_blank" rel="noopener noreferrer" title={`Compare ${r.name} with ${r.base} on GitHub`}>{r.name}</a>
        </span>
        <span className="axp-push-banner__line axp-push-banner__meta">
          {r.ahead == null ? <span className="is-danger">couldn’t compare{r.error ? `: ${r.error}` : ''}</span> : <span>{r.ahead} ahead{r.behind ? ` · ${r.behind} behind` : ''}</span>}
          {r.date && <span>{ago(r.date)}</span>}
        </span>
        {r.subject && <span className="axp-push-banner__sub">{r.subject}</span>}
        <Note k={r.key} />
      </div>
      <div className="axp-push-banner__acts">
        <button type="button" className="axp-push-banner__act" disabled={busy || r.ahead == null} onClick={() => void openPr(r)}><Icon name="upload" size={11} />Open PR</button>
        <HideButton k={r.key} label={r.name} />
      </div>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="axp-push-banner__group" aria-label={title}>
      <h4 className="axp-push-banner__group-title">{title} <span>{count}</span></h4>
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
  const [open, setOpen] = useState(true);
  if (!bannerOn((k) => rt.settings.get(k))) return null;
  const pulls = pullRows(s.answer);
  const ready = pulls.filter((p) => p.ready);
  const waiting = pulls.filter((p) => !p.ready);
  const bare = rows(s.answer).filter((r) => !r.pr);
  if (!pulls.length && !bare.length) return null;
  const repos = [...new Set([...pulls.map((p) => short(p.repo)), ...bare.map((r) => short(r.repo))])];
  return (
    <div className={`axp-push-banner${ready.length ? ' is-ready' : ''}`} role="status" aria-live="polite">
      <div className="axp-push-banner__row">
        <span className="axp-push-banner__icon" aria-hidden><Icon name="branch" size={18} /></span>
        <button type="button" className="axp-push-banner__main" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-push-banner__top">
            <strong>{ready.length ? `${plural(ready.length, 'pull request', 'pull requests')} ready to merge` : plural(pulls.length + bare.length, 'change waiting for main', 'changes waiting for main')}</strong>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          <span className="axp-push-banner__lead">{[pulls.length ? plural(pulls.length, 'pull request', 'pull requests') : '', bare.length ? `${plural(bare.length, 'branch', 'branches')} without a PR` : '', repos.join(' · ')].filter(Boolean).join(' · ')}</span>
        </button>
      </div>
      {open && (
        <div className="axp-push-banner__body">
          <Group title="Ready to merge" count={ready.length}>{ready.map((p) => <PullItem key={p.key} p={p} />)}</Group>
          <Group title="Pull requests" count={waiting.length}>{waiting.map((p) => <PullItem key={p.key} p={p} />)}</Group>
          <Group title="Branches without a pull request" count={bare.length}>{bare.map((r) => <BranchItem key={r.key} r={r} />)}</Group>
          <div className="axp-push-banner__foot">
            <button type="button" className="axp-push-banner__act is-quiet" disabled={s.loading} onClick={() => void load(true)}><Icon name="refresh" size={11} />{s.loading ? 'Checking…' : 'Check now'}</button>
            <button type="button" className="axp-push-banner__act is-quiet" onClick={() => rt.dispatch('settings.open:push-banner')}><Icon name="settings" size={11} />Settings</button>
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
              <div className="axp-push-banner__acts"><button type="button" className="axp-push-banner__act" onClick={() => void setHidden({ key: h.key }, false)}><Icon name="eye" size={11} />Show</button></div>
            </li>
          ))}
        </ul>
      )}
      <div className="fx-row"><Button icon="refresh" onClick={() => void load(true)}>{s.loading ? 'Checking…' : 'Check now'}</Button></div>
    </div>
  );
}

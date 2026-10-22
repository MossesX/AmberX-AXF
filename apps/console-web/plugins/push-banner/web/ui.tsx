/** Push banner UI: the banner (every branch not on main, Open PR / Merge / Hide) and the settings panel. Theme tokens only. */
import { useState } from 'react';
import { Button, Icon, useAxfState, useRuntime } from '@console/axf/react';
import { ago, bannerOn, load, mergePr, openPr, rows, setHidden, useStore, type Row } from './store';

const CI_WORD: Record<string, string> = { success: 'CI passed', failure: 'CI failed', running: 'CI running', none: 'no CI yet', unknown: 'CI unknown' };
const CI_ICON: Record<string, string> = { success: 'check-circle', failure: 'x-circle', running: 'refresh', none: 'clock', unknown: 'help' };
const short = (repo: string) => repo.split('/')[1] ?? repo;

function RowItem({ r }: { r: Row }) {
  const s = useStore();
  const [sure, setSure] = useState(false);
  const busy = s.busy === r.key;
  const ci = r.pr?.ci ?? 'none';
  const canMerge = !!r.pr?.number && !r.pr.draft && ci === 'success';
  return (
    <li className={`axp-push-banner__item${r.pr ? ` is-ci-${ci}` : ''}`}>
      <div className="axp-push-banner__entry">
        <span className="axp-push-banner__line">
          <span className="axp-push-banner__chip" title={r.repo}>{short(r.repo)}</span>
          <a className="axp-push-banner__name" href={r.url} target="_blank" rel="noopener noreferrer" title={`Compare ${r.name} with ${r.base} on GitHub`}>{r.name}</a>
        </span>
        <span className="axp-push-banner__line axp-push-banner__meta">
          {r.ahead == null ? <span className="is-danger">couldn’t compare{r.error ? `: ${r.error}` : ''}</span> : <span>{r.ahead} ahead{r.behind ? ` · ${r.behind} behind` : ''}</span>}
          {r.date && <span>{ago(r.date)}</span>}
          {r.pr ? (
            <a className={`axp-push-banner__ci is-${ci}`} href={r.pr.url} target="_blank" rel="noopener noreferrer"><Icon name={CI_ICON[ci] ?? 'help'} size={11} />PR #{r.pr.number}{r.pr.draft ? ' (draft)' : ''} · {CI_WORD[ci]}</a>
          ) : <span>no PR</span>}
        </span>
        {r.subject && <span className="axp-push-banner__sub">{r.subject}</span>}
        {s.note?.key === r.key && <span className={`axp-push-banner__note is-${s.note.tone}`} role="status">{s.note.text}</span>}
      </div>
      <div className="axp-push-banner__acts">
        {!r.pr && <button type="button" className="axp-push-banner__act" disabled={busy || r.ahead == null} onClick={() => void openPr(r)}><Icon name="upload" size={11} />Open PR</button>}
        {r.pr && !sure && <button type="button" className="axp-push-banner__act is-primary" disabled={busy || !canMerge} title={canMerge ? `Merge PR #${r.pr.number} into ${r.base}` : `Merges once ${r.pr.draft ? 'it is out of draft and ' : ''}CI has passed`} onClick={() => setSure(true)}><Icon name="branch" size={11} />Merge</button>}
        {r.pr && sure && <button type="button" className="axp-push-banner__act is-primary" disabled={busy} onClick={() => { setSure(false); void mergePr(r); }}><Icon name="check" size={11} />Merge #{r.pr.number} into {r.base}?</button>}
        {sure && <button type="button" className="axp-push-banner__act is-quiet" onClick={() => setSure(false)}>Cancel</button>}
        {!sure && <button type="button" className="fx-iconbtn" aria-label={`Hide ${r.name}`} title="Hide this branch (every device)" disabled={busy} onClick={() => void setHidden(r, true)}><Icon name="x" size={14} /></button>}
      </div>
    </li>
  );
}

export function PushBanner() {
  const rt = useRuntime();
  useAxfState();
  const s = useStore();
  // Launches expanded like the other banners; "_" folds it to its summary line.
  const [open, setOpen] = useState(true);
  if (!bannerOn((k) => rt.settings.get(k))) return null;
  const list = rows(s.answer);
  if (!list.length) return null;
  const repos = [...new Set(list.map((r) => short(r.repo)))];
  const green = list.filter((r) => r.pr?.ci === 'success' && !r.pr.draft).length;
  return (
    <div className="axp-push-banner" role="status" aria-live="polite">
      <div className="axp-push-banner__row">
        <span className="axp-push-banner__icon" aria-hidden><Icon name="branch" size={18} /></span>
        <button type="button" className="axp-push-banner__main" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-push-banner__top">
            <strong>{list.length} branch{list.length === 1 ? '' : 'es'} not on main</strong>
            {green > 0 && <span className="axp-push-banner__count">{green} ready to merge</span>}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          <span className="axp-push-banner__lead">{repos.join(' · ')}</span>
        </button>
      </div>
      {open && (
        <div className="axp-push-banner__body">
          <ul className="axp-push-banner__list">{list.map((r) => <RowItem key={r.key} r={r} />)}</ul>
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

/** Settings → Plugins → Push banner: what it watches, hidden branches (show again), Check now. */
export function PushSettings() {
  const s = useStore();
  const all = rows(s.answer, true);
  const hidden = all.filter((r) => r.hidden);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every branch ahead of main in {s.answer?.repos.map((r) => r.repo).join(', ') || 'the watched repos'}. A branch reaches main only through its PR: Open PR, then Merge once CI has passed (the server checks again before merging). Needs GITHUB_TOKEN on the console server with Contents + Pull requests write on each repo.</p>
      {s.answer?.error && <p className="fx-small axp-push-banner__note is-danger">{s.answer.error}</p>}
      {s.answer?.repos.filter((r) => r.error).map((r) => <p key={r.repo} className="fx-small axp-push-banner__note is-danger">{r.repo}: {r.error}</p>)}
      <p className="fx-small">{all.length} branch(es) not on main, {hidden.length} hidden{s.answer ? ` · checked ${ago(new Date(s.answer.checkedAt).toISOString())}` : ''}.</p>
      {hidden.length > 0 && (
        <ul className="axp-push-banner__list">
          {hidden.map((r) => (
            <li key={r.key} className="axp-push-banner__item">
              <span className="axp-push-banner__entry"><span className="axp-push-banner__line"><span className="axp-push-banner__chip">{short(r.repo)}</span><span className="axp-push-banner__name">{r.name}</span></span></span>
              <div className="axp-push-banner__acts"><button type="button" className="axp-push-banner__act" onClick={() => void setHidden(r, false)}><Icon name="eye" size={11} />Show</button></div>
            </li>
          ))}
        </ul>
      )}
      <div className="fx-row"><Button icon="refresh" onClick={() => void load(true)}>{s.loading ? 'Checking…' : 'Check now'}</Button></div>
    </div>
  );
}

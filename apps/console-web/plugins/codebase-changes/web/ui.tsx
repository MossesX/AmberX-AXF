/* Codebase changes — the banner, the log browser and the settings summary. Theme tokens only (codebase-changes.css). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, useBannerLaunchOpen, useRuntime, BannerIcon } from '@console/axf/react';
import {
  CHANGED, KIND_ICON, NO_FILTERS, STATE_ICON, STATE_LABEL, VIEW, abandonEntry, ago, api, bannerOn, closeAll, closeEntry, isActive, quietMs, startedMs, stuckWhy, kindLabel, linkHref, loadEntry, loadOpen,
  loadPage, reopenEntry, takeFocus, took, useStore, when, type Entry, type Filters, type Page, type Step, type Summary,
} from './store';

/* ---------------- small pieces ---------------- */

function KindBadge({ kind }: { kind: string }) {
  return <span className={`axp-codebase-changes__kind is-${kind}`}><Icon name={KIND_ICON[kind] ?? 'code'} size={11} />{kindLabel(kind)}</span>;
}
function StateBadge({ state }: { state: string }) {
  return <span className={`axp-codebase-changes__state is-${state}`} title={STATE_LABEL[state] ?? state}><Icon name={STATE_ICON[state] ?? 'info'} size={11} />{STATE_LABEL[state] ?? state}</span>;
}
function StepsCount({ s }: { s: Summary['steps'] }) {
  if (!s.total) return <span className="axp-codebase-changes__meta">no steps yet</span>;
  return <span className="axp-codebase-changes__meta" title={s.running ? `Now: ${s.running}` : ''}>{s.done}/{s.total} steps{s.failed ? ` · ${s.failed} failed` : ''}</span>;
}

/* ---------------- the banner ---------------- */

const clockText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
};
function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, [on]);
  return now;
}

/** A running timer on an active or stuck entry: time since it started, and how long it's been quiet when stuck. */
function Timer({ e, now }: { e: Summary; now: number }) {
  const st = startedMs(e);
  const why = stuckWhy(e, now);
  if (st == null) return null;
  return (
    <span className={`axp-codebase-changes__timer${why ? ' is-stuck' : ''}`} title={why === 'no-word' ? 'No word from its session for over 10 minutes' : why === 'long' ? 'Running for 30 minutes or more' : 'Running for'}>
      <Icon name={why ? 'alert' : 'clock'} size={11} />{clockText(now - st)}{why === 'no-word' ? ` · no word ${clockText(quietMs(e, now))}` : ''}
    </span>
  );
}

export function ChangesBanner() {
  const s = useStore();
  const rt = useRuntime();
  // Launches expanded; the "_" under the entries' ✕ column folds it back to its summary (Brett, Oct 21 2026).
  const [open, setOpen] = useBannerLaunchOpen();
  const now = useTick(s.open.some(isActive));
  if (!bannerOn() || !s.open.length) return null;
  const n = s.openTotal;
  const running = s.open.filter((e) => e.state === 'running').length;
  const failed = s.open.filter((e) => e.state === 'failed').length;
  const go = (id: string) => rt.dispatch(`codebase-changes.open:${encodeURIComponent(id)}`);
  return (
    <div className={`axp-codebase-changes-banner${failed ? ' is-failed' : ''}`} role="status" aria-live="polite">
      <div className="axp-codebase-changes-banner__row">
        <BannerIcon className="axp-codebase-changes-banner__icon" icon="branch" working={running > 0 || !!s.busy} />
        <button type="button" data-fx-row className="axp-codebase-changes-banner__main" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-codebase-changes-banner__top">
            <strong>{n} codebase change{n === 1 ? '' : 's'}</strong>
            {running > 0 && <span className="axp-codebase-changes__meta">{running} in progress</span>}
            {failed > 0 && <span className="axp-codebase-changes__meta is-danger">{failed} failed</span>}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          <span className="axp-codebase-changes-banner__lead">{s.open.slice(0, 2).map((e) => e.title).join(' · ')}{n > 2 ? ` +${n - 2} more` : ''}</span>
        </button>
      </div>
      {open && (
        <div className="axp-codebase-changes-banner__body">
          <ul className="axp-codebase-changes-banner__list">
            {s.open.map((e) => (
              <li key={e.id} className={`axp-codebase-changes-banner__item is-${e.state}`}>
                <button type="button" data-fx-row className="axp-codebase-changes-banner__entry" onClick={() => go(e.id)} title="Open in the log">
                  <span className="axp-codebase-changes-banner__line">
                    <KindBadge kind={e.kind} />
                    <span className="axp-codebase-changes-banner__title">{e.title}</span>
                  </span>
                  <span className="axp-codebase-changes-banner__line">
                    <StateBadge state={e.state} />
                    {isActive(e) ? <Timer e={e} now={now} /> : <span className="axp-codebase-changes__meta">{ago(e.updatedAt)}</span>}
                    <StepsCount s={e.steps} />
                  </span>
                  {(e.result?.summary || e.steps.running) && <span className="axp-codebase-changes-banner__sub">{e.result?.summary || `Now: ${e.steps.running}`}</span>}
                </button>
                {stuckWhy(e, now) && <button type="button" className="fx-iconbtn axp-codebase-changes__trash" aria-label={`Remove stuck "${e.title}"`} title="Stuck: mark it failed (stalled) and take it off the banners on every device; it stays in the log" disabled={s.busy === e.id} onClick={() => void abandonEntry(e.id)}><Icon name="trash" size={16} /></button>}
                <button type="button" className="fx-iconbtn" aria-label={`Close "${e.title}" everywhere`} title="Close (gone on every device; stays in the log)" disabled={s.busy === e.id} onClick={() => void closeEntry(e.id)}><Icon name="x" size={16} /></button>
              </li>
            ))}
          </ul>
          <div className="axp-codebase-changes-banner__foot">
            <Button size="sm" tone="neutral" icon="list" onClick={() => rt.dispatch('codebase-changes.open')}>Open the log</Button>
            <Button size="sm" tone="quiet" icon="x" disabled={s.busy === '*'} onClick={() => void closeAll()}>Close all</Button>
            {n > s.open.length && <span className="axp-codebase-changes__meta">showing the newest {s.open.length}</span>}
            <button type="button" className="fx-iconbtn axp-codebase-changes-banner__min" aria-label="Minimize" title="Minimize to one line" onClick={() => setOpen(false)}><Icon name="minimize" size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- the log browser ---------------- */

function StepsTimeline({ steps }: { steps: Step[] }) {
  if (!steps.length) return <p className="fx-small fx-muted axp-codebase-changes__none">No steps recorded.</p>;
  return (
    <ol className="axp-codebase-changes__steps">
      {steps.map((s, i) => (
        <li key={`${i}-${s.text.slice(0, 16)}`} className={`is-${s.state}`}>
          <span className={`axp-codebase-changes__dot is-${s.state}`} aria-label={STATE_LABEL[s.state]} title={STATE_LABEL[s.state]}><Icon name={STATE_ICON[s.state] ?? 'info'} size={12} /></span>
          <span className="axp-codebase-changes__step">
            <span>{s.text}</span>
            <span className="axp-codebase-changes__meta">{STATE_LABEL[s.state]}{s.startedAt ? ` · ${when(s.startedAt)}` : ''}{s.finishedAt && s.startedAt ? ` · took ${took(s.startedAt, s.finishedAt)}` : ''}</span>
            {s.note && <span className="axp-codebase-changes__note">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EntryDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const rt = useRuntime();
  const [e, setE] = useState<Entry | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { loadEntry(id).then((x) => { setE(x); setErr(''); }, (x: Error) => setErr(x.message)); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (err) return <p className="fx-small axp-codebase-changes__err">Couldn’t load it: {err}</p>;
  if (!e) return <p className="fx-small fx-muted axp-codebase-changes__none">Loading…</p>;
  const r = e.result;
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); load(); onChanged(); } catch (x) { rt.toast((x as Error).message, 'warning'); } finally { setBusy(false); } };
  return (
    <div className="axp-codebase-changes__detail">
      {e.asked && <blockquote className="axp-codebase-changes__asked">{e.asked}</blockquote>}
      <dl className="axp-codebase-changes__facts">
        <dt>Opened</dt><dd>{when(e.createdAt)}</dd>
        <dt>Updated</dt><dd>{when(e.updatedAt)} ({ago(e.updatedAt)})</dd>
        {e.repos.length > 0 && <><dt>Repo</dt><dd>{e.repos.join(', ')}</dd></>}
        {e.model && <><dt>Model</dt><dd>{e.model}</dd></>}
        {(e.who.where || e.who.host) && <><dt>Where</dt><dd>{[e.who.where, e.who.host, e.who.user].filter(Boolean).join(' · ')}{e.who.session ? ` · session ${e.who.session}` : ''}</dd></>}
        <dt>Banner</dt><dd>{e.closed ? `closed ${when(e.closed.at)} by ${e.closed.by}` : 'showing'}</dd>
        <dt>Id</dt><dd><code>{e.id}</code></dd>
      </dl>
      <h4 className="axp-codebase-changes__h">Steps</h4>
      <StepsTimeline steps={e.steps} />
      <h4 className="axp-codebase-changes__h">Result</h4>
      {!r ? <p className="fx-small fx-muted axp-codebase-changes__none">No result yet{e.state === 'running' ? ': still in progress.' : '.'}</p> : (
        <div className="axp-codebase-changes__result">
          <div className="axp-codebase-changes__line"><StateBadge state={r.state} />{r.branch && <span className="axp-codebase-changes__meta"><Icon name="branch" size={11} /> {r.branch}</span>}{r.filesChanged != null && <span className="axp-codebase-changes__meta">{r.filesChanged} file{r.filesChanged === 1 ? '' : 's'} changed</span>}</div>
          {r.summary && <p className="axp-codebase-changes__text">{r.summary}</p>}
          {r.commits?.length ? (
            <ul className="axp-codebase-changes__commits">
              {r.commits.map((c) => <li key={c.sha}>{e.repos[0] ? <a href={`https://github.com/${e.repos[0]}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer"><code>{c.sha.slice(0, 7)}</code></a> : <code>{c.sha.slice(0, 7)}</code>}{c.message ? ` ${c.message}` : ''}</li>)}
            </ul>
          ) : null}
          {r.tests && Object.keys(r.tests).length > 0 && (
            <table className="axp-codebase-changes__tests">
              <thead><tr><th>Test</th><th>Before</th><th>After</th></tr></thead>
              <tbody>{Object.entries(r.tests).map(([name, t]) => <tr key={name} className={t.state ? `is-${t.state}` : ''}><td>{name}</td><td>{t.before ?? '—'}</td><td>{t.after ?? (t.state ?? '—')}</td></tr>)}</tbody>
            </table>
          )}
          {r.links && Object.keys(r.links).length > 0 && (
            <div className="axp-codebase-changes__line">
              {Object.entries(r.links).map(([name, v]) => { const href = linkHref(v, e.repos); return href ? <a key={name} className="fx-btn fx-btn--neutral fx-btn--sm axp-codebase-changes__act" href={href} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />{name}</a> : <span key={name} className="axp-codebase-changes__meta">{name}: {v}</span>; })}
            </div>
          )}
        </div>
      )}
      <div className="axp-codebase-changes__line">
        {e.closed
          ? <Button tone="neutral" icon="undo" disabled={busy} onClick={() => void act(() => reopenEntry(e.id))}>Show in the banner again</Button>
          : <Button tone="neutral" icon="x" disabled={busy} onClick={() => void act(() => closeEntry(e.id))}>Close (everywhere)</Button>}
        <Button tone="neutral" icon="copy" onClick={() => { void navigator.clipboard?.writeText(e.id).then(() => rt.toast('Id copied', 'info'), () => undefined); }}>Copy id</Button>
      </div>
    </div>
  );
}

function Row({ s, open, onToggle, onChanged }: { s: Summary; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [open]);
  return (
    <li ref={ref} className={`axp-codebase-changes__row is-${s.state}${s.closed ? ' is-closed' : ''}`} data-axf-anchor={`codebase-changes:${s.id}`}>
      <button type="button" data-fx-row className="axp-codebase-changes__head" aria-expanded={open} onClick={onToggle}>
        <span className="axp-codebase-changes__line">
          <KindBadge kind={s.kind} />
          <span className="axp-codebase-changes__title">{s.title}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
        <span className="axp-codebase-changes__line">
          <StateBadge state={s.state} />
          <span className="axp-codebase-changes__meta">{when(s.createdAt)}</span>
          <StepsCount s={s.steps} />
          {s.repos[0] && <span className="axp-codebase-changes__meta">{s.repos[0]}</span>}
          {!s.closed && <span className="axp-codebase-changes__meta is-accent" title="Showing in the banner"><Icon name="bell" size={11} /> in banner</span>}
        </span>
        {!open && s.result?.summary && <span className="axp-codebase-changes__sub">{s.result.summary}</span>}
      </button>
      {open && <EntryDetail id={s.id} onChanged={onChanged} />}
    </li>
  );
}

export function ChangesView() {
  const s = useStore();
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<Summary[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string>('');
  const fRef = useRef(f);
  fRef.current = f;

  const reload = useCallback(async (filters: Filters) => {
    setLoading(true);
    try { const p = await loadPage(filters); setPage(p); setItems(p.items); setErr(''); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  const more = async () => {
    if (!page?.nextCursor) return;
    setLoading(true);
    try { const p = await loadPage(fRef.current, page.nextCursor); setPage(p); setItems((x) => [...x, ...p.items]); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(() => void reload(f), 250); return () => clearTimeout(t); }, [f, reload]);
  useEffect(() => { const on = () => void reload(fRef.current); globalThis.addEventListener(CHANGED, on); return () => globalThis.removeEventListener(CHANGED, on); }, [reload]);
  // Opened with an id (banner, search, action): show that entry, even when the filters would hide it.
  useEffect(() => {
    const id = takeFocus();
    if (!id) return;
    setExpanded(id);
    if (!items.some((i) => i.id === id)) void loadEntry(id).then((e) => setItems((x) => (x.some((i) => i.id === id) ? x : [{ id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt, kind: e.kind, title: e.title, asked: e.asked, state: e.state, repos: e.repos, model: e.model, where: e.who.where ?? '', steps: { total: e.steps.length, done: e.steps.filter((x2) => x2.state === 'done').length, failed: e.steps.filter((x2) => x2.state === 'failed').length, running: e.steps.find((x2) => x2.state === 'running')?.text ?? '' }, result: e.result ? { state: e.result.state, summary: e.result.summary } : null, closed: e.closed?.at ?? null }, ...x])), () => undefined);
  }, [s.focus, items]);

  const c = page?.counts;
  const kinds = [...new Set(['build', 'edit', 'remove', 'fix', 'other', ...Object.keys(c?.byKind ?? {})])];
  const up = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }));
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  return (
    <div className="axp-codebase-changes">
      <header className="axp-codebase-changes__intro">
        <h2 className="axp-codebase-changes__h1"><Icon name="branch" size={20} /> Codebase changes</h2>
        <p className="fx-small fx-muted">Every request to build, edit, remove or fix something, with its steps and result. Kept on axHub; closing an entry only takes it out of the banner.</p>
        {c && <p className="fx-small axp-codebase-changes__counts"><strong>{c.total}</strong> in the log · <strong>{c.open}</strong> in the banner{Object.entries(c.byState).map(([k, v]) => ` · ${v} ${(STATE_LABEL[k] ?? k).toLowerCase()}`).join('')}</p>}
      </header>
      <div className="axp-codebase-changes__filters" role="search">
        <input className="fx-input" type="search" placeholder="Search titles, requests, results…" aria-label="Search the log" value={f.q} onChange={(e) => up({ q: e.target.value })} />
        <select className="fx-input" aria-label="Kind" value={f.kind} onChange={(e) => up({ kind: e.target.value })}><option value="">Every kind</option>{kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}{c?.byKind[k] ? ` (${c.byKind[k]})` : ''}</option>)}</select>
        <select className="fx-input" aria-label="State" value={f.state} onChange={(e) => up({ state: e.target.value })}><option value="">Every state</option>{['running', 'done', 'partial', 'failed', 'cancelled'].map((k) => <option key={k} value={k}>{STATE_LABEL[k]}</option>)}</select>
        <select className="fx-input" aria-label="Banner" value={f.open} onChange={(e) => up({ open: e.target.value as Filters['open'] })}><option value="">Open and closed</option><option value="open">In the banner</option><option value="closed">Closed</option></select>
        <input className="fx-input" placeholder="Repo (owner/name)" aria-label="Repo" value={f.repo} onChange={(e) => up({ repo: e.target.value })} />
        <label className="axp-codebase-changes__date"><span className="fx-small fx-muted">From</span><input className="fx-input" type="date" value={f.from} onChange={(e) => up({ from: e.target.value })} /></label>
        <label className="axp-codebase-changes__date"><span className="fx-small fx-muted">To</span><input className="fx-input" type="date" value={f.to} onChange={(e) => up({ to: e.target.value })} /></label>
        {filtered && <Button size="sm" tone="quiet" icon="x" onClick={() => setF(NO_FILTERS)}>Clear</Button>}
      </div>
      {err && <p className="fx-small axp-codebase-changes__err">{err}</p>}
      {!err && page && !items.length && <p className="fx-small fx-muted axp-codebase-changes__none">{filtered ? 'Nothing matches these filters.' : 'No changes recorded yet. Once the Claude Code hook is installed (Settings → Plugins → Codebase changes), every request to build, edit, remove or fix something shows up here.'}</p>}
      <ul className="axp-codebase-changes__list">
        {items.map((i) => <Row key={i.id} s={i} open={expanded === i.id} onToggle={() => setExpanded(expanded === i.id ? '' : i.id)} onChanged={() => void reload(fRef.current)} />)}
      </ul>
      <div className="axp-codebase-changes__line">
        {page?.nextCursor && <Button tone="neutral" icon="chevron-down" disabled={loading} onClick={() => void more()}>Load more ({page.total - items.length} left)</Button>}
        {loading && <span className="axp-codebase-changes__meta">Loading…</span>}
        {page && !page.nextCursor && items.length > 0 && <span className="axp-codebase-changes__meta">{items.length} of {page.total}</span>}
      </div>
    </div>
  );
}

/* ---------------- settings ---------------- */

interface Where { where: 'hub' | 'repo' | 'env'; path: string; hubPath: string; exists: boolean; shared: boolean }

export function SettingsSummary() {
  const s = useStore();
  const [w, setW] = useState<Where | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void loadOpen(); api.call<Where>('where').then(setW, (e: Error) => setErr(e.message)); }, []);
  const script = '/opt/axf/apps/console-web/plugins/codebase-changes/changes.mjs';
  const here = w?.where === 'hub' ? 'on axHub (the shared data folder)' : w?.where === 'env' ? 'in the folder AXF_CHANGES_DIR names' : 'in this clone\'s changes/ folder (no hub volume here)';
  return (
    <div className="fx-stack">
      <p className="axp-codebase-changes__p">Every time Claude is asked to build, edit, remove or fix something, an entry is opened with what was asked; Claude fills in its steps and the result. Open entries show in the <strong>Codebase changes</strong> banner on every load until you close them (closing clears them on every device). The full log stays under Builds → Codebase changes.</p>
      <p className="fx-small axp-codebase-changes__p"><strong>{s.loaded ? `${s.openTotal} in the banner now.` : s.error ? `Couldn’t check: ${s.error}` : 'Checking…'}</strong></p>
      <h4 className="axp-codebase-changes__h">Where the log lives</h4>
      {err ? <p className="fx-small axp-codebase-changes__err">{err}</p> : !w ? <p className="fx-small fx-muted axp-codebase-changes__p">Checking…</p> : (
        <p className="fx-small axp-codebase-changes__p">Kept {here}: <code>{w.path}</code>{w.where === 'hub' ? '' : <>; the main copy is <code>{w.hubPath}</code> on axHub</>}. One file per entry, never deleted by uninstalling the plugin.</p>
      )}
      <h4 className="axp-codebase-changes__h">Claude Code hook (once per machine)</h4>
      <p className="fx-small axp-codebase-changes__p">Run this on the VPS (and any other machine where Claude Code works on these repos), so every request opens an entry by itself:</p>
      <pre className="axp-codebase-changes__cmd">node {script} hooks install</pre>
      <p className="fx-small fx-muted axp-codebase-changes__p">Check with <code>hooks status</code>, remove with <code>hooks remove</code>. On a machine without the hub folder, set <code>AXF_TOKEN</code> (the console token) so entries go through the console; otherwise they wait in <code>~/.axf-changes/queue</code> until <code>flush</code> can send them.</p>
      <p className="fx-small fx-muted axp-codebase-changes__p">Recording by hand: <code>node {script} open "Title" --kind build --step "first step"</code>, then <code>step last "first step" --state done</code> and <code>result last --state done --summary "…" --commit &lt;sha&gt;</code>.</p>
    </div>
  );
}

export { VIEW };

/** Pull requests tab: every open PR with status, checks, behind main, conflicts, linked build; expandable rows, filters, sort, selection. */
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Icon, IconButton, Note, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { api, ago, checksTone, FILTERS, prPath, prStatus, setSelected, short, SORTS, useSelected, type Check, type Commit, type Filter, type Pr, type PrList, type Sort } from './core';
import { PrActions } from './actions';

const FILTER_LABEL: Record<Filter, string> = { all: 'All', ready: 'Ready', failing: 'Failing', conflicts: 'Conflicts', behind: 'Behind main', stale: 'Stale', drafts: 'Drafts', mine: 'Mine' };
const SORT_LABEL: Record<Sort, string> = { updated: 'Last updated', oldest: 'Oldest first', number: 'Number', behind: 'Most behind main' };

export interface PrsProps { repo: string; filter: Filter; setFilter: (f: Filter) => void; open: number | null; setOpen: (n: number | null) => void; version: number; reload: () => void }

export function PrsTab({ repo, filter, setFilter, open, setOpen, version, reload }: PrsProps) {
  const rt = useRuntime();
  const [sort, setSort] = useState<Sort>('updated');
  const [q, setQ] = useState('');
  const [data, setData] = useState<PrList | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = useSelected();

  const load = async (refresh = false) => {
    if (!repo) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ repo, filter, sort, q, ...(refresh ? { refresh: 'true' } : {}) });
      setData(await api.call<PrList>(`prs?${qs}`)); setErr('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [repo, filter, sort, q, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) document.querySelector(`[data-gh-pr="${open}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, data]);

  const items = data?.items ?? [];
  const allOn = items.length > 0 && items.every((p) => selected.includes(p.number));
  const someOn = items.some((p) => selected.includes(p.number));
  const toggle = (n: number) => setSelected(selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n]);
  const filters = useMemo(() => FILTERS.map((f) => ({ value: f, label: <>{FILTER_LABEL[f]}{data?.counts?.[f] ? <span className="axp-github-client__count">{data.counts[f]}</span> : null}</> })), [data]);

  return (
    <div className="axp-github-client__tab" data-help="github-client.prs">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Pull requests">
        <Segmented size="sm" label="Filter" value={filter} options={filters} onChange={(f) => setFilter(f)} className="axp-github-client__filters" />
        <SelectField label="Sort" value={sort} options={SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))} onChange={(v) => setSort(v as Sort)} className="axp-github-client__sort" />
        <TextField label="Search" value={q} onChange={setQ} placeholder="PR number, title, branch, author, build" className="axp-github-client__search" />
        <IconButton icon="refresh" label="Refresh from GitHub" onClick={() => void load(true)} disabled={busy} data-help="github-client.refresh" />
      </div>
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Selection">
        <Checkbox label={selected.length ? `${selected.length} selected` : 'Select all'} checked={allOn} indeterminate={someOn && !allOn}
          onChange={(on) => setSelected(on ? [...new Set([...selected, ...items.map((p) => p.number)])] : selected.filter((n) => !items.some((p) => p.number === n)))} />
        <Button size="sm" icon="layers" disabled={selected.length < 2} onClick={() => rt.openDialog('github-client.batch', { repo, prs: selected })} data-help="github-client.batch">Batch merge…</Button>
        <Button size="sm" icon="list" onClick={() => rt.openDialog('github-client.bulk', { repo, prs: selected })} data-help="github-client.bulk">Bulk actions…</Button>
        {selected.length > 0 && <Button size="sm" tone="ghost" icon="x" onClick={() => setSelected([])}>Clear</Button>}
        <span className="fx-small fx-muted axp-github-client__grow">{data ? `${items.length} of ${data.total} open · polled ${ago(data.polledAt)}${data.queue?.on ? ' · merge queue on' : ''}` : busy ? 'Loading…' : ''}</span>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {data && items.length === 0 && <Note>No open pull requests match.</Note>}
      <ul className="axp-github-client__rows">
        {items.map((p) => <PrRow key={p.number} pr={p} open={open === p.number} onOpen={() => setOpen(open === p.number ? null : p.number)} selected={selected.includes(p.number)} onSelect={() => toggle(p.number)} reload={reload} />)}
      </ul>
    </div>
  );
}

function PrRow({ pr, open, onOpen, selected, onSelect, reload }: { pr: Pr; open: boolean; onOpen: () => void; selected: boolean; onSelect: () => void; reload: () => void }) {
  const st = prStatus(pr);
  const rt = useRuntime();
  return (
    <li className={`axp-github-client__row${open ? ' is-open' : ''}`} data-gh-pr={pr.number}>
      <div className="axp-github-client__rowhead">
        <Checkbox label="" title={`Select #${pr.number}`} checked={selected} onChange={onSelect} className="axp-github-client__pick" />
        <button type="button" data-fx-row className="axp-github-client__summary" aria-expanded={open} onClick={onOpen}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <Chip tone={st.tone}>{st.label}</Chip>
          <span className="axp-github-client__num">#{pr.number}</span>
          <span className="axp-github-client__title">{pr.title}</span>
          <span className="axp-github-client__chips">
            <Chip tone={checksTone(pr.checks.state)}>{pr.checks.state === 'none' ? 'no checks' : `checks ${pr.checks.total - pr.checks.failed.length - pr.checks.pending.length}/${pr.checks.total}`}</Chip>
            {pr.behind > 0 && <Chip tone={pr.behind > 20 ? 'warning' : undefined}>{pr.behind} behind</Chip>}
            {pr.mergeable === 'conflict' && <Chip tone="danger">conflicts</Chip>}
            {pr.review === 'approved' && <Chip tone="success">approved</Chip>}
            {pr.review === 'changes' && <Chip tone="danger">changes asked</Chip>}
            {pr.linkedBuild && <Chip tone="accent">build</Chip>}
            {pr.stale && <Chip tone="warning">stale</Chip>}
          </span>
          <span className="fx-small fx-muted axp-github-client__age">{pr.author} · {ago(pr.updatedAt)}</span>
        </button>
      </div>
      {open && (
        <div className="axp-github-client__detail">
          <p className="fx-small fx-mono axp-github-client__branches">{pr.head} → {pr.base} · {short(pr.headSha)} · +{pr.additions} −{pr.deletions} in {pr.changedFiles} files · {pr.ahead} ahead, {pr.behind} behind · {pr.comments} comments · {pr.ageDays}d old</p>
          {pr.ready ? <Note tone="success">Ready to merge{pr.queue ? ' (in the merge queue)' : ''}.</Note> : <Note tone="warning">Not ready: {pr.why.join('; ')}.</Note>}
          {pr.linkedBuild && (
            <p className="axp-github-client__line"><Icon name="hammer" size={12} /> Build <Button size="sm" tone="ghost" onClick={() => rt.dispatch(`build-orchestrator.focus:${encodeURIComponent(pr.linkedBuild!.id)}`) || rt.navigate('build-orchestrator')}>{pr.linkedBuild.title}</Button> <Chip>{pr.linkedBuild.status}</Chip></p>
          )}
          {pr.labels.length > 0 && <p className="axp-github-client__line">{pr.labels.map((l) => <Chip key={l}>{l}</Chip>)}</p>}
          <PrChecks pr={pr} />
          <PrActions pr={pr} reload={reload} />
          <PrCommits pr={pr} />
        </div>
      )}
    </li>
  );
}

function PrChecks({ pr }: { pr: Pr }) {
  const [rows, setRows] = useState<Check[] | null>(null);
  useEffect(() => { api.call<{ items: Check[] }>(prPath(pr.repo, pr.number, 'checks')).then((r) => setRows(r.items), () => setRows([])); }, [pr.repo, pr.number, pr.headSha]);
  if (!rows) return <p className="fx-small fx-muted">Loading checks…</p>;
  if (!rows.length) return <p className="fx-small fx-muted">No checks on the head commit.</p>;
  const order = (s: string) => (s === 'failure' ? 0 : s === 'running' || s === 'queued' || s === 'waiting' ? 1 : 2);
  return (
    <ul className="axp-github-client__checks" aria-label="Checks">
      {[...rows].sort((a, b) => order(a.state) - order(b.state)).map((c) => (
        <li key={`${c.kind}:${c.name}`} className="axp-github-client__check">
          <Chip tone={checksTone(c.state)}>{c.state}</Chip>
          <span>{c.name}</span>
          {c.url && <a className="fx-link fx-small" href={c.url} target="_blank" rel="noreferrer noopener">open <Icon name="external" size={10} /></a>}
        </li>
      ))}
    </ul>
  );
}

function PrCommits({ pr }: { pr: Pr }) {
  const rt = useRuntime();
  const [rows, setRows] = useState<Commit[] | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { if (show && !rows) api.call<{ items: Commit[] }>(prPath(pr.repo, pr.number, 'commits')).then((r) => setRows(r.items), () => setRows([])); }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="axp-github-client__sub">
      <button type="button" data-fx-row className="axp-github-client__subhead" aria-expanded={show} onClick={() => setShow(!show)}>
        <Icon name={show ? 'chevron-down' : 'chevron-right'} size={12} /> Commits on this PR
      </button>
      {show && (rows ? (
        <ul className="axp-github-client__commits">
          {rows.map((c) => (
            <li key={c.sha}><button type="button" data-fx-row className="axp-github-client__commit" onClick={() => rt.openDialog('github-client.commit', { repo: pr.repo, sha: c.sha })}>
              <span className="fx-mono">{short(c.sha)}</span><span className="axp-github-client__title">{c.message.split('\n')[0]}</span><span className="fx-small fx-muted">{c.author} · {ago(c.at)}</span>
            </button></li>
          ))}
        </ul>
      ) : <p className="fx-small fx-muted">Loading…</p>)}
    </div>
  );
}

/** Batches tab and Batch merge dialog (s4): pull main into several PRs, merge them on one branch, land them as one PR. */
import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Icon, Note, Switch, TextField, useRuntime } from '@console/axf/react';
import { api, ago, setSelected, type Group, type Job, type Pr, type PrList, type Tone } from './core';
import { useRun } from './actions';

const STATE_TONE: Record<string, Tone> = { building: 'warning', open: 'accent', conflict: 'danger', 'checks-failed': 'danger', landing: 'accent', landed: 'success', dissolved: undefined };

export function BatchesTab({ repo, version, reload, focusId }: { repo: string; version: number; reload: () => void; focusId?: string }) {
  const rt = useRuntime();
  const [rows, setRows] = useState<Group[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(focusId ?? null);
  useEffect(() => { api.call<{ items: Group[] }>(`groups?repo=${encodeURIComponent(repo)}`).then((r) => { setRows(r.items); setErr(''); }, (e: Error) => setErr(e.message)); }, [repo, version]);
  useEffect(() => { if (focusId) setOpen(focusId); }, [focusId]);
  return (
    <div className="axp-github-client__tab" data-help="github-client.batches">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Batches">
        <Button size="sm" tone="primary" icon="layers" onClick={() => rt.openDialog('github-client.batch', { repo, prs: [] })} data-help="github-client.batch">New batch…</Button>
        <span className="fx-small fx-muted axp-github-client__grow">A batch merges several PRs on one branch made from main, runs the checks once and lands as one PR, so they can’t clash on main.</span>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {rows && rows.length === 0 && <Note>No batches yet. Select PRs on Pull requests and tap Batch merge.</Note>}
      <ul className="axp-github-client__rows">
        {(rows ?? []).map((g) => <BatchRow key={g.id} g={g} open={open === g.id} onOpen={() => setOpen(open === g.id ? null : g.id)} reload={reload} />)}
      </ul>
    </div>
  );
}

function BatchRow({ g, open, onOpen, reload }: { g: Group; open: boolean; onOpen: () => void; reload: () => void }) {
  const { busy, run } = useRun(reload);
  const live = !['landed', 'dissolved'].includes(g.state);
  return (
    <li className={`axp-github-client__row${open ? ' is-open' : ''}`} data-gh-group={g.id}>
      <button type="button" data-fx-row className="axp-github-client__summary" aria-expanded={open} onClick={onOpen}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <Chip tone={STATE_TONE[g.state]}>{g.state}</Chip>
        <span className="axp-github-client__title">{g.name}</span>
        <span className="axp-github-client__chips">
          <Chip>{g.members.length} PRs</Chip>
          {g.pr && <Chip tone="accent">#{g.pr}</Chip>}
          {g.conflicts.some((c) => c.how !== 'resolved') && <Chip tone="danger">clash</Chip>}
          {g.fixBuild && <Chip tone="warning">Claude fixing</Chip>}
          {g.autoLand && <Chip>auto-land</Chip>}
        </span>
        <span className="fx-small fx-muted axp-github-client__age">{g.by} · {ago(g.createdAt)}</span>
      </button>
      {open && (
        <div className="axp-github-client__detail">
          <p className="fx-small fx-mono">{g.branch} → {g.base ?? 'main'} · tries {g.tries}</p>
          {g.why && <Note tone={g.state === 'conflict' || g.state === 'checks-failed' ? 'danger' : 'info'}>{g.why}</Note>}
          <ul className="axp-github-client__checks" aria-label="Members">
            {g.members.map((n) => (
              <li key={n} className="axp-github-client__check">
                <Chip tone={g.merged.includes(n) ? 'success' : g.conflicts.some((c) => c.member === n && c.how !== 'resolved') ? 'danger' : undefined}>{g.merged.includes(n) ? 'merged in' : g.conflicts.some((c) => c.member === n) ? 'clash' : 'waiting'}</Chip>
                <span>#{n} {g.titles?.[String(n)] ?? ''}</span>
                {live && <Button size="sm" tone="ghost" icon="minus" busy={busy === `rm${n}`} onClick={() => void run(`rm${n}`, `group/${g.id}/remove`, { prs: [n] }, 'Removed; rebuilding')}>Remove</Button>}
              </li>
            ))}
          </ul>
          {g.conflicts.length > 0 && (
            <ul className="axp-github-client__checks" aria-label="Clashes">
              {g.conflicts.map((c) => <li key={c.member} className="axp-github-client__check"><Chip tone={c.how === 'resolved' ? 'success' : 'danger'}>{c.how ?? 'open'}</Chip><span>#{c.member || 'main'}: {c.files.join(', ')}</span></li>)}
            </ul>
          )}
          <div className="axp-github-client__toolbar" role="toolbar" aria-label={`Batch ${g.name}`}>
            {(g.state === 'open' || g.state === 'checks-failed') && <Button size="sm" tone="primary" icon="check" busy={busy === 'land'} onClick={() => void run('land', `group/${g.id}/land`, {}, 'Landing')} data-help="github-client.batch-land">Land batch</Button>}
            {live && g.state !== 'landing' && <Button size="sm" icon="refresh" busy={busy === 'retry'} onClick={() => void run('retry', `group/${g.id}/retry`, {}, 'Retrying')} data-help="github-client.batch-retry">Retry</Button>}
            {live && g.state !== 'landing' && <Button size="sm" icon="download" busy={busy === 'fresh'} onClick={() => void run('fresh', `group/${g.id}/retry`, { fresh: true }, 'Rebuilding on fresh main')}>Rebuild on fresh main</Button>}
            {g.url && <Button size="sm" tone="ghost" icon="external" onClick={() => window.open(g.url, '_blank', 'noopener')}>Batch PR</Button>}
            {live && <Button size="sm" tone="danger" icon="trash" busy={busy === 'dissolve'} confirm={`Dissolve ${g.name}? Its PR closes and its branch is deleted (SHA saved); the member PRs stay.`} undoable onClick={() => void run('dissolve', `group/${g.id}/dissolve`, { confirm: true }, 'Dissolved')}>Dissolve</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

export function BatchDialog({ repo: repo0, prs, close }: { repo: string; prs: number[]; close: () => void }) {
  const rt = useRuntime();
  const [repo, setRepo] = useState(repo0);
  const [list, setList] = useState<Pr[]>([]);
  const [pick, setPick] = useState<number[]>(prs);
  const [name, setName] = useState('');
  const [autoLand, setAutoLand] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const go = (r: string) => api.call<PrList>(`prs?repo=${encodeURIComponent(r)}`).then((x) => setList(x.items), (e: Error) => setErr(e.message));
    if (repo) void go(repo); else api.call<{ items: { repo: string }[] }>('repos').then((r) => { const first = r.items[0]?.repo ?? ''; setRepo(first); if (first) void go(first); }, (e: Error) => setErr(e.message));
  }, [repo]);
  const make = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ text: string; job: Job; group: Group }>('group', { repo, prs: pick, name: name.trim() || undefined, autoLand });
      rt.toast(r.text, 'success', 'Batch merge'); setSelected([]); close();
      rt.dispatch(`github-client.focus:${encodeURIComponent(`batch ${r.group.id}`)}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack axp-github-client__dialog" data-help="github-client.batch">
      <p className="fx-small">Pulls main into each PR, merges them in this order on one branch, opens one PR into main and runs the checks once. Clashes between them go to Claude (a build) and you get an alert; Retry carries on.</p>
      <TextField label="Batch name" value={name} onChange={setName} placeholder="e.g. UI fixes Nov 12" />
      <ul className="axp-github-client__picklist" aria-label="Pull requests in the batch">
        {list.map((p) => (
          <li key={p.number}><Checkbox label={`#${p.number} ${p.title}${p.behind ? ` · ${p.behind} behind` : ''}${p.mergeable === 'conflict' ? ' · conflicts with main' : ''}`} checked={pick.includes(p.number)}
            onChange={(on) => setPick(on ? [...pick, p.number] : pick.filter((n) => n !== p.number))} /></li>
        ))}
      </ul>
      <Switch label="Land it as soon as it is green" checked={autoLand} onChange={setAutoLand} hint="Through the merge queue when it is on." />
      {err && <Note tone="danger">{err}</Note>}
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Batch merge">
        <Button tone="primary" icon="layers" disabled={pick.length < 2} busy={busy} onClick={() => void make()}>Batch {pick.length} PRs</Button>
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

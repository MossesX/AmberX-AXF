/** Branches, Commits and Checks tabs, the commit dialog and the diff dialog (s6). */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, IconButton, Note, SelectField, TextField, useRuntime } from '@console/axf/react';
import { api, ago, checksTone, prPath, short, type Branch, type Check, type Commit, type FileRec } from './core';

/* ---------------- Branches ---------------- */

type BranchFilter = 'all' | 'mine-pr' | 'no-pr' | 'behind';
export function BranchesTab({ repo, version, reload, focusName }: { repo: string; version: number; reload: () => void; focusName?: string }) {
  const rt = useRuntime();
  const [rows, setRows] = useState<Branch[] | null>(null);
  const [q, setQ] = useState(focusName ?? '');
  const [flt, setFlt] = useState<BranchFilter>('all');
  const [open, setOpen] = useState<string | null>(focusName ?? null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { setRows(null); api.call<{ items: Branch[] }>(`branches?repo=${encodeURIComponent(repo)}`).then((r) => { setRows(r.items); setErr(''); }, (e: Error) => setErr(e.message)); }, [repo, version]);
  useEffect(() => { if (focusName) { setQ(focusName); setOpen(focusName); } }, [focusName]);
  const del = async (b: Branch) => {
    setBusy(b.name);
    try {
      const r = await api.del<{ text: string }>(`branch/${repo}/${b.name.split('/').map(encodeURIComponent).join('/')}`);
      rt.toast(r.text, 'success', 'Branch deleted'); reload();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'GitHub client'); } finally { setBusy(''); }
  };
  const shown = (rows ?? []).filter((b) => (!q || b.name.toLowerCase().includes(q.toLowerCase())) && (flt === 'all' || (flt === 'mine-pr' ? b.pr : flt === 'no-pr' ? !b.pr && !b.default : b.behind > 0)))
    .sort((a, b) => Number(b.default) - Number(a.default) || (b.lastCommit.at || '').localeCompare(a.lastCommit.at || ''));
  return (
    <div className="axp-github-client__tab" data-help="github-client.branches">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Branches">
        <SelectField label="Show" value={flt} onChange={(v) => setFlt(v as BranchFilter)} options={[{ value: 'all', label: 'All branches' }, { value: 'mine-pr', label: 'With a PR' }, { value: 'no-pr', label: 'Without a PR' }, { value: 'behind', label: 'Behind main' }]} />
        <TextField label="Search" value={q} onChange={setQ} placeholder="branch name" className="axp-github-client__search" />
        <span className="fx-small fx-muted axp-github-client__grow">{rows ? `${shown.length} of ${rows.length}` : 'Loading…'}</span>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      <ul className="axp-github-client__rows">
        {shown.map((b) => (
          <li key={b.name} className={`axp-github-client__row${open === b.name ? ' is-open' : ''}`}>
            <button type="button" data-fx-row className="axp-github-client__summary" aria-expanded={open === b.name} onClick={() => setOpen(open === b.name ? null : b.name)}>
              <Icon name={open === b.name ? 'chevron-down' : 'chevron-right'} size={12} />
              <span className="axp-github-client__title fx-mono">{b.name}</span>
              <span className="axp-github-client__chips">
                {b.default && <Chip tone="accent">default</Chip>}
                {b.protected && <Chip>protected</Chip>}
                {b.pr && <Chip tone="accent">#{b.pr}</Chip>}
                {!b.default && <Chip>{b.ahead} ahead</Chip>}
                {b.behind > 0 && <Chip tone={b.behind > 50 ? 'warning' : undefined}>{b.behind} behind</Chip>}
              </span>
              <span className="fx-small fx-muted axp-github-client__age">{b.lastCommit.author} {b.lastCommit.at ? `· ${ago(b.lastCommit.at)}` : ''}</span>
            </button>
            {open === b.name && (
              <div className="axp-github-client__detail">
                <p className="fx-small"><span className="fx-mono">{short(b.sha)}</span> {b.lastCommit.message}</p>
                <div className="axp-github-client__toolbar" role="toolbar" aria-label={`Branch ${b.name}`}>
                  <Button size="sm" icon="list" onClick={() => rt.dispatch(`github-client.focus:${encodeURIComponent(`commits ${b.name}`)}`)}>Commits</Button>
                  {!b.default && <Button size="sm" icon="code" onClick={() => rt.openDialog('github-client.diff', { repo, base: 'main', head: b.name })}>Compare with main</Button>}
                  {b.pr ? <Button size="sm" icon="github" onClick={() => rt.dispatch(`github-client.focus:${encodeURIComponent(`pr ${b.pr}`)}`)}>PR #{b.pr}</Button>
                    : !b.default && <Button size="sm" icon="external" onClick={() => window.open(`https://github.com/${repo}/compare/${encodeURIComponent(b.name)}?expand=1`, '_blank', 'noopener')}>Open a PR</Button>}
                  {!b.default && !b.protected && <Button size="sm" tone="danger" icon="trash" busy={busy === b.name} confirm={`Delete ${b.name}? Its SHA ${short(b.sha)} is saved: Git log → Restore brings it back.`} undoable onClick={() => void del(b)} data-help="github-client.branch-delete">Delete</Button>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Commits ---------------- */

export function CommitsTab({ repo, branch: b0, sha }: { repo: string; branch?: string; sha?: string }) {
  const rt = useRuntime();
  const [branch, setBranch] = useState(b0 ?? 'main');
  const [branches, setBranches] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Commit[]; more: boolean } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (b0) setBranch(b0); }, [b0]);
  useEffect(() => { if (sha) rt.openDialog('github-client.commit', { repo, sha }); }, [sha]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.call<{ items: Branch[] }>(`branches?repo=${encodeURIComponent(repo)}`).then((r) => setBranches(r.items.map((x) => x.name)), () => {}); }, [repo]);
  useEffect(() => { setData(null); api.call<{ items: Commit[]; more: boolean }>(`commits?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&page=${page}`).then((r) => { setData(r); setErr(''); }, (e: Error) => setErr(e.message)); }, [repo, branch, page]);
  return (
    <div className="axp-github-client__tab" data-help="github-client.commits">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Commits">
        <SelectField label="Branch" value={branch} options={(branches.length ? branches : [branch]).map((n) => ({ value: n, label: n }))} onChange={(v) => { setBranch(v); setPage(1); }} />
        <IconButton icon="chevron-left" label="Newer" disabled={page <= 1} onClick={() => setPage(page - 1)} />
        <span className="fx-small fx-muted">page {page}</span>
        <IconButton icon="chevron-right" label="Older" disabled={!data?.more} onClick={() => setPage(page + 1)} />
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {!data && !err && <p className="fx-small fx-muted">Loading…</p>}
      <ul className="axp-github-client__rows">
        {(data?.items ?? []).map((c) => (
          <li key={c.sha} className="axp-github-client__row">
            <button type="button" data-fx-row className="axp-github-client__summary" onClick={() => rt.openDialog('github-client.commit', { repo, sha: c.sha })}>
              <span className="fx-mono axp-github-client__num">{short(c.sha)}</span>
              <span className="axp-github-client__title">{c.message.split('\n')[0]}</span>
              {c.parents.length > 1 && <Chip>merge</Chip>}
              <span className="fx-small fx-muted axp-github-client__age">{c.author} · {ago(c.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Files({ files }: { files: FileRec[] }) {
  const [open, setOpen] = useState<string | null>(files.length === 1 ? files[0]?.path ?? null : null);
  return (
    <ul className="axp-github-client__files" aria-label="Files">
      {files.map((f) => (
        <li key={f.path}>
          <button type="button" data-fx-row className="axp-github-client__summary" aria-expanded={open === f.path} onClick={() => setOpen(open === f.path ? null : f.path)}>
            <Icon name={open === f.path ? 'chevron-down' : 'chevron-right'} size={12} />
            <Chip tone={f.status === 'added' ? 'success' : f.status === 'removed' ? 'danger' : undefined}>{f.status}</Chip>
            <span className="axp-github-client__title fx-mono">{f.previous ? `${f.previous} → ` : ''}{f.path}</span>
            <span className="fx-small"><span className="axp-github-client__add">+{f.additions}</span> <span className="axp-github-client__del">−{f.deletions}</span></span>
          </button>
          {open === f.path && (f.patch ? (
            <pre className="axp-github-client__patch">{f.patch.split('\n').map((ln, i) => <span key={i} data-line={ln.startsWith('+') ? 'add' : ln.startsWith('-') ? 'del' : ln.startsWith('@@') ? 'hunk' : undefined}>{ln}{'\n'}</span>)}</pre>
          ) : <p className="fx-small fx-muted">{f.truncated ? 'Too large to show here: open it on GitHub.' : 'No text changes (binary or rename).'}</p>)}
        </li>
      ))}
    </ul>
  );
}

export function CommitDialog({ repo: r0, sha }: { repo: string; sha: string }) {
  const [c, setC] = useState<Commit | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const go = (repo: string) => api.call<Commit>(`commit/${repo}/${encodeURIComponent(sha)}`).then(setC, (e: Error) => setErr(e.message));
    if (r0) void go(r0); else api.call<{ items: { repo: string }[] }>('repos').then((x) => go(x.items[0]?.repo ?? ''), (e: Error) => setErr(e.message));
  }, [r0, sha]);
  if (err) return <Note tone="danger">{err}</Note>;
  if (!c) return <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack axp-github-client__dialog" data-help="github-client.commit">
      <p className="fx-mono fx-small">{c.sha} · {c.author} · {ago(c.at)}{c.stats ? ` · +${c.stats.additions} −${c.stats.deletions}` : ''}</p>
      <pre className="axp-github-client__message">{c.message}</pre>
      <Files files={c.files ?? []} />
      {c.url && <Button size="sm" tone="ghost" icon="external" onClick={() => window.open(c.url, '_blank', 'noopener')}>Open on GitHub</Button>}
    </div>
  );
}

export function DiffDialog({ repo, pr, base, head }: { repo: string; pr: number; base: string; head: string }) {
  const [files, setFiles] = useState<FileRec[] | null>(null);
  const [meta, setMeta] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (pr) api.call<{ items: FileRec[] }>(prPath(repo, pr, 'files')).then((r) => { setFiles(r.items); setMeta(`#${pr}: ${r.items.length} files`); }, (e: Error) => setErr(e.message));
    else api.call<{ files: FileRec[]; ahead: number; behind: number }>(`diff?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`)
      .then((r) => { setFiles(r.files); setMeta(`${head} vs ${base}: ${r.ahead} ahead, ${r.behind} behind, ${r.files.length} files`); }, (e: Error) => setErr(e.message));
  }, [repo, pr, base, head]);
  if (err) return <Note tone="danger">{err}</Note>;
  if (!files) return <p className="fx-small fx-muted">Loading…</p>;
  return <div className="fx-stack axp-github-client__dialog" data-help="github-client.diff"><p className="fx-small">{meta}</p><Files files={files} /></div>;
}

/* ---------------- Checks ---------------- */

export function ChecksTab({ repo, initial }: { repo: string; initial?: string }) {
  const [ref, setRef] = useState(initial ?? 'main');
  const [input, setInput] = useState(initial ?? 'main');
  const [rows, setRows] = useState<Check[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (initial) { setRef(initial); setInput(initial); } }, [initial]);
  useEffect(() => { setRows(null); api.call<{ items: Check[] }>(`checks?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}`).then((r) => { setRows(r.items); setErr(''); }, (e: Error) => setErr(e.message)); }, [repo, ref]);
  const groups = new Map<string, Check[]>();
  for (const c of rows ?? []) { const k = c.workflow || (c.kind === 'status' ? 'Statuses' : 'Checks'); groups.set(k, [...(groups.get(k) ?? []), c]); }
  return (
    <div className="axp-github-client__tab" data-help="github-client.checks">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Checks">
        <TextField label="Branch, SHA or pr:<n>" value={input} onChange={setInput} className="axp-github-client__search" />
        <Button size="sm" icon="search" onClick={() => setRef(input.trim())}>Show</Button>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {rows && rows.length === 0 && <Note>No checks on {ref}.</Note>}
      {[...groups].map(([wf, list]) => (
        <section key={wf} className="axp-github-client__sub">
          <h3 className="axp-github-client__h">{wf}</h3>
          <ul className="axp-github-client__checks">
            {list.map((c) => (
              <li key={`${c.kind}:${c.name}`} className="axp-github-client__check">
                <Chip tone={checksTone(c.state)}>{c.state}</Chip><span>{c.name}</span>
                <span className="fx-small fx-muted">{c.finishedAt ? ago(c.finishedAt) : c.startedAt ? `started ${ago(c.startedAt)}` : ''}</span>
                {c.url && <Button size="sm" tone="ghost" icon="external" onClick={() => window.open(c.url, '_blank', 'noopener')}>Open</Button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

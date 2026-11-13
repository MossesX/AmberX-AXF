/** Git log tab (s9): every git action in one searchable list, expandable rows, Restore for deleted branches, import of deleted-branch lists. */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Note, SelectField, Segmented, TextField, useRuntime } from '@console/axf/react';
import { api, ago, short, type LogEntry } from './core';

const KIND_LABEL: Record<string, string> = {
  merge: 'merged', 'merge-failed': 'merge failed', retry: 'retry', 'update-main': 'main pulled in', rebase: 'rebased', close: 'closed', reopen: 'reopened',
  comment: 'comment', 'rerun-checks': 'checks re-run', ready: 'ready for review', label: 'labels', 'queue-add': 'into the queue', 'queue-remove': 'out of the queue',
  'branch-delete': 'branch deleted', restore: 'branch restored', push: 'pushed', 'pr-open': 'PR opened', 'pr-close': 'PR closed', 'group-create': 'batch built',
  'group-land': 'batch landed', 'group-dissolve': 'batch dissolved', bulk: 'bulk run', import: 'imported delete',
};
type Outcome = '' | 'ok' | 'failed';

export function LogTab({ repo, version, reload, initial }: { repo: string; version: number; reload: () => void; initial?: string }) {
  const rt = useRuntime();
  const [q, setQ] = useState(initial ?? '');
  const [kind, setKind] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('');
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: LogEntry[]; total: number; more: boolean; kinds: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (initial !== undefined) setQ(initial); }, [initial]);
  useEffect(() => {
    const qs = new URLSearchParams({ q, kind, outcome, page: String(page), ...(all || !repo ? {} : { repo }) });
    api.call<typeof data & object>(`log?${qs}`).then((r) => { setData(r); setErr(''); }, (e: Error) => setErr(e.message));
  }, [q, kind, outcome, all, repo, page, version]);
  const act = async (key: string, path: string) => {
    setBusy(key);
    try { const r = await api.post<{ text: string }>(path, {}); rt.toast(r.text, 'success', 'Git log'); reload(); } catch (e) { rt.toast((e as Error).message, 'danger', 'Git log'); } finally { setBusy(''); }
  };
  return (
    <div className="axp-github-client__tab" data-help="github-client.log">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Git log">
        <TextField label="Search" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="PR number, branch, SHA, why, who" className="axp-github-client__search" />
        <SelectField label="Kind" value={kind} empty="Every kind" options={(data?.kinds ?? []).map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))} onChange={(v) => { setKind(v); setPage(1); }} />
        <Segmented size="sm" label="Outcome" value={outcome} onChange={(v) => { setOutcome(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'ok', label: 'OK' }, { value: 'failed', label: 'Failed' }]} />
        <Segmented size="sm" label="Repos" value={all ? 'all' : 'this'} onChange={(v) => setAll(v === 'all')} options={[{ value: 'this', label: 'This repo' }, { value: 'all', label: 'Every repo' }]} />
        <Button size="sm" icon="upload" busy={busy === 'import'} onClick={() => void act('import', 'log/import')} data-help="github-client.log-import">Import deleted-branch lists</Button>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {data && data.items.length === 0 && <Note>Nothing logged yet{q || kind || outcome ? ' that matches' : ''}.</Note>}
      <ul className="axp-github-client__rows">
        {(data?.items ?? []).map((e) => {
          const t = e.target ?? {};
          const what = [t.pr ? `#${t.pr}` : '', t.branch ?? '', t.group && !t.branch ? t.group : ''].filter(Boolean).join(' · ');
          return (
            <li key={e.id} className={`axp-github-client__row${open === e.id ? ' is-open' : ''}`} data-gh-log={e.id}>
              <button type="button" data-fx-row className="axp-github-client__summary" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                <Icon name={open === e.id ? 'chevron-down' : 'chevron-right'} size={12} />
                <Chip tone={e.outcome === 'failed' ? 'danger' : e.kind === 'merge' || e.kind === 'restore' ? 'success' : undefined}>{KIND_LABEL[e.kind] ?? e.kind}</Chip>
                <span className="axp-github-client__title">{what || e.repo}{e.why ? ` — ${e.why}` : ''}</span>
                {e.restorable && <Chip tone={e.restoredAt ? 'success' : 'accent'}>{e.restoredAt ? 'restored' : 'restorable'}</Chip>}
                <span className="fx-small fx-muted axp-github-client__age">{e.actor.name} · {ago(e.at)}</span>
              </button>
              {open === e.id && (
                <div className="axp-github-client__detail">
                  <p className="fx-small fx-mono">{e.at} · {e.repo} · {e.actor.kind}: {e.actor.name}{t.sha ? ` · ${short(t.sha)}` : ''}{e.savedSha ? ` · saved ${e.savedSha}` : ''}</p>
                  {e.why && <Note tone={e.outcome === 'failed' ? 'danger' : 'info'}>{e.why}</Note>}
                  {e.details && <p className="fx-small">{e.details}</p>}
                  <div className="axp-github-client__toolbar" role="toolbar" aria-label="Log entry">
                    {e.restorable && <Button size="sm" icon="restore" busy={busy === e.id} onClick={() => void act(e.id, `log/${e.id}/restore`)} data-help="github-client.restore">Restore {t.branch}</Button>}
                    {t.pr && <Button size="sm" icon="github" onClick={() => rt.dispatch(`github-client.focus:${encodeURIComponent(`pr ${e.repo} ${t.pr}`)}`)}>PR #{t.pr}</Button>}
                    {t.group && <Button size="sm" icon="layers" onClick={() => rt.dispatch(`github-client.focus:${encodeURIComponent(`batch ${t.group}`)}`)}>Batch</Button>}
                    {(t.sha || e.savedSha) && <Button size="sm" icon="code" onClick={() => rt.openDialog('github-client.commit', { repo: e.repo, sha: t.sha || e.savedSha })}>Commit</Button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data && (data.more || page > 1) && (
        <div className="axp-github-client__toolbar" role="toolbar" aria-label="Pages">
          <Button size="sm" tone="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span className="fx-small fx-muted">page {page} · {data.total} entries</span>
          <Button size="sm" tone="ghost" disabled={!data.more} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}

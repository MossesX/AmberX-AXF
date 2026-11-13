/** Bulk actions dialog (s5): merge all ready, close all stale, update all from main, re-run failed, label — previewed first. */
import { useEffect, useState } from 'react';
import { Button, Chip, Note, Segmented, TextField, useRuntime } from '@console/axf/react';
import { api, setSelected, type Job } from './core';

type Action = 'merge-ready' | 'close-stale' | 'update-main' | 'rerun-failed' | 'label';
const ACTIONS: { value: Action; label: string }[] = [
  { value: 'merge-ready', label: 'Merge all ready' }, { value: 'close-stale', label: 'Close all stale' },
  { value: 'update-main', label: 'Update all from main' }, { value: 'rerun-failed', label: 'Re-run failed' }, { value: 'label', label: 'Label' },
];
interface Preview { take: { number: number; title: string }[]; skipped: { target: string; note: string }[] }

export function BulkDialog({ repo, prs, close }: { repo: string; prs: number[]; close: () => void }) {
  const rt = useRuntime();
  const [action, setAction] = useState<Action>('merge-ready');
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const scope = prs.length ? { prs } : {};
  useEffect(() => { setPreview(null); api.post<Preview>('bulk/preview', { repo: repo || undefined, action, ...scope }).then(setPreview, (e: Error) => setErr(e.message)); }, [action, repo, prs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return;
    const t = setInterval(() => { api.call<Job>(`job/${job.id}`).then(setJob, () => {}); }, 2000);
    return () => clearInterval(t);
  }, [job]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ text: string; job?: Job }>('bulk', { repo: repo || undefined, action, ...scope, ...(action === 'label' ? { add: label.split(',').map((s) => s.trim()).filter(Boolean) } : {}) });
      rt.toast(r.text, 'success', 'Bulk actions'); if (r.job) setJob(r.job); setSelected([]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack axp-github-client__dialog" data-help="github-client.bulk">
      <p className="fx-small">{prs.length ? `On the ${prs.length} selected PRs.` : 'On every open PR that fits (nothing selected).'} Each action only takes the PRs it fits: merge takes ready ones, close takes stale ones, update takes the ones behind main.</p>
      <Segmented label="Action" value={action} options={ACTIONS} onChange={setAction} size="sm" />
      {action === 'label' && <TextField label="Labels to add (comma separated)" value={label} onChange={setLabel} />}
      {err && <Note tone="danger">{err}</Note>}
      {!job && preview && (
        <ul className="axp-github-client__picklist" aria-label="Preview">
          {preview.take.map((p) => <li key={p.number} className="axp-github-client__check"><Chip tone="success">will {action === 'close-stale' ? 'close' : action === 'merge-ready' ? 'merge' : 'run'}</Chip><span>#{p.number} {p.title}</span></li>)}
          {preview.skipped.map((s) => <li key={s.target} className="axp-github-client__check"><Chip>skip</Chip><span>{s.target}: {s.note}</span></li>)}
        </ul>
      )}
      {job && (
        <ul className="axp-github-client__picklist" aria-label="Results">
          <li><Chip tone={job.state === 'done' ? 'success' : job.state === 'failed' ? 'danger' : 'warning'}>{job.state}</Chip> job {job.id}</li>
          {job.items.map((i) => <li key={i.target} className="axp-github-client__check"><Chip tone={i.state === 'ok' ? 'success' : i.state === 'failed' ? 'danger' : undefined}>{i.state}</Chip><span>{i.target} {i.note ?? ''}</span></li>)}
        </ul>
      )}
      <div className="axp-github-client__toolbar" role="toolbar" aria-label="Bulk actions">
        {!job && <Button tone="primary" icon="play" disabled={!preview?.take.length || (action === 'label' && !label.trim())} busy={busy}
          confirm={`${ACTIONS.find((a) => a.value === action)?.label}: ${preview?.take.length ?? 0} PRs. Go?`} onClick={() => void go()}>Run on {preview?.take.length ?? 0} PRs</Button>}
        {job && ['queued', 'running'].includes(job.state) && <Button tone="danger" icon="x" onClick={() => void api.post(`job/${job.id}/cancel`, {})}>Stop</Button>}
        <Button tone="ghost" onClick={close}>Close</Button>
      </div>
    </div>
  );
}

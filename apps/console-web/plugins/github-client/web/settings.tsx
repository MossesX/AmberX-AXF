/** Settings → Plugins → GitHub client: every setting is GET/PUT config, so the API reads and changes the same values. */
import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { api } from './core';

interface Config { extraRepos: string[]; pollMinutes: number; staleDays: number; mergeMethod: string; requireGreenChecks: boolean; allowNoChecks: boolean; requireReview: boolean; doNotMergeLabel: string; me: string; autoRetry: number; conflictHelp: string }

export function GitHubClientSettings() {
  const rt = useRuntime();
  const [c, setC] = useState<Config | null>(null);
  const [repos, setRepos] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.call<Config>('config').then((x) => { setC(x); setRepos(x.extraRepos.join('\n')); }, (e: Error) => setErr(e.message)); }, []);
  const save = async (patch: Partial<Config>) => {
    try { const x = await api.put<Config>('config', patch); setC(x); setErr(''); rt.toast('Saved', 'success', 'GitHub client'); } catch (e) { setErr((e as Error).message); }
  };
  if (!c) return err ? <Note tone="danger">{err}</Note> : <p className="fx-small fx-muted">Loading…</p>;
  const num = (v: string) => Math.round(Number(v) || 0);
  return (
    <div className="fx-stack axp-github-client__settings" data-help="github-client.settings">
      {err && <Note tone="danger">{err}</Note>}
      <TextField label="Extra repos (owner/name, one a line)" rows={3} value={repos} onChange={setRepos} hint="Besides the project's own repo and the merge queue's." />
      <div><Button size="sm" icon="save" onClick={() => void save({ extraRepos: repos.split(/\s+/).map((s) => s.trim()).filter(Boolean) })}>Save repos</Button></div>
      <SelectField label="Merge method" value={c.mergeMethod} onChange={(v) => void save({ mergeMethod: v })} hint="Queue: into the merge queue when it is on for the repo (else squash)."
        options={[{ value: 'queue', label: 'Merge queue' }, { value: 'squash', label: 'Squash' }, { value: 'merge', label: 'Merge commit' }, { value: 'rebase', label: 'Rebase' }]} />
      <Switch label="Require green checks" checked={c.requireGreenChecks} onChange={(v) => void save({ requireGreenChecks: v })} />
      <Switch label="Allow a PR with no checks" checked={c.allowNoChecks} onChange={(v) => void save({ allowNoChecks: v })} />
      <Switch label="Require an approving review" checked={c.requireReview} onChange={(v) => void save({ requireReview: v })} />
      <TextField label="Do-not-merge label" value={c.doNotMergeLabel} onChange={(v) => setC({ ...c, doNotMergeLabel: v })} />
      <TextField label="Your GitHub login (the Mine filter)" value={c.me} onChange={(v) => setC({ ...c, me: v })} />
      <TextField label="Stale after (days)" type="number" value={String(c.staleDays)} onChange={(v) => setC({ ...c, staleDays: num(v) })} />
      <TextField label="Poll GitHub every (minutes)" type="number" value={String(c.pollMinutes)} onChange={(v) => setC({ ...c, pollMinutes: num(v) })} />
      <TextField label="Batch auto-retries when its checks fail (0-3)" type="number" value={String(c.autoRetry)} onChange={(v) => setC({ ...c, autoRetry: num(v) })} />
      <div><Button size="sm" icon="save" onClick={() => void save({ doNotMergeLabel: c.doNotMergeLabel, me: c.me, staleDays: c.staleDays, pollMinutes: c.pollMinutes, autoRetry: c.autoRetry })}>Save</Button></div>
      <SelectField label="Clashes in a batch" value={c.conflictHelp} onChange={(v) => void save({ conflictHelp: v })}
        options={[{ value: 'claude', label: 'Claude fixes them (a build in the Queue)' }, { value: 'report', label: 'Only report them' }]} />
    </div>
  );
}

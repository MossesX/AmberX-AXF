/** A PR row's actions (s3): merge, pull main in, rebase, close, reopen, comment, re-run checks, mark ready, ask Claude to fix. */
import { useState } from 'react';
import { Button, TextField, useRuntime } from '@console/axf/react';
import { api, prPath, type Job, type Pr } from './core';

interface ActionAnswer { ok?: boolean; text?: string; job?: Job; queued?: boolean; merged?: boolean; build?: string }

export function useRun(reload: () => void) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const run = async (key: string, path: string, body: Record<string, unknown> = {}, okText = 'Done') => {
    setBusy(key);
    try {
      const r = await api.post<ActionAnswer>(path, body);
      rt.toast(r.text || (r.job ? `${okText}: job ${r.job.id} started` : okText), 'success', 'GitHub client');
      reload();
      return r;
    } catch (e) { rt.toast((e as Error).message, 'danger', 'GitHub client'); return null; } finally { setBusy(''); }
  };
  return { busy, run };
}

export function PrActions({ pr, reload }: { pr: Pr; reload: () => void }) {
  const rt = useRuntime();
  const { busy, run } = useRun(reload);
  const [comment, setComment] = useState('');
  const p = (tail: string) => prPath(pr.repo, pr.number, tail);
  const open = pr.state === 'open';
  return (
    <div className="axp-github-client__actions">
      <div className="axp-github-client__toolbar" role="toolbar" aria-label={`Actions for #${pr.number}`}>
        {open && <Button size="sm" tone="primary" icon="check" busy={busy === 'merge'} disabled={!pr.ready || !!pr.queue} title={pr.ready ? 'Merge (through the merge queue when it is on)' : `Not ready: ${pr.why.join('; ')}`}
          onClick={() => void run('merge', p('merge'), {}, 'Merged')} data-help="github-client.merge">{pr.queue ? 'In the queue' : 'Merge'}</Button>}
        {open && <Button size="sm" icon="download" busy={busy === 'update'} disabled={pr.behind === 0} onClick={() => void run('update', p('update-main'), {}, 'Pulling main in')} data-help="github-client.update-main">Pull main in</Button>}
        {open && <Button size="sm" icon="shuffle" busy={busy === 'rebase'} confirm={`Rebase #${pr.number} onto ${pr.base}? Its branch is force-pushed (with lease).`} onClick={() => void run('rebase', p('rebase'), { confirm: true }, 'Rebasing')} data-help="github-client.rebase">Rebase</Button>}
        {open && pr.checks.state === 'failure' && <Button size="sm" icon="refresh" busy={busy === 'rerun'} onClick={() => void run('rerun', p('rerun-checks'), { failedOnly: true }, 'Re-running failed checks')} data-help="github-client.rerun">Re-run failed</Button>}
        {open && <Button size="sm" icon="play" busy={busy === 'rerunall'} onClick={() => void run('rerunall', p('rerun-checks'), { failedOnly: false }, 'Re-running every check')}>Re-run all</Button>}
        {open && pr.draft && <Button size="sm" icon="check-circle" busy={busy === 'ready'} onClick={() => void run('ready', p('ready'), {}, 'Marked ready for review')}>Ready for review</Button>}
        {open && pr.mergeable === 'conflict' && <Button size="sm" icon="sparkles" busy={busy === 'fix'} onClick={() => void run('fix', p('fix-conflicts'), {}, 'Handed to Claude')} data-help="github-client.fix-conflicts">Ask Claude to fix</Button>}
        {open && pr.queue && <Button size="sm" tone="ghost" icon="x" busy={busy === 'dequeue'} onClick={() => void run('dequeue', p('queue-remove'), { why: 'taken out from the GitHub client' }, 'Taken out of the queue')}>Out of the queue</Button>}
        {open ? <Button size="sm" tone="danger" icon="x-circle" busy={busy === 'close'} confirm={`Close #${pr.number}? The branch stays.`} undoable onClick={() => void run('close', p('close'), {}, 'Closed')} data-help="github-client.close">Close</Button>
          : pr.state === 'closed' && <Button size="sm" icon="undo" busy={busy === 'reopen'} onClick={() => void run('reopen', p('reopen'), {}, 'Reopened')}>Reopen</Button>}
        <Button size="sm" tone="ghost" icon="external" onClick={() => window.open(pr.url, '_blank', 'noopener')}>GitHub</Button>
        <Button size="sm" tone="ghost" icon="code" onClick={() => rt.openDialog('github-client.diff', { repo: pr.repo, pr: pr.number })}>Files</Button>
      </div>
      <div className="axp-github-client__comment">
        <TextField label="Comment" value={comment} onChange={setComment} rows={2} placeholder="Write a comment on the PR" />
        <Button size="sm" icon="edit" disabled={!comment.trim()} busy={busy === 'comment'} onClick={() => void run('comment', p('comment'), { body: comment }, 'Commented').then((r) => { if (r) setComment(''); })} data-help="github-client.comment">Comment</Button>
      </div>
    </div>
  );
}

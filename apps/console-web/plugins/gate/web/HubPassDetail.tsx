/**
 * One hub pass by its address, `#/passes/<id>` (the `url` the hub answers for a pass; build
 * approval-pass-covers-every-call, s9): what it covers, whether it is still on, and the runs under it. Reads
 * `GET /auth/api/passes/<id>`, which also answers a pass that has ended. Shown above the list on the axHub passes tab.
 */
import { Button, Chip, Container, Note, useRuntime } from '@console/axf/react';
import { relTime } from '@console/hubPages/core';
import { go } from '@console/hubPages/route';
import { useHubJson, when } from '@console/hubPages/page';

interface OnePass {
  pass: {
    id: string; title: string; description: string; scopeLabel: string; active: boolean; expiresAt: string; grantedBy: string;
    uses: number; runs?: number; lastUsedAt?: string; revokedAt?: string; revokedBy?: string; updatedAt?: string; updatedBy?: string; quietNotice?: boolean;
  };
}

export function HubPassDetail({ id }: { id: string }) {
  const rt = useRuntime();
  const res = useHubJson<OnePass>(`/auth/api/passes/${encodeURIComponent(id)}`, 30_000);
  const p = res.data?.pass;
  const runs = p ? p.runs ?? p.uses : 0;
  return (
    <Container title={p ? p.title : 'Pass'} icon="clock" actions={p && <Chip tone={p.active ? 'success' : undefined}>{p.active ? 'on' : p.revokedAt ? 'revoked' : 'ended'}</Chip>}>
      <div className="fx-stack" data-axf-pass-detail={id}>
        {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
        {!p && !res.error && <p className="fx-muted">Loading the pass…</p>}
        {p && (
          <>
            <p className="fx-mono">Covers {p.scopeLabel}</p>
            {p.description && p.description !== p.title && <p>{p.description}</p>}
            <p className="fx-muted">
              {p.active ? `Ends ${when(p.expiresAt)}` : p.revokedAt ? `Revoked ${relTime(p.revokedAt)}${p.revokedBy ? ` by ${p.revokedBy}` : ''}` : `Ended ${relTime(p.expiresAt)}`} · granted by {p.grantedBy} · {runs} call{runs === 1 ? '' : 's'} ran under it{p.lastUsedAt ? `, last ${relTime(p.lastUsedAt)}` : ''}
              {p.updatedAt ? ` · coverage changed ${relTime(p.updatedAt)}${p.updatedBy ? ` by ${p.updatedBy}` : ''}` : ''}{p.quietNotice ? ' · a quiet line for each run' : ''}
            </p>
          </>
        )}
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="list" onClick={() => go(rt, 'approvals-log', { pass: id })}>Its calls</Button>
          <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'passes')}>All passes</Button>
        </div>
      </div>
    </Container>
  );
}

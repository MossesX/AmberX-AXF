/**
 * Timed passes (axHub decision 112, docs/veto-pass.md in the axHub repo): "allow theme changes for the next 30 minutes".
 * While a pass is on, calls it covers run at once instead of waiting on the veto countdown; destructive tools never do.
 * Active passes with their countdown first (Revoke, Extend), then a form to switch one on, then the ones that ended.
 * Every action goes through the hub's session API (`/auth/api/passes`), never a token.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { passClock, passCovers, passSecondsLeft, patternList, relTime } from '../hub/core';
import { go } from '../hub/route';
import { HubGate, TapTwice, useHubJson, when } from './hubPage';

interface PassView {
  id: string;
  service: string;
  tools: string[];
  scope?: string[];
  title: string;
  description: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  secondsLeft: number;
  grantedBy: string;
  grantedVia: 'approval' | 'web' | 'cli' | 'feed';
  source?: { kind: string; label: string; session?: string };
  uses: number;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  canExtend: boolean;
  canRevoke: boolean;
}
interface PassesPage {
  active: PassView[];
  recent: PassView[];
  minutes: { min: number; max: number; presets: number[] };
  now: string;
}

const VIA: Record<PassView['grantedVia'], string> = { approval: 'approved request', web: 'this app', cli: 'hub terminal', feed: 'console' };

export function Passes() {
  return <HubGate admin what="passes">{() => <Page />}</HubGate>;
}

/** Re-renders every second while something counts down. */
function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function Page() {
  const rt = useRuntime();
  const res = useHubJson<PassesPage>('/auth/api/passes', 30_000);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const d = res.data;
  useEffect(() => setFetchedAt(Date.now()), [d]);
  const now = useTick(!!d?.active.length);

  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const r = await hubPost<{ message?: string }>(path, body);
      rt.toast(r.message || done, 'success');
      await res.reload();
    } catch (e) {
      rt.toast(e instanceof Error ? e.message : String(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Veto</p>
          <h1>Passes</h1>
          <p className="fx-muted">For a while, calls a pass covers run at once instead of waiting on the veto countdown. Destructive tools never do.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="list" onClick={() => go(rt, 'approvals-log', { pass: 'any' })}>Ran under a pass</Button>
        </div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && d.active.length === 0 && <Note icon="pause">No pass is on. Every change waits on the veto countdown.</Note>}
      {d && d.active.map((p) => {
        const left = passSecondsLeft(p.secondsLeft, fetchedAt, now);
        return (
          <Container key={p.id} title={p.title} icon="clock" actions={<Chip tone={left > 120 ? 'success' : 'warning'}>{passClock(left)}</Chip>}>
            <div className="fx-stack" data-axf-pass={p.id}>
              <div className="fx-row fx-row--wrap">
                {p.canRevoke && <TapTwice label="Revoke" again="Tap again to revoke" tone="danger" disabled={busy} onConfirm={() => void act(`/auth/api/passes/${encodeURIComponent(p.id)}/revoke`, {}, 'Pass ended')} />}
                {p.canExtend && d.minutes.presets.map((m) => (
                  <Button key={m} size="sm" disabled={busy} onClick={() => void act(`/auth/api/passes/${encodeURIComponent(p.id)}/extend`, { minutes: m }, `Extended to ${m} min`)}>{m} min from now</Button>
                ))}
              </div>
              <p className="fx-mono">{passCovers(p)}</p>
              {p.description && p.description !== p.title && <p>{p.description}</p>}
              <p className="fx-muted">
                Ends {when(p.expiresAt)} · granted by {p.grantedBy} ({VIA[p.grantedVia]}){p.source ? ` · asked from ${p.source.label}${p.source.session ? ` ${p.source.session}` : ''}` : ''} · {p.uses} call{p.uses === 1 ? '' : 's'} ran under it{p.lastUsedAt ? `, last ${relTime(p.lastUsedAt)}` : ''}
              </p>
              {p.grantedVia === 'feed' && <p className="fx-muted">Switched on in the console: revoke stops the hub honouring it; extend it in the console.</p>}
              <div className="fx-row"><Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approvals-log', { pass: p.id })}>Its calls</Button></div>
            </div>
          </Container>
        );
      })}
      {d && <Grant limits={d.minutes} busy={busy} onGrant={(body) => act('/auth/api/passes', body, 'Pass on')} />}
      {d && d.recent.length > 0 && (
        <Container title="Ended" icon="history" collapsible defaultOpen={false}>
          <table className="fx-table">
            <tbody>
              {d.recent.map((p) => (
                <tr key={p.id}>
                  <th>{p.title}</th>
                  <td>{passCovers(p)} · {p.revokedAt ? `revoked ${relTime(p.revokedAt)}${p.revokedBy ? ` by ${p.revokedBy}` : ''}` : `ended ${relTime(p.expiresAt)}`} · {p.uses} call{p.uses === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}
    </div>
  );
}

function Grant({ limits, busy, onGrant }: { limits: PassesPage['minutes']; busy: boolean; onGrant: (body: Record<string, unknown>) => void }) {
  const [service, setService] = useState('axf-console');
  const [scope, setScope] = useState('tokens.theme');
  const [tools, setTools] = useState('');
  const [reason, setReason] = useState('Theme changes with Claude');
  const scopes = patternList(scope);
  const toolList = patternList(tools);
  const ready = service.trim() !== '' && reason.trim() !== '' && (!!scopes || !!toolList);
  return (
    <Container title="Switch a pass on" icon="plus" collapsible defaultOpen={false}>
      <div className="fx-stack">
        <TextField label="Service" value={service} onChange={setService} placeholder="axf-console" />
        <TextField label="Scope (control@1 target; * matches anything)" value={scope} onChange={setScope} placeholder="tokens.theme, tokens.*" />
        <TextField label="Tools (empty = every tool in the scope)" value={tools} onChange={setTools} placeholder="control_set, control_reset" />
        <TextField label="What for" value={reason} onChange={setReason} placeholder="Theme changes with Claude" />
        <p className="fx-muted">How long ({limits.min}–{limits.max} minutes):</p>
        <div className="fx-row fx-row--wrap">
          {limits.presets.map((m) => (
            <Button key={m} tone="success" disabled={busy || !ready} onClick={() => onGrant({ service: service.trim(), ...(scopes ? { scope: scopes } : {}), ...(toolList ? { tools: toolList } : {}), minutes: m, reason: reason.trim() })}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </Button>
          ))}
        </div>
      </div>
    </Container>
  );
}

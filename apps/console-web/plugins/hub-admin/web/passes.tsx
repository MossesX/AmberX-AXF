/**
 * Hub → Passes and veto (hub-console@1 screen `passes`): timed passes that let calls run without the veto wait (axHub
 * decision 112), pass requests waiting for Brett's Grant, the go pass for sessions that cannot reach axHub, the veto
 * countdown and No wait shown read-only (owner-only, owned by Claude settings). Grant and Go are Brett's own tap
 * (person); Revoke confirms (two taps, the second carries the server's token); Extend, End and Ask are commands.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '@console/axf/react';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS, when, type Unavailable } from './data';
import { UnavailableNote } from './approvals';
import { TapTwice, clock, useHubAction, useTick } from './controls';

export interface PassView {
  id: string; service: string; tools?: string[]; scope?: string[]; title: string; description?: string; createdAt: string; expiresAt: string; active: boolean;
  secondsLeft: number; grantedBy: string; grantedVia: 'approval' | 'web' | 'cli' | 'feed'; source?: { kind: string; label: string; session?: string };
  uses: number; lastUsedAt?: string; revokedAt?: string; revokedBy?: string; canExtend: boolean; canRevoke: boolean;
}
export interface PassRequest { id: string; state: string; by: string; at: string; service: string; scope?: string[]; tools?: string[]; minutes: number; reason: string }
export interface GoPassView { live: boolean; hours: number[]; repos: string[]; branch: string; file: string; pass?: { state: 'go' | 'ended'; issuedAt: string; expiresAt: string; hours: number; by: string; note: string }; writes: { repo: string; ok: boolean; at: string; error?: string }[] }
export interface PassesPage {
  active: PassView[]; recent: PassView[]; minutes: { min: number; max: number; presets: number[] } | null; requests: PassRequest[];
  goPass: GoPassView | { unavailable: Unavailable }; veto: { defaultSeconds: number; min: number; max: number } | { unavailable: Unavailable };
  noWait: { active?: boolean; remainingMs?: number; expiresAt?: string; text?: string } | null; now: string;
}

const VIA: Record<PassView['grantedVia'], string> = { approval: 'approved request', web: 'the hub page', cli: 'hub terminal', feed: 'the console' };
const covers = (p: Pick<PassView, 'service' | 'tools' | 'scope'>) => `${p.service}${p.tools?.length ? ` · ${p.tools.join(', ')}` : ''}${p.scope?.length ? ` · ${p.scope.join(', ')}` : ''}`;
const isUnavailable = (v: unknown): v is { unavailable: Unavailable } => !!v && typeof v === 'object' && 'unavailable' in (v as object);

export function PassesScreen(_props: { screen: HubScreen }) {
  const rt = useRuntime();
  const { data, stale, reload } = useHubRead<PassesPage>('passes', {}, 30000);
  const g = data && data.ok ? data : null;
  const [readAt, setReadAt] = useState(Date.now());
  useEffect(() => { setReadAt(Date.now()); }, [g]);
  const now = useTick(!!g && g.active.length > 0);
  const left = (p: PassView) => Math.max(0, p.secondsLeft - Math.floor((now - readAt) / 1000));
  const veto = g && !isUnavailable(g.veto) ? g.veto : null;
  const goPass = g && !isUnavailable(g.goPass) ? g.goPass : null;

  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="passes">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · veto</p>
          <h1>Passes and veto</h1>
          <p className="fx-muted">For a while, calls a pass covers run at once instead of waiting on the veto countdown. Destructive tools never do. Granting is your own tap.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check now</Button>
          <Button icon="list" onClick={() => rt.dispatch('hub.open:log')}>Ran under a pass</Button>
        </div>
      </header>

      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}

      {g && (
        <div className="fx-row fx-row--wrap" role="group" aria-label="Veto settings">
          <Chip tone={veto ? undefined : 'warning'}>{veto ? `Veto countdown ${veto.defaultSeconds} s (${veto.min}–${veto.max})` : 'Veto countdown: not readable'}</Chip>
          <Chip tone={g.noWait?.active ? 'warning' : undefined}>{g.noWait ? (g.noWait.active ? `No wait on${g.noWait.expiresAt ? ` until ${when(g.noWait.expiresAt)}` : ''}` : 'No wait off') : 'No wait: Claude settings not installed'}</Chip>
          <span className="fx-muted fx-small">No wait is owner-only and lives in Claude settings; the countdown is set under Settings → Plugins → Hub.</span>
        </div>
      )}

      {g && g.requests.length > 0 && (
        <Container title={`Asked for: ${g.requests.length} pass${g.requests.length === 1 ? '' : 'es'} waiting on you`} icon="bell">
          <div className="fx-stack">
            {g.requests.map((r) => <RequestRow key={r.id} r={r} limits={g.minutes} onDone={() => void reload()} />)}
          </div>
        </Container>
      )}

      {g && g.active.length === 0 && <Note icon="pause">No pass is on. Every change waits on the veto countdown.</Note>}
      {g && g.active.map((p) => <ActivePass key={p.id} p={p} left={left(p)} presets={g.minutes?.presets ?? []} onDone={() => void reload()} />)}

      {g && <Grant limits={g.minutes} onDone={() => void reload()} />}

      {g && (
        <Container title={goPass ? (goPass.live ? 'Go pass: sessions may work' : 'Go pass: off, sessions wait') : 'Go pass'} icon={goPass?.live ? 'check' : 'pause'} collapsible defaultOpen={!!goPass?.live}
          actions={goPass ? <Chip tone={goPass.live ? 'success' : 'warning'}>{goPass.live ? 'Live' : 'Off'}</Chip> : undefined}>
          {goPass ? <GoPass v={goPass} onDone={() => void reload()} /> : <UnavailableNote r={(g.goPass as { unavailable: Unavailable }).unavailable} />}
        </Container>
      )}

      {g && g.recent.length > 0 && (
        <Container title="Ended" icon="history" collapsible defaultOpen={false}>
          <table className="fx-table">
            <tbody>
              {g.recent.map((p) => (
                <tr key={p.id}>
                  <th>{p.title}</th>
                  <td>{covers(p)} · {p.revokedAt ? `revoked ${relTime(p.revokedAt)}${p.revokedBy ? ` by ${p.revokedBy}` : ''}` : `ended ${relTime(p.expiresAt)}`} · {p.uses} call{p.uses === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}
    </div>
  );
}

function ActivePass({ p, left, presets, onDone }: { p: PassView; left: number; presets: number[]; onDone: () => void }) {
  const rt = useRuntime();
  const revoke = useHubAction('passes', 'revoke', p.id, onDone);
  const extend = useHubAction('passes', 'extend', p.id, onDone);
  return (
    <Container title={p.title} icon="clock" actions={<Chip tone={left > 120 ? 'success' : 'warning'}>{clock(left)}</Chip>}>
      <div className="fx-stack" data-axf-pass={p.id}>
        <div className="fx-row fx-row--wrap">
          {p.canRevoke && <TapTwice label="Revoke" again="Tap again to revoke" icon="x" tone="danger" size="sm" disabled={revoke.busy} armed={revoke.armed} onArm={() => void revoke.run()} onRun={() => void revoke.run()} />}
          {p.canExtend && presets.map((m) => <Button key={m} size="sm" disabled={extend.busy} onClick={() => void extend.run({ minutes: m })}>{m} min from now</Button>)}
        </div>
        <p className="fx-mono">{covers(p)}</p>
        {p.description && p.description !== p.title && <p>{p.description}</p>}
        <p className="fx-muted">
          Ends {when(p.expiresAt)} · granted by {p.grantedBy} ({VIA[p.grantedVia] ?? p.grantedVia}){p.source ? ` · asked from ${p.source.label}${p.source.session ? ` ${p.source.session}` : ''}` : ''} · {p.uses} call{p.uses === 1 ? '' : 's'} ran under it{p.lastUsedAt ? `, last ${relTime(p.lastUsedAt)}` : ''}
        </p>
        <div className="fx-row"><Button size="sm" tone="ghost" icon="chevron-right" onClick={() => rt.dispatch('hub.open:log')}>Its calls</Button></div>
      </div>
    </Container>
  );
}

/** A request a session made (hub_pass_request): Grant is Brett's tap, with the request's own fields. */
function RequestRow({ r, limits, onDone }: { r: PassRequest; limits: PassesPage['minutes']; onDone: () => void }) {
  const grant = useHubAction('passes', 'grant', undefined, onDone);
  const minutes = limits ? Math.min(Math.max(r.minutes, limits.min), limits.max) : r.minutes;
  return (
    <div className="fx-row fx-row--wrap" data-axf-pass-request={r.id}>
      <div className="fx-stack">
        <strong>{r.reason}</strong>
        <span className="fx-mono">{covers(r)} · {minutes} min</span>
        <span className="fx-muted fx-small">asked by {r.by} {relTime(r.at)}</span>
      </div>
      <Button tone="success" icon="check" disabled={grant.busy} onClick={() => void grant.run({ service: r.service, scope: r.scope, tools: r.tools, minutes, reason: r.reason, requestId: r.id })}>Grant {minutes} min</Button>
    </div>
  );
}

function Grant({ limits, onDone }: { limits: PassesPage['minutes']; onDone: () => void }) {
  const rt = useRuntime();
  const saved = rt.settings.get('axf.hub.passes.grant') as unknown;
  const d = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const str = (k: string, dflt: string) => (typeof d[k] === 'string' ? (d[k] as string) : dflt);
  const [service, setService] = useState(str('service', 'axf-console'));
  const [scope, setScope] = useState(str('scope', 'tokens.theme'));
  const [tools, setTools] = useState(str('tools', ''));
  const [reason, setReason] = useState(str('reason', 'Theme changes with Claude'));
  const grant = useHubAction('passes', 'grant', undefined, onDone);
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const ready = service.trim() !== '' && reason.trim() !== '' && (list(scope).length > 0 || list(tools).length > 0);
  const presets = limits?.presets?.length ? limits.presets : [15, 30, 60, 120];
  return (
    <Container title="Switch a pass on" icon="plus" collapsible defaultOpen={false}>
      <div className="fx-stack">
        <TextField label="Service" value={service} onChange={setService} placeholder="axf-console" />
        <TextField label="Scope (control@1 target; * matches anything)" value={scope} onChange={setScope} placeholder="tokens.theme, tokens.*" />
        <TextField label="Tools (empty = every tool in the scope)" value={tools} onChange={setTools} placeholder="control_set, control_reset" />
        <TextField label="What for" value={reason} onChange={setReason} placeholder="Theme changes with Claude" />
        <p className="fx-muted">How long{limits ? ` (${limits.min}–${limits.max} minutes)` : ''}:</p>
        <div className="fx-row fx-row--wrap">
          {presets.map((m) => (
            <Button key={m} tone="success" disabled={grant.busy || !ready} onClick={() => { rt.settings.set('axf.hub.passes.grant', { service: service.trim(), scope, tools, reason: reason.trim() } as never); void grant.run({ service: service.trim(), scope: list(scope), tools: list(tools), minutes: m, reason: reason.trim() }); }}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </Button>
          ))}
        </div>
      </div>
    </Container>
  );
}

function GoPass({ v, onDone }: { v: GoPassView; onDone: () => void }) {
  const [note, setNote] = useState('');
  const go = useHubAction('passes', 'go', undefined, onDone);
  const end = useHubAction('passes', 'go-end', undefined, onDone);
  return (
    <div className="fx-stack">
      <p className="fx-muted">A Claude chat that cannot load your rules and threads from axHub does nothing until you say go here.</p>
      {v.pass && v.live && <p>Given by {v.pass.by} {relTime(v.pass.issuedAt)} for {v.pass.hours} h · ends {when(v.pass.expiresAt)} ({relTime(v.pass.expiresAt)}){v.pass.note ? ` · ${v.pass.note}` : ''}</p>}
      {v.pass && !v.live && <p className="fx-muted">Last pass {v.pass.state === 'ended' ? `ended by ${v.pass.by}` : 'ran out'} {relTime(v.pass.expiresAt)}.</p>}
      <TextField label="Note (optional, shown in the pass)" value={note} onChange={setNote} placeholder="e.g. Working from the phone" />
      <div className="fx-row fx-row--wrap">
        {(v.hours.length ? v.hours : [4, 8]).map((h) => <Button key={h} tone="success" disabled={go.busy} onClick={() => void go.run({ hours: h, note })}>Go for {h} h</Button>)}
        {v.live && <TapTwice label="End it now" again="Tap again to end" tone="danger" disabled={end.busy} onRun={() => void end.run()} />}
      </div>
      <p className="fx-muted fx-small">{v.file} on the {v.branch} branch of each repo (never main).{v.repos.length === 0 ? ' No repos are set (AXHUB_GO_PASS_REPOS on the hub).' : ''}</p>
      {v.writes.length > 0 && (
        <table className="fx-table"><tbody>
          {v.writes.map((w) => <tr key={w.repo}><th>{w.repo}</th><td>{w.ok ? `Written ${relTime(w.at)}` : `Failed: ${w.error ?? 'GitHub refused it'}`}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

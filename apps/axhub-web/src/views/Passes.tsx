/**
 * Timed passes (axHub decision 112, docs/veto-pass.md in the axHub repo): "allow theme changes for the next 30 minutes".
 * While a pass is on, calls it covers run at once instead of waiting on the veto countdown or an approval. Decision 120
 * (Brett, Nov 18 2026: "Why do I keep getting approvals when I set a pass?"): a pass covers every tool by default
 * (`covers: all`: vps.run, console_terminal_sessions_stop, destructive and explicit-approval tools included); the
 * picker narrows it to services, tools or scopes. Only irreversible calls (unless included) and denies still ask.
 * Active passes with their countdown, coverage and runs first (Revoke, Extend, Edit coverage), then a form to switch
 * one on, then the ones that ended. `#/passes/<id>` opens one. Every action goes through the hub's session API
 * (`/auth/api/passes`), never a token; the same actions are axhub.pass_grant / pass_update / pass_revoke (MCP), the
 * hub CLI and the AmberX voice command.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, Chip, Container, Note, Segmented, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { coverageChips, coversFrom, passClock, passRunsLine, passSecondsLeft, relTime } from '../hub/core';
import { go, useRouteParams } from '../hub/route';
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
  /** decision 120: what it covers ("all" or entries), covered runs per class, what a run sends to the phone */
  covers?: 'all' | string[];
  runs?: { veto?: number; confirm?: number; explicit?: number };
  notify?: 'none' | 'quiet';
  scopeLabel?: string;
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
  services?: { namespace: string; displayName: string; type?: string }[];
  now: string;
}
type CoverMode = 'all' | 'pick';

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
  const opened = useRouteParams('passes').id ?? '';
  const [editing, setEditing] = useState('');
  useEffect(() => setFetchedAt(Date.now()), [d]);
  // #/passes/<id>: scroll the opened pass into view
  useEffect(() => { if (opened && d) document.querySelector(`[data-axf-pass="${CSS.escape(opened)}"]`)?.scrollIntoView({ block: 'start' }); }, [opened, d]);
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
          <p className="fx-muted">For a while, calls a pass covers run at once: no veto countdown, no approval, no push. A pass covers every tool unless you pick some. Irreversible calls still ask unless included.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="list" onClick={() => go(rt, 'approvals-log', { pass: 'any' })}>Ran under a pass</Button>
        </div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && d.active.length === 0 && <Note icon="pause">No pass is on. Every change waits on the veto countdown or an approval.</Note>}
      {d && d.active.map((p) => {
        const left = passSecondsLeft(p.secondsLeft, fetchedAt, now);
        return (
          <Container key={p.id} title={p.title} icon="clock" actions={<Chip tone={left > 120 ? 'success' : 'warning'}>{passClock(left)}</Chip>}>
            <div className={`fx-stack${opened === p.id ? ' is-on' : ''}`} data-axf-pass={p.id}>
              <div className="fx-row fx-row--wrap">
                {p.canRevoke && <TapTwice label="Revoke" again="Tap again to revoke" tone="danger" disabled={busy} onConfirm={() => void act(`/auth/api/passes/${encodeURIComponent(p.id)}/revoke`, {}, 'Pass ended')} />}
                {p.canExtend && d.minutes.presets.map((m) => (
                  <Button key={m} size="sm" disabled={busy} onClick={() => void act(`/auth/api/passes/${encodeURIComponent(p.id)}/extend`, { minutes: m }, `Extended to ${m} min`)}>{m} min from now</Button>
                ))}
              </div>
              <div className="fx-row fx-row--wrap" data-axf-pass-covers={p.id} aria-label="Covers">
                {coverageChips(p.covers).map((c) => <Chip key={c} tone={c === 'All tools' ? 'success' : undefined}>{c}</Chip>)}
                {p.notify === 'quiet' && <Chip>quiet line per run</Chip>}
              </div>
              <p className="fx-muted" data-axf-pass-runs={p.id}>Ran under it: {passRunsLine(p.runs)}</p>
              {editing === p.id && p.grantedVia !== 'feed' && (
                <Coverage initial={p.covers} notify={p.notify} services={d.services ?? []} busy={busy} submit="Save coverage"
                  onSubmit={(body) => { setEditing(''); void act(`/auth/api/passes/${encodeURIComponent(p.id)}/update`, body, 'Coverage saved'); }} />
              )}
              {p.description && p.description !== p.title && <p>{p.description}</p>}
              <p className="fx-muted">
                Ends {when(p.expiresAt)} · granted by {p.grantedBy} ({VIA[p.grantedVia]}){p.source ? ` · asked from ${p.source.label}${p.source.session ? ` ${p.source.session}` : ''}` : ''} · {p.uses} call{p.uses === 1 ? '' : 's'} ran under it{p.lastUsedAt ? `, last ${relTime(p.lastUsedAt)}` : ''}
              </p>
              {p.grantedVia === 'feed' && <p className="fx-muted">Switched on in the console: revoke stops the hub honouring it; extend it in the console.</p>}
              <div className="fx-row fx-row--wrap">
                <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approvals-log', { pass: p.id })}>Its calls</Button>
                {p.canExtend && <Button size="sm" tone="ghost" icon="edit" onClick={() => setEditing(editing === p.id ? '' : p.id)}>{editing === p.id ? 'Close' : 'Edit coverage'}</Button>}
              </div>
            </div>
          </Container>
        );
      })}
      {d && <Grant limits={d.minutes} services={d.services ?? []} busy={busy} onGrant={(body) => act('/auth/api/passes', body, 'Pass on')} />}
      {d && d.recent.length > 0 && (
        <Container title="Ended" icon="history" collapsible defaultOpen={false}>
          <table className="fx-table">
            <tbody>
              {d.recent.map((p) => (
                <tr key={p.id}>
                  <th>{p.title}</th>
                  <td>{coverageChips(p.covers).join(' · ')} · {p.revokedAt ? `revoked ${relTime(p.revokedAt)}${p.revokedBy ? ` by ${p.revokedBy}` : ''}` : `ended ${relTime(p.expiresAt)}`} · {p.uses} call{p.uses === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}
    </div>
  );
}

/**
 * What a pass covers: "All tools" (the default, every service and tool, veto and approval tools included) or a pick of
 * services plus typed entries (`<service>.<tool>`, `scope:<target>`). Also the notify setting.
 */
function Coverage({ initial, notify, services, busy, submit, onSubmit, children }: {
  initial?: 'all' | string[]; notify?: 'none' | 'quiet'; services: NonNullable<PassesPage['services']>; busy: boolean; submit: string;
  onSubmit: (body: { covers: 'all' | string[]; notify: 'none' | 'quiet' }) => void; children?: ReactNode;
}) {
  const start = Array.isArray(initial) ? initial : [];
  const known = new Set(services.map((s) => s.namespace));
  const [mode, setMode] = useState<CoverMode>(Array.isArray(initial) ? 'pick' : 'all');
  const [picked, setPicked] = useState<string[]>(start.filter((e) => known.has(e)));
  const [typed, setTyped] = useState(start.filter((e) => !known.has(e)).join(', '));
  const [quiet, setQuiet] = useState(notify === 'quiet');
  const covers = coversFrom(mode, picked, typed);
  const toggle = (ns: string, on: boolean) => setPicked((l) => (on ? [...l, ns] : l.filter((x) => x !== ns)));
  return (
    <div className="fx-stack" data-axf-pass-coverage>
      <Segmented<CoverMode> label="What the pass covers" value={mode} onChange={setMode}
        options={[{ value: 'all', label: 'All tools', icon: 'check' }, { value: 'pick', label: 'Pick services and tools', icon: 'list' }]} />
      {mode === 'all' && <p className="fx-muted">Every service and tool: vps.run, console stops, deletes and explicit-approval tools included.</p>}
      {mode === 'pick' && (
        <div className="fx-stack">
          {services.length > 0 && (
            <div className="fx-row fx-row--wrap">
              {services.map((s) => <Checkbox key={s.namespace} label={`${s.displayName} (${s.namespace})`} checked={picked.includes(s.namespace)} onChange={(on) => toggle(s.namespace, on)} />)}
            </div>
          )}
          <TextField label="More: <service>.<tool> or scope:<target> (* matches anything)" value={typed} onChange={setTyped} placeholder="axf-console.console_terminal_*, scope:tokens.*" />
          {!covers && <p className="fx-muted">Pick at least one service, tool or scope.</p>}
        </div>
      )}
      <Checkbox label="One quiet line on my phone per run (otherwise nothing)" checked={quiet} onChange={setQuiet} />
      {children}
      {submit && <div className="fx-row"><Button tone="success" disabled={busy || !covers} onClick={() => covers && onSubmit({ covers, notify: quiet ? 'quiet' : 'none' })}>{submit}</Button></div>}
    </div>
  );
}

function Grant({ limits, services, busy, onGrant }: { limits: PassesPage['minutes']; services: NonNullable<PassesPage['services']>; busy: boolean; onGrant: (body: Record<string, unknown>) => void }) {
  const [reason, setReason] = useState('Work with Claude');
  const [minutes, setMinutes] = useState(String(limits.presets[1] ?? limits.presets[0] ?? 30));
  return (
    <Container title="Switch a pass on" icon="plus" collapsible defaultOpen={false}>
      <div className="fx-stack" data-axf-pass-grant>
        <TextField label="What for" value={reason} onChange={setReason} placeholder="Work with Claude" />
        <Segmented<string> label={`How long (${limits.min}–${limits.max} minutes)`} value={minutes} onChange={setMinutes}
          options={limits.presets.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} h` }))} />
        <Coverage services={services} busy={busy || reason.trim() === ''} submit="Switch it on"
          onSubmit={({ covers, notify }) => onGrant({ covers, notify, minutes: Number(minutes), reason: reason.trim() })} />
      </div>
    </Container>
  );
}

/**
 * VPS Configuration → Passes → axHub passes (moved from the axhub-passes plugin, Nov 21 2026).
 * Timed passes (axHub decision 112, docs/veto-pass.md in the axHub repo; coverage: framework/spec/AXHUB-PASS.md, pass@2).
 * While a pass is on, every call it covers runs at once: no veto countdown (vps.run), no approval prompt (confirm and
 * always-approve tools such as console_terminal_sessions_stop), no notice; the log names the pass it ran under.
 *
 * A pass covers **All tools** unless the owner picks: the grant form and Edit coverage share one picker (All tools |
 * Pick services and tools → services, their tools, typed patterns and scopes). Each active pass card lists its coverage
 * and the calls that ran under it. Then the form to switch one on, then the passes that ended.
 * Every action goes through the hub's session API, never a token: `POST /auth/api/passes` (grant: `covers`, `minutes`,
 * `reason`, `quietNotice`, `include_irreversible`), `…/<id>/update` (coverage), `…/<id>/extend`, `…/<id>/revoke`.
 * The picker's services come from the page's own `services` (namespace, displayName, tools) when the hub sends them,
 * else the names the Approval rules tab already read; typed entries always work.
 * How "All tools or a pick" is asked is the plugin's view choice `gate.pass-cover-view` (UI Review options,
 * plugins/gate/assets/settings/pass-coverage-*.json): `segmented` (the default), `switch` or `select`.
 * console-control@1: buttons `button:hub-pass-grant | hub-pass-edit-<id> | hub-pass-save-<id>`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Container, Note, Segmented, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { hubPost } from '@console/hubPages/api';
import { passClock, passSecondsLeft, readPassCovers, relTime } from '@console/hubPages/core';
import { go, useRouteParams } from '@console/hubPages/route';
import { HubGate, TapTwice, useHubJson, when } from '@console/hubPages/page';
import { cachedApprovals, loadApprovals } from './approvalRulesState';
import { HubPassDetail } from './HubPassDetail';
import { usePassCoverView } from './rows';
import {
  coverageChips, coverageSummary, coversFromPick, filterTools, grantBody, lengthLabel, minutesError, pickFromCovers, pickerServices, runLines, runsHeading,
  serviceState, toggleService, toggleTool, toolPicked, updateBody,
  type CoverEntry, type CoverMode, type Coverage, type Pick, type PickerService, type ServiceLike,
} from './pass-coverage.mjs';

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
  /** pass@2: `all` or the entries; absent on a pass@1 record (read through the migration). */
  covers?: unknown;
  all?: boolean;
  includeIrreversible?: boolean;
  quietNotice?: boolean;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  canExtend: boolean;
  canRevoke: boolean;
  /** Absent on a hub before pass@2: a pass that can be extended can be edited. */
  canEdit?: boolean;
}
interface PassesPage {
  active: PassView[];
  recent: PassView[];
  minutes: { min: number; max: number; presets: number[] };
  /** The services and tools a pass can name (absent on a hub that doesn't list them). */
  services?: ServiceLike[];
  now: string;
}
interface CoverChoice { covers: 'all' | CoverEntry[]; includeIrreversible: boolean; quietNotice: boolean }
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-');

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
  const [editing, setEditing] = useState('');
  const [known, setKnown] = useState(() => cachedApprovals()?.services ?? []);
  const d = res.data;
  useEffect(() => setFetchedAt(Date.now()), [d]);
  // the picker's fallback list of services: the names the Approval rules tab reads (the hub's own list wins)
  useEffect(() => { if (!known.length) void loadApprovals().then((a) => setKnown(a.services), () => { /* typed entries still work */ }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const services = useMemo(() => pickerServices(d?.services, known), [d?.services, known]);
  const now = useTick(!!d?.active.length);
  // `#/passes/<id>`: that one pass first, ended or not
  const { id: openId } = useRouteParams('passes');

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
          <p className="fx-muted">For a while, every call a pass covers runs at once: no veto countdown, no approval prompt, no notice. A pass covers all tools unless you pick some.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="list" onClick={() => go(rt, 'approvals-log', { pass: 'any' })}>Ran under a pass</Button>
        </div>
      </header>
      {openId && <HubPassDetail key={openId} id={openId} />}
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && d.active.length === 0 && <Note icon="pause">No pass is on. Every change waits on its veto countdown or approval.</Note>}
      {d && d.active.map((p) => {
        const left = passSecondsLeft(p.secondsLeft, fetchedAt, now);
        return (
          <Container key={p.id} title={p.title} icon="clock" actions={<Chip tone={left > 120 ? 'success' : 'warning'}>{passClock(left)}</Chip>}>
            <div className="fx-stack" data-axf-pass={p.id}>
              <div className="fx-row fx-row--wrap">
                {p.canRevoke && <TapTwice label="Revoke" again="Tap again to revoke" tone="danger" disabled={busy} onConfirm={() => void act(`/auth/api/passes/${encodeURIComponent(p.id)}/revoke`, {}, 'Pass ended')} />}
                {p.canExtend && d.minutes.presets.map((m) => (
                  <Button key={m} size="sm" disabled={busy} onClick={() => void act(`/auth/api/passes/${encodeURIComponent(p.id)}/extend`, { minutes: m }, `Extended to ${lengthLabel(m)}`)}>{lengthLabel(m)} from now</Button>
                ))}
              </div>
              <div className="axp-gate__bar" role="group" aria-label="Covers" data-axf-pass-covers={p.id}>
                <span className="axp-gate__label">Covers</span>
                {coverageChips(readPassCovers(p) as Coverage, p.includeIrreversible).map((c) => <Chip key={c.label} tone={c.tone}>{c.label}</Chip>)}
                {p.quietNotice && <Chip>quiet notice per run</Chip>}
              </div>
              {editing === p.id && (
                <Coverage key={p.id} id={slug(p.id)} services={services} initial={p} busy={busy} submit="Save coverage"
                  onSubmit={(c) => { setEditing(''); void act(`/auth/api/passes/${encodeURIComponent(p.id)}/update`, updateBody(c), 'Coverage saved'); }} />
              )}
              {p.description && p.description !== p.title && <p>{p.description}</p>}
              <p className="fx-muted">
                Ends {when(p.expiresAt)} · granted by {p.grantedBy} ({VIA[p.grantedVia]}){p.source ? ` · asked from ${p.source.label}${p.source.session ? ` ${p.source.session}` : ''}` : ''}
              </p>
              {p.grantedVia === 'feed' && <p className="fx-muted">Switched on in the console: revoke stops the hub honouring it; extend it in the console.</p>}
              <Runs pass={p} />
              <div className="axp-gate__bar">
                <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approvals-log', { pass: p.id })}>All its calls</Button>
                {(p.canEdit ?? p.canExtend) && p.grantedVia !== 'feed' && (
                  <Button size="sm" tone="ghost" icon="edit" id={`hub-pass-edit-${slug(p.id)}`} onClick={() => setEditing(editing === p.id ? '' : p.id)}>{editing === p.id ? 'Close' : 'Edit coverage'}</Button>
                )}
              </div>
            </div>
          </Container>
        );
      })}
      {d && <Grant limits={d.minutes} services={services} open={d.active.length === 0} busy={busy} onGrant={(body) => act('/auth/api/passes', body, 'Pass on')} />}
      {d && d.recent.length > 0 && (
        <Container title="Ended" icon="history" collapsible defaultOpen={false}>
          <table className="fx-table">
            <tbody>
              {d.recent.map((p) => (
                <tr key={p.id}>
                  <th>{p.title}</th>
                  <td>{coverageChips(readPassCovers(p) as Coverage, p.includeIrreversible).map((c) => c.label).join(', ')} · {p.revokedAt ? `revoked ${relTime(p.revokedAt)}${p.revokedBy ? ` by ${p.revokedBy}` : ''}` : `ended ${relTime(p.expiresAt)}`} · {p.uses} call{p.uses === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}
    </div>
  );
}

/** The calls that ran under one pass: the count, then the newest few from the log (tool, what the pass skipped, when). */
function Runs({ pass }: { pass: PassView }) {
  const res = useHubJson<{ entries?: Record<string, unknown>[] }>(pass.uses > 0 ? `/auth/api/approvals/log?${new URLSearchParams({ pass: pass.id, sort: 'newest', page: '1' }).toString()}` : null, 30_000);
  const lines = runLines(res.data?.entries);
  return (
    <div className="axp-gate__stat" data-axf-pass-runs={pass.id}>
      <span className="axp-gate__label">{runsHeading(pass.uses, pass.lastUsedAt ? relTime(pass.lastUsedAt) : '')}</span>
      {lines.length > 0 && (
        <ul className="axp-gate__runs">
          {lines.map((r) => (
            <li key={r.id}>
              <span className="axp-gate__bar">
                <span className="fx-mono">{r.tool}</span>
                {r.failed && <Chip tone="danger">failed</Chip>}
                <span className="axp-gate__sub">{[r.skipped, r.at ? relTime(r.at) : ''].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What a pass covers: "All tools" (the default: every service and tool, whatever its policy) or a pick of services,
 * their tools and typed entries. Also the pass's two switches. Shared by the grant form and Edit coverage.
 */
function Coverage({ id, services, initial, busy, blocked, submit, onSubmit }: {
  id: string; services: PickerService[]; initial?: PassView; busy: boolean; blocked?: string; submit: string; onSubmit: (c: CoverChoice) => void;
}) {
  const start = useMemo(() => pickFromCovers(initial ? (readPassCovers(initial) as Coverage) : 'all', services), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<CoverMode>(start.mode);
  const [pick, setPick] = useState<Pick>(start.pick);
  const [find, setFind] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [irreversible, setIrreversible] = useState(initial?.includeIrreversible === true);
  const [quiet, setQuiet] = useState(initial?.quietNotice === true);
  const { covers, error } = coversFromPick(mode, pick);
  const anyTools = services.some((s) => s.tools.length > 0);
  const view = usePassCoverView();
  return (
    <div className="axp-gate__cover" data-axf-pass-coverage={id} data-axf-pass-cover-view={view}>
      {view === 'segmented' && (
        <Segmented<CoverMode> label="What the pass covers" value={mode} onChange={setMode}
          options={[{ value: 'all', label: 'All tools', icon: 'check' }, { value: 'pick', label: 'Pick services and tools', icon: 'list' }]} />
      )}
      {view === 'switch' && (
        <Switch label="All tools" checked={mode === 'all'} onChange={(on) => setMode(on ? 'all' : 'pick')}
          hint="Every tool on every service, whatever its policy. Off: pick the services and tools the pass covers." />
      )}
      {view === 'select' && (
        <SelectField label="What the pass covers" value={mode} onChange={(v) => setMode(v === 'pick' ? 'pick' : 'all')}
          options={[{ value: 'all', label: 'All tools' }, { value: 'pick', label: 'Pick services and tools' }]} />
      )}
      {mode === 'all' && <Switch label="Include irreversible calls" checked={irreversible} onChange={setIrreversible} hint="Hard deletes nothing can bring back run without asking too." />}
      {mode === 'pick' && (
        <div className="axp-gate__cover">
          {anyTools && <TextField label="Find a tool" type="search" value={find} onChange={setFind} placeholder="run, sessions_stop" />}
          {services.map((s) => {
            const state = serviceState(pick, s.namespace);
            const { shown, more } = filterTools(s.tools, find);
            const expanded = s.tools.length > 0 && (open[s.namespace] ?? (state === 'some' || (find.trim() !== '' && shown.length > 0)));
            return (
              <div key={s.namespace} className="axp-gate__cover-svc" data-axf-pass-service={s.namespace}>
                <div className="axp-gate__bar">
                  <Checkbox label={s.displayName === s.namespace ? `${s.namespace}: every tool` : `${s.displayName} (${s.namespace}): every tool`} checked={state === 'all'} indeterminate={state === 'some'}
                    onChange={(on) => setPick((p) => toggleService(p, s.namespace, on))} />
                  {s.tools.length > 0 && (
                    <Button size="sm" tone="ghost" icon={expanded ? 'chevron-down' : 'chevron-right'} onClick={() => setOpen((o) => ({ ...o, [s.namespace]: !expanded }))}>
                      {state === 'some' ? `${(pick.services[s.namespace] as string[]).length} of ${s.tools.length} tools` : `${s.tools.length} tools`}
                    </Button>
                  )}
                </div>
                {expanded && (
                  <div className="axp-gate__cover-items" role="group" aria-label={`${s.displayName} tools`}>
                    {shown.map((t) => <Checkbox key={t} label={<span className="fx-mono">{t}</span>} checked={toolPicked(pick, s.namespace, t)} onChange={(on) => setPick((p) => toggleTool(p, s.namespace, t, on, s.tools))} />)}
                    {shown.length === 0 && <span className="axp-gate__sub">No tool of this service matches.</span>}
                    {more > 0 && <span className="axp-gate__sub">{more} more: narrow the search.</span>}
                  </div>
                )}
              </div>
            );
          })}
          <TextField label={services.length ? 'More services, tools and scopes' : 'Services, tools and scopes'} mono value={pick.more} onChange={(more) => setPick((p) => ({ ...p, more }))}
            placeholder="vps.run, axf-console.console_terminal_sessions_*, scope:tokens.theme"
            hint="service · service.tool · scope:target, separated by commas. * stands for any run of characters." />
        </div>
      )}
      <Switch label="Quiet notice per run" checked={quiet} onChange={setQuiet} hint="One quiet “ran under pass” line for each covered call. Off: a covered call sends nothing." />
      {covers ? <p className="axp-gate__sub" data-axf-pass-summary>{coverageSummary(covers, irreversible)}</p> : <p className="axp-gate__note" role="status">{error}</p>}
      <div className="axp-gate__bar">
        <Button id={initial ? `hub-pass-save-${id}` : 'hub-pass-grant'} tone="success" icon="check" disabled={busy || !covers || !!blocked} title={blocked || undefined}
          onClick={() => covers && onSubmit({ covers, includeIrreversible: covers === 'all' && irreversible, quietNotice: quiet })}>{submit}</Button>
      </div>
    </div>
  );
}

function Grant({ limits, services, open, busy, onGrant }: { limits: PassesPage['minutes']; services: PickerService[]; open: boolean; busy: boolean; onGrant: (body: Record<string, unknown>) => void }) {
  const [reason, setReason] = useState('Work with Claude');
  const [length, setLength] = useState(String(limits.presets.includes(30) ? 30 : limits.presets[0] ?? limits.min));
  const [other, setOther] = useState('');
  const minutes = length === 'other' ? other : length;
  const bad = minutesError(minutes, limits);
  const blocked = reason.trim() === '' ? 'Say what the pass is for.' : bad;
  return (
    <Container title="Switch a pass on" icon="plus" collapsible defaultOpen={open}>
      <div className="axp-gate__cover" data-axf-pass-grant>
        <TextField label="What for" value={reason} onChange={setReason} placeholder="Work with Claude" required />
        <div className="axp-gate__bar">
          <Segmented<string> label={`How long (${lengthLabel(limits.min)} to ${lengthLabel(limits.max)})`} value={length} onChange={setLength}
            options={[...limits.presets.map((m) => ({ value: String(m), label: lengthLabel(m) })), { value: 'other', label: 'Other' }]} />
          {length === 'other' && <TextField label="Minutes" type="number" value={other} onChange={setOther} error={other && bad ? bad : undefined} hint={`${limits.min} to ${limits.max}.`} />}
        </div>
        <Coverage id="new" services={services} busy={busy} blocked={blocked} submit="Switch the pass on"
          onSubmit={(c) => onGrant(grantBody({ ...c, minutes, reason }))} />
      </div>
    </Container>
  );
}

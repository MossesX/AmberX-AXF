/**
 * Account checks (build account-health-failover, Nov 8 2026): what the last health check found for every Claude account
 * (the ONE shared store, account-status@1): ok / limited / no credits / login expired, 5-hour and weekly use left with
 * resets, API spend against its caps, the models it can use now, when it was checked. Check now asks the host (it starts
 * within a minute). Settings in collapsible sections: when to check, phone notifications. Layout = one of three settings
 * assets (the UI Review options); every control a framework control, every value a token.
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import cards from '../assets/settings/claude-accounts-checks-cards.json';
import sectionsAsset from '../assets/settings/claude-accounts-checks-sections.json';
import compactAsset from '../assets/settings/claude-accounts-checks-compact.json';

const FOLDER = 'claude-accounts';
export const CHECKS_VIEW_KEY = 'axf.claude-accounts.checks.view';
export const CHECKS_ASSETS = [cards, sectionsAsset, compactAsset] as const;

type Status = 'ok' | 'limited' | 'no-credits' | 'expired' | 'unknown';
interface Window { used: number; left: number; resetsAt: string }
export interface Health {
  name: string; label?: string; kind?: 'subscription' | 'api'; email?: string; status: Status; why?: string; warn?: boolean; checkedAt?: string; source?: string; until?: string;
  login?: { valid: boolean | null; expiresAt: string };
  usage?: { fiveHour: Window | null; weekly: Window | null; perModel: { model: string; used: number; resetsAt: string }[]; extra: { enabled: boolean; usedUsd: number; limitUsd: number } | null };
  api?: { spendDay: number; spendWeek: number; capDay: number; capWeek: number; left: number | null } | null;
  models?: string[] | null; probe?: { ms: number; costUsd: number } | null;
}
interface Settings { enabled: boolean; intervalMin: number; onLoad: boolean; loadGapMin: number; session: boolean; apiMessage: boolean; timeoutSec: number; notifyRuns: 'load' | 'all' | 'off'; alertProblems: boolean }
interface Checks {
  ok: boolean; settings: Settings; summary: { text: string; counts: Record<string, number> };
  store: { updatedAt: string; run: { trigger: string; state: string; startedAt: string; finishedAt: string; costUsd: number } | null; accounts: Record<string, Health> };
  request: { trigger: string; at: string; by: string } | null;
}

export const STATUS_LABEL: Record<Status, string> = { ok: 'OK', limited: 'Limited', 'no-credits': 'No credits', expired: 'Login expired', unknown: 'Not checked' };
export const STATUS_TONE: Record<Status, 'success' | 'warning' | 'danger' | undefined> = { ok: 'success', limited: 'warning', 'no-credits': 'danger', expired: 'danger', unknown: undefined };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await pluginFetch(FOLDER, path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string; message?: string; ok?: boolean };
  if (!r.ok || j.ok === false) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
  return j;
}

/** Ask the host for a check when a console opens (the server skips it inside the gap or when it is switched off). */
export function checkOnLoad(): void {
  void call('checks', { trigger: 'load' }).catch(() => undefined);
}

function useChecks() {
  const [data, setData] = useState<Checks | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => call<Checks>('checks').then((d) => { setData(d); setError(''); }, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void refresh();
    // faster while a check is asked for or running, so the result lands without a tap
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, error, refresh };
}

/** One line of what an account has left. */
export function leftLine(h: Health): string {
  const parts: string[] = [];
  if (h.kind === 'api') {
    if (h.api) parts.push(`$${h.api.spendDay.toFixed(2)} today${h.api.capDay ? ` of $${h.api.capDay}` : ''}`, ...(h.api.capWeek ? [`$${h.api.spendWeek.toFixed(2)} of $${h.api.capWeek} this week`] : []));
  } else {
    if (h.usage?.fiveHour) parts.push(`5-hour ${h.usage.fiveHour.left}% left`);
    if (h.usage?.weekly) parts.push(`week ${h.usage.weekly.left}% left${h.usage.weekly.resetsAt ? ` (resets ${when(h.usage.weekly.resetsAt)})` : ''}`);
    for (const m of h.usage?.perModel ?? []) if (m.used >= 50) parts.push(`${m.model} week ${Math.max(0, 100 - m.used)}% left`);
  }
  if ((h.status === 'limited' || h.status === 'no-credits') && h.until) parts.push(`back ${when(h.until)}`);
  return parts.join(' · ');
}

function AccountRow({ h, line, busy, onCheck }: { h: Health; line: boolean; busy: boolean; onCheck: () => void }) {
  const models = Array.isArray(h.models) ? (h.models.length ? h.models.join(', ') : 'none') : 'not known';
  return (
    <div className="axp-ca-row" data-account={h.name} data-health={h.status}>
      <div className="axp-ca-row__who">
        <b>{h.label || h.name}</b>{h.label && <span className="axp-ca-row__sub"> · {h.name}</span>}
        {line ? <span className="axp-ca-row__sub"> · {leftLine(h) || h.why}</span> : (
          <>
            {h.email && <p className="axp-ca-row__sub">{h.email}</p>}
            {leftLine(h) && <p className="axp-ca-row__sub">{leftLine(h)}</p>}
            <p className="axp-ca-row__sub">Models: {models}{h.checkedAt ? ` · checked ${when(h.checkedAt)}${h.source === 'failover' ? ' (a build stopped on it)' : ''}` : ''}</p>
            {h.status !== 'ok' && h.why && <p className="axp-ca-row__sub">{h.why}</p>}
          </>
        )}
      </div>
      <div className="axp-ca-row__actions">
        {h.warn && h.status === 'ok' && <Chip tone="warning">Near a limit</Chip>}
        <Chip tone={STATUS_TONE[h.status]}>{STATUS_LABEL[h.status]}</Chip>
        {!line && <Button size="sm" tone="ghost" icon="refresh" busy={busy} disabled={busy} onClick={onCheck}>Check</Button>}
      </div>
    </div>
  );
}

function StatusNow({ data, refresh, line }: { data: Checks; refresh: () => unknown; line: boolean }) {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = (accounts: string[] = []) => {
    setBusy(true); setSaid(null);
    call<{ queued: boolean; message?: string; skipped?: string }>('checks', { trigger: 'manual', accounts })
      .then((r) => { setSaid({ text: r.queued ? r.message || 'Asked.' : `Not now: ${r.skipped}`, bad: !r.queued }); return refresh(); }, (e: Error) => setSaid({ text: e.message, bad: true }))
      .finally(() => setBusy(false));
  };
  const rows = Object.values(data.store.accounts);
  const run = data.store.run;
  return (
    <div className="fx-stack">
      <div className="axp-ca-save">
        <p className="axp-ca-help">
          {run ? `Last check ${when(run.finishedAt || run.startedAt)} (${run.trigger === 'load' ? 'console opened' : run.trigger === 'schedule' ? 'scheduled' : run.trigger === 'failover' ? 'a build stopped' : 'by hand'})${run.costUsd ? ` · $${run.costUsd.toFixed(4)}` : ''}${run.state === 'running' ? ' · running now' : ''}` : 'Never checked yet.'}
          {data.request ? ` · a check is asked for (${when(data.request.at)}), it starts within a minute` : ''}
        </p>
        <Button tone="primary" icon="refresh" busy={busy} disabled={busy || !!data.request} onClick={() => check()}>Check now</Button>
      </div>
      {said && <Note tone={said.bad ? 'warning' : 'info'}>{said.text}</Note>}
      {rows.length ? <div>{rows.map((h) => <AccountRow key={h.name} h={h} line={line} busy={busy} onCheck={() => check([h.name])} />)}</div>
        : <p className="axp-ca-help">No account checked yet. Check now, or wait for the next scheduled check.</p>}
    </div>
  );
}

function useSave(refresh: () => unknown) {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (patch: Partial<Settings>) => {
    setBusy(true); setSaid(null);
    return call('checks/settings', patch).then(() => { setSaid({ text: 'Saved.', bad: false }); return refresh(); }, (e: Error) => setSaid({ text: e.message, bad: true })).finally(() => setBusy(false));
  };
  return { busy, save, note: said ? <Note tone={said.bad ? 'danger' : 'info'}>{said.text}</Note> : null };
}

function Schedule({ data, refresh }: { data: Checks; refresh: () => unknown }) {
  const f = data.settings;
  const s = useSave(refresh);
  const [every, setEvery] = useState(String(f.intervalMin));
  const [gap, setGap] = useState(String(f.loadGapMin));
  useEffect(() => { setEvery(String(f.intervalMin)); setGap(String(f.loadGapMin)); }, [f.intervalMin, f.loadGapMin]);
  return (
    <div className="fx-stack">
      <Switch label="Check every account on a schedule" hint="A tiny check per account: about a tenth of a cent each, nothing extra on a subscription. Builds only go to an account the last check says can take them."
        checked={f.enabled} disabled={s.busy} onChange={(v) => void s.save({ enabled: v })} />
      <Switch label="Check when a console opens" hint="Skipped when the last check is newer than the gap below." checked={f.onLoad} disabled={s.busy} onChange={(v) => void s.save({ onLoad: v })} />
      <div className="axp-ca-save">
        <TextField label="Check every (minutes)" value={every} hint="10 to 1440" disabled={s.busy || !f.enabled} onChange={(v) => setEvery(v.trim())} />
        <TextField label="Gap after a check (minutes)" value={gap} hint="0 to 240: a console opening sooner doesn't check again" disabled={s.busy || !f.onLoad} onChange={(v) => setGap(v.trim())} />
        <Button tone="primary" icon="save" busy={s.busy} disabled={s.busy || (String(f.intervalMin) === every && String(f.loadGapMin) === gap)}
          onClick={() => void s.save({ intervalMin: Number(every), loadGapMin: Number(gap) })}>Save</Button>
      </div>
      <Switch label="Prove each subscription login with a tiny session" hint="A bare one-line Claude session (no rules, no CLAUDE.md, no MCP, no tools) that also renews the login's token. Off = only the free usage read, which can't see a login that died."
        checked={f.session} disabled={s.busy} onChange={(v) => void s.save({ session: v })} />
      <Switch label="Prove each API key with a 1-token message" hint="About $0.0001. The only way to see an API key that is out of credits; off = only the free models list."
        checked={f.apiMessage} disabled={s.busy} onChange={(v) => void s.save({ apiMessage: v })} />
      {s.note}
    </div>
  );
}

const NOTIFY_OPTIONS = [
  { value: 'load', label: 'When a console opens or I check by hand' },
  { value: 'all', label: 'Every check, scheduled ones too' },
  { value: 'off', label: 'Never' },
];

function Notify({ data, refresh }: { data: Checks; refresh: () => unknown }) {
  const f = data.settings;
  const s = useSave(refresh);
  return (
    <div className="fx-stack">
      <SelectField label="Phone notification before and after a check" value={f.notifyRuns} options={NOTIFY_OPTIONS} disabled={s.busy}
        hint="AmberX: &quot;checking 4 Claude accounts&quot;, then one line per account (ok, limited, no credits, login expired, what's left, models) and what to do. Type account-status in the Notifications panel."
        onChange={(v) => void s.save({ notifyRuns: v as Settings['notifyRuns'] })} />
      <Switch label="Alert when a check finds an account down" hint="Login expired, limited or out of credits: one phone alert per problem, closed by itself when the account works again."
        checked={f.alertProblems} disabled={s.busy} onChange={(v) => void s.save({ alertProblems: v })} />
      {s.note}
    </div>
  );
}

const TITLE: Record<string, string> = { status: 'Account status', schedule: 'When to check', notify: 'Phone notifications' };
const ICON: Record<string, string> = { status: 'key', schedule: 'clock', notify: 'bell' };

export function AccountChecks() {
  const { data, error, refresh } = useChecks();
  const rt = useRuntime();
  const id = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(CHECKS_VIEW_KEY) ?? ''), () => '');
  const asset = CHECKS_ASSETS.find((a) => a.id === id) ?? cards;
  if (error) return <Note tone="danger">Account checks unavailable: {error}</Note>;
  if (!data) return <p className="axp-ca-help">Reading the account checks…</p>;
  const line = asset.data.view === 'compact';
  const body: Record<string, ReactNode> = {
    status: <StatusNow data={data} refresh={refresh} line={line} />, schedule: <Schedule data={data} refresh={refresh} />, notify: <Notify data={data} refresh={refresh} />,
  };
  const open = new Set<string>(asset.data.open);
  const down = Object.values(data.store.accounts).filter((h) => h.status === 'expired' || h.status === 'no-credits');
  return (
    <div className="fx-stack" data-axf-checks-view={asset.data.view}>
      <Note tone={down.length ? 'danger' : 'info'}>
        {data.summary.text}{down.length ? `. ${down.map((h) => `${h.label || h.name}: ${STATUS_LABEL[h.status].toLowerCase()}`).join('; ')}: builds skip ${down.length > 1 ? 'them' : 'it'}.` : '.'}
      </Note>
      <div className="axp-ca-save">
        <SelectField label="Layout" value={asset.id} options={CHECKS_ASSETS.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => rt.settings.set(CHECKS_VIEW_KEY, v)} hint={asset.description} />
        <Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Refresh</Button>
      </div>
      {asset.data.view === 'cards'
        ? <>
            {body.status}
            {asset.data.order.filter((k) => k !== 'status').map((k) => <Container key={`cards-${k}`} title={TITLE[k]} icon={ICON[k]} collapsible defaultOpen={open.has(k)} className={`axp-ca-section axp-ca-section--${k}`}>{body[k]}</Container>)}
          </>
        : asset.data.order.map((k) => (
          <Container key={`${asset.data.view}-${k}`} title={TITLE[k]} icon={ICON[k]} collapsible defaultOpen={open.has(k)} className={`axp-ca-section axp-ca-section--${k}`}>{body[k]}</Container>
        ))}
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, useBannerLaunchOpen, useRuntime } from '@console/axf/react';
import * as api from '@console/api';
import { StepList } from '@console/commandText';
import './systems-check.css';

/*
 * Systems check plugin (server/__init__.py): runs every time the console loads. When something the console or its features
 * need is missing or broken, a banner appears at the top of every view. Clicking its summary drops down the issues;
 * clicking the banner's button or an issue opens the dialog: Grid (expandable rows: details, fix, instructions, links),
 * By service (cards per system) and Guided setup (one issue at a time, in dependency order), plus "Fix all".
 * Credentials typed here go to the server only and are never sent back.
 */

type Status = 'ok' | 'warn' | 'error' | 'info' | 'unknown';
interface Field { key: string; label: string; secret: boolean; placeholder: string; help: string; set: boolean; value: string }
type Fix = { type: 'secrets'; fields: Field[] } | { type: 'action'; label: string } | { type: 'host'; command: string } | { type: 'settings'; tab: string; label: string } | null;
export interface Check { id: string; service: string; title: string; status: Status; summary: string; details: string[]; fix: Fix; instructions: string[]; links: { label: string; url: string }[]; dependsOn: string[]; order: number; autoFix: boolean }
interface Service { id: string; label: string; icon: string; description: string }
interface RoutineInfo { source: string; generatedAt: number; checks: number; stale: boolean }
interface Report { at: number; services: Service[]; checks: Check[]; hostScript: string; counts: Record<Status, number>; routine?: RoutineInfo | null; aiOn?: boolean; aiNote?: string | null }
type Run = 'queued' | 'working' | 'waiting' | 'done' | 'failed' | 'needs-you' | 'skipped';
type Answer = 'done' | 'skip' | 'stop' | 'ok';
interface Prompt { id: string; index: number; total: number; note: string }

/* ---------------- shared store (banner + dialog) ---------------- */
const st: { report: Report | null; loading: boolean; error: string; unauthorized: boolean; run: Record<string, Run>; runMsg: Record<string, string>; fixing: boolean; dismissed: boolean; prompt: Prompt | null; aiBusy: boolean; aiError: string; fixedUntil: Record<string, number> } =
  { report: null, loading: false, error: '', unauthorized: false, run: {}, runMsg: {}, fixing: false, dismissed: false, prompt: null, aiBusy: false, aiError: '', fixedUntil: {} };
/** Checks Mosses wrote (the AI routine) run with ids `routine:<id>`; everything else comes from reading the codebase. */
export const isAiCheck = (c: Check) => c.id.startsWith('routine:');
/**
 * Source badge, an icon only: a sparkle for anything a model made (Mosses's routine checks, What's new summaries), a
 * code icon for anything read from the codebase and settings without AI. The words are in its tooltip and label.
 */
export function SourceBadge({ ai, title }: { ai: boolean; title?: string }) {
  const t = title ?? (ai ? AI_CHECK : CODE_CHECK);
  return <span className={`axp-systems-check-src ${ai ? 'is-ai' : 'is-code'}`} title={t} role="img" aria-label={t}><Icon name={ai ? 'sparkles' : 'code'} size={11} /></span>;
}
const AI_CHECK = 'Made by AI: Mosses added this check (saved routine; it runs without a model).';
const CODE_CHECK = 'Not AI: this check comes from reading the codebase and settings.';

/** Fix all waits here while it prompts you for an issue it can't fix alone. */
let promptResolve: ((a: Answer) => void) | null = null;
export function answerPrompt(a: Answer) { const r = promptResolve; promptResolve = null; r?.(a); }
let snap = { ...st };
const subs = new Set<() => void>();
const emit = () => { snap = { ...st }; subs.forEach((f) => f()); };
/** How long a fixed item stays in the banner's drop-down showing "Fixed" before it leaves (Brett, Oct 20 2026). */
export const FIXED_LINGER_MS = 3000;
/** Mark a check fixed: it keeps its row (with the Fixed badge) for FIXED_LINGER_MS, then drops out of the banner. */
function markFixed(id: string) {
  st.fixedUntil = { ...st.fixedUntil, [id]: Date.now() + FIXED_LINGER_MS };
  setTimeout(() => {
    if ((st.fixedUntil[id] ?? 0) > Date.now()) return; // fixed again since: its own timer clears it
    const { [id]: _gone, ...rest } = st.fixedUntil; st.fixedUntil = rest;
    if (st.run[id] === 'done') { const { [id]: _r, ...run } = st.run; st.run = run; const { [id]: _m, ...msg } = st.runMsg; st.runMsg = msg; }
    emit();
  }, FIXED_LINGER_MS + 50);
}
export const useSys = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap, () => snap);

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = api.getToken();
  if (t) headers.set('authorization', `Bearer ${t}`);
  if (init.body) headers.set('content-type', 'application/json');
  const r = await fetch(`/api/plugins/systems-check/${path}`, { ...init, headers, cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string };
  if (r.status === 401) { st.unauthorized = true; emit(); throw new Error('Set the console token first.'); }
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
  return j;
}

export async function loadSystemCheck(force = false) {
  if (!api.isBackendUp()) return;
  st.loading = true; emit();
  try { st.report = await call<Report>(`check${force ? '?force=1' : ''}`); st.error = ''; st.unauthorized = false; }
  catch (e) { st.error = (e as Error).message; }
  st.loading = false; emit();
  const r = st.report;
  if (force && r?.aiOn && (!r.routine || r.routine.stale) && !st.aiBusy) void refreshRoutine();
}

/** With AI on: Mosses reads the codebase and refreshes the saved routine (only when the code changed), then re-checks. */
export async function refreshRoutine() {
  st.aiBusy = true; st.aiError = ''; emit();
  try { await call('routine/run', { method: 'POST' }); st.report = await call<Report>('check?force=1'); }
  catch (e) { st.aiError = (e as Error).message; }
  st.aiBusy = false; emit();
}
function replace(c: Check) {
  if (!st.report) return;
  st.report = { ...st.report, checks: st.report.checks.map((x) => (x.id === c.id ? c : x)) };
  st.report.counts = (['ok', 'warn', 'error', 'info', 'unknown'] as Status[]).reduce((a, s) => ({ ...a, [s]: st.report!.checks.filter((x) => x.status === s).length }), {} as Record<Status, number>);
  // a prompted issue that now passes (e.g. you saved a working token) lets Fix all carry on by itself
  if (st.prompt?.id === c.id && (c.status === 'ok' || c.status === 'info')) answerPrompt('ok');
  emit();
}
export const recheck = async (id: string) => { const c = await call<Check>(`check/${id}`, { method: 'POST' }); replace(c); return c; };
const isIssue = (c: Check) => c.status === 'error' || c.status === 'warn';
/** Issues, with host checks the VPS hasn't reported folded into the single "host report" item. */
export function issues(r: Report | null) {
  if (!r) return [];
  const hostMissing = r.checks.some((c) => c.id === 'host-report' && c.status !== 'ok');
  return r.checks.filter((c) => isIssue(c) && !(hostMissing && c.dependsOn.includes('host-report') && c.status === 'unknown'));
}
/** A missing or refused key/password: it has a paste-it-here form. These get the Keys banner of their own. */
export const isKeyIssue = (c: Check) => c.fix?.type === 'secrets';
/** Dependency order (a check's dependsOn first), then each check's order. */
export function guidedOrder(list: Check[]) {
  const ids = new Set(list.map((c) => c.id));
  const out: Check[] = []; const seen = new Set<string>();
  const visit = (c: Check, all: Map<string, Check>) => { if (seen.has(c.id)) return; seen.add(c.id); for (const d of c.dependsOn) { const dc = all.get(d); if (dc && ids.has(d)) visit(dc, all); } out.push(c); };
  const all = new Map(list.map((c) => [c.id, c]));
  [...list].sort((a, b) => a.order - b.order).forEach((c) => visit(c, all));
  return out;
}

/**
 * Fix all: one issue at a time. Automatic fixes run by themselves; an issue that needs you (a credential, a
 * command on the VPS, a setting) pauses the run with a prompt: Done (check it and continue), Skip, or Stop.
 * Badges: queued → working → completed / failed / skipped, "waiting for you" while it prompts.
 */
export async function fixAll() {
  if (st.fixing || !st.report) return;
  const queue = guidedOrder(issues(st.report));
  st.fixing = true; st.prompt = null; st.run = Object.fromEntries(queue.map((c) => [c.id, 'queued' as Run])); st.runMsg = {}; emit();
  const set = (id: string, r: Run, msg?: string) => { st.run = { ...st.run, [id]: r }; if (msg !== undefined) st.runMsg = { ...st.runMsg, [id]: msg }; if (r === 'done') markFixed(id); emit(); };
  const passes = (c: Check) => c.status === 'ok' || c.status === 'info';
  let stopped = false;
  for (let k = 0; k < queue.length && !stopped; k++) {
    const c = queue[k]!;
    set(c.id, 'working');
    try {
      if (c.autoFix) { const r = await call<{ message: string; check: Check }>(`fix/${c.id}`, { method: 'POST' }); st.runMsg[c.id] = r.message; }
      await new Promise((res) => setTimeout(res, 350)); // let the badge show
      let after = await recheck(c.id);
      if (passes(after)) { set(c.id, 'done'); continue; }
      if (!after.fix || after.fix.type === 'action') { set(c.id, 'failed', after.summary); continue; }
      // needs you: prompt, then check again; repeat until it passes, you skip, or you stop
      let note = after.fix.type === 'secrets' ? 'Paste the credential below and press Save & test; Fix all continues as soon as it passes.'
        : after.fix.type === 'host' ? 'Run the command on the VPS (mosh or ssh), then press Done.' : 'Change the setting, then press Done.';
      for (;;) {
        set(c.id, 'waiting', note);
        st.prompt = { id: c.id, index: k + 1, total: queue.length, note }; emit();
        const a = await new Promise<Answer>((res) => { promptResolve = res; });
        st.prompt = null; emit();
        if (a === 'stop') { stopped = true; set(c.id, 'skipped', 'Fix all was stopped here.'); break; }
        if (a === 'skip') { set(c.id, 'skipped', 'Skipped: fix it later from its row.'); break; }
        set(c.id, 'working');
        after = a === 'ok' ? (snap.report?.checks.find((x) => x.id === c.id) ?? after) : await recheck(c.id);
        if (passes(after)) { set(c.id, 'done', a === 'ok' ? 'Passes now.' : 'Checked: passes now.'); break; }
        note = `Still not passing: ${after.summary}`;
      }
    } catch (e) { set(c.id, 'failed', (e as Error).message); }
  }
  if (stopped) for (const c of queue) if (st.run[c.id] === 'queued') st.run = { ...st.run, [c.id]: 'skipped' };
  st.fixing = false; st.prompt = null; promptResolve = null; emit();
}

/* ---------------- Auto fix (banner drop-down) ---------------- */

/** What Auto fix does for a check, or null when it needs you (a VPS command is copied instead). */
/** VPS checks Auto fix can run through axHub (filled from the server; the rest copy their command). */
let hostAuto = new Set<string>();
let hostAutoLoaded = false;
async function loadHostAuto() {
  if (hostAutoLoaded) return;
  hostAutoLoaded = true;
  try { const r = await call<{ commands: Record<string, string> }>('autofix'); hostAuto = new Set(Object.keys(r.commands)); emit(); } catch { hostAutoLoaded = false; }
}
/** Is Claude connected? (the plugin's AI connection test, `GET ai/state`, cached on the server for 5 minutes) */
let claudeOk: boolean | null = null;
let claudeLoading = false;
function loadClaude() {
  if (claudeOk !== null || claudeLoading) return;
  claudeLoading = true;
  call<{ ok: boolean }>('ai/state').then((x) => { claudeOk = !!x.ok; }, () => { claudeOk = false; }).finally(() => { claudeLoading = false; emit(); });
}
export const claudeConnected = () => { loadClaude(); return claudeOk === true; };

/** With Claude connected, an issue no built-in fix covers goes to Mosses in the assistant: it gets the check's details
 *  and works through approval cards (container changes) and axHub approvals (VPS commands) — nothing runs unapproved. */
function claudeFix(c: Check, rt: ReturnType<typeof useRuntime>) {
  const parts = [
    `Fix this AXF Dev Console setup issue: **${c.title}** (${c.status}).`, c.summary,
    c.details.length ? `Details:\n- ${c.details.join('\n- ')}` : '',
    c.instructions.length ? `How it's fixed by hand:\n- ${c.instructions.join('\n- ')}` : '',
    c.fix?.type === 'host' ? `Command for the VPS:\n\n    ${c.fix.command}\n\nRun VPS commands through axHub (vps.run) so Brett approves them first.` : '',
    'Propose every change through approval cards; never change anything without approval. When done, say what you did so the check can be re-run.',
  ].filter(Boolean);
  rt.dispatch(`ai.chat.start:${encodeURIComponent(JSON.stringify({ agentId: 'coder', title: `Fix: ${c.title}`, message: parts.join('\n\n') }))}`);
  st.runMsg = { ...st.runMsg, [c.id]: 'Handed to Claude: approve its changes in the chat' }; emit();
}

export const autoFixLabel = (c: Check) => {
  void loadHostAuto();
  if (claudeConnected()) return 'Auto fix'; // Brett, Oct 20 2026: every issue gets Auto fix while Claude is connected
  return c.fix?.type === 'action' ? 'Auto fix' : c.fix?.type === 'secrets' ? 'Add key' : c.fix?.type === 'settings' ? 'Open'
    : c.fix?.type === 'host' ? (hostAuto.has(c.id) ? 'Auto fix' : 'Copy fix') : null;
};

interface HostJob { state: 'asking' | 'waiting' | 'running' | 'done' | 'failed'; message: string }
/** VPS fix: the hub runs the check's exact command once you approve it in the pop-up; we follow the job here. */
async function hostAutoFix(c: Check, rt: ReturnType<typeof useRuntime>): Promise<void> {
  st.run[c.id] = 'working'; st.runMsg[c.id] = 'Asking axHub…'; emit();
  try {
    let j = await call<HostJob>(`autofix/${c.id}`, { method: 'POST' });
    const until = Date.now() + 31 * 60_000;
    while ((j.state === 'asking' || j.state === 'waiting' || j.state === 'running') && Date.now() < until) {
      st.run[c.id] = j.state === 'waiting' ? 'waiting' : 'working'; st.runMsg[c.id] = j.message; emit();
      await new Promise((r) => setTimeout(r, 3000));
      const all = await call<{ jobs: Record<string, HostJob | null> }>('autofix');
      j = all.jobs[c.id] ?? j;
    }
    st.run[c.id] = j.state === 'done' ? 'done' : 'failed'; st.runMsg[c.id] = j.message; if (j.state === 'done') markFixed(c.id); emit();
    rt.toast(`${c.title}: ${j.message}`, j.state === 'done' ? 'success' : 'warning');
    await loadSystemCheck(true);
  } catch (e) { st.run[c.id] = 'failed'; st.runMsg[c.id] = (e as Error).message; emit(); rt.toast(`${c.title}: ${(e as Error).message}`, 'danger'); }
}

export async function autoFix(c: Check, rt: ReturnType<typeof useRuntime>): Promise<void> {
  const f = c.fix;
  if (!f) { if (claudeConnected()) claudeFix(c, rt); return; }
  if (f.type === 'secrets') { rt.openDialog('keys-needed', {}); return; }
  if (f.type === 'settings') { rt.dispatch(`settings.open:${f.tab}`); return; }
  if (f.type === 'host' && hostAuto.has(c.id)) { await hostAutoFix(c, rt); return; }
  if (f.type !== 'action' && claudeConnected()) { claudeFix(c, rt); return; }
  if (f.type === 'host') {
    await navigator.clipboard?.writeText(f.command).then(() => rt.toast('Fix command copied: run it on the VPS (mosh or the console terminal)', 'info'), () => rt.toast(f.command, 'info'));
    return;
  }
  st.run[c.id] = 'working'; st.runMsg[c.id] = ''; emit();
  try {
    const r = await call<{ message: string; check: Check }>(`fix/${c.id}`, { method: 'POST' });
    replace(r.check);
    st.run[c.id] = r.check.status === 'ok' || r.check.status === 'info' ? 'done' : 'failed'; st.runMsg[c.id] = r.message;
    if (st.run[c.id] === 'done') markFixed(c.id);
    rt.toast(`${c.title}: ${r.message}`, st.run[c.id] === 'done' ? 'success' : 'warning');
  } catch (e) { st.run[c.id] = 'failed'; st.runMsg[c.id] = (e as Error).message; rt.toast(`${c.title}: ${(e as Error).message}`, 'danger'); }
  emit();
}

/* ---------------- banner ---------------- */

export function SystemBanner() {
  const s = useSys();
  const rt = useRuntime();
  // Launches expanded; "_" folds it to its one-line summary (Brett, Oct 21 2026: error banners minimize, they don't close).
  const [open, setOpen] = useBannerLaunchOpen();
  // Issues, plus anything just fixed: it stays (badge "Fixed") for FIXED_LINGER_MS so you see it worked, then leaves.
  const list = useMemo(() => {
    const open = issues(s.report).filter((c) => !isKeyIssue(c));
    const ids = new Set(open.map((c) => c.id));
    const fixed = (s.report?.checks ?? []).filter((c) => s.fixedUntil[c.id] && !ids.has(c.id) && !isKeyIssue(c));
    return [...open, ...fixed];
  }, [s.report, s.fixedUntil]);
  const openCount = list.filter((c) => !s.fixedUntil[c.id] || isIssue(c)).length;
  if (s.dismissed) return null;
  if (s.unauthorized) {
    return (
      <div className="axp-systems-check-banner is-warn" role="alert">
        <Icon name="lock" /><span className="axp-systems-check-banner__text">Set the console token to run the systems check.</span>
        <Button tone="primary" onClick={() => rt.openDialog('token')}>Set token</Button>
      </div>
    );
  }
  if (s.prompt) {
    const c = s.report?.checks.find((x) => x.id === s.prompt!.id);
    return (
      <div className="axp-systems-check-banner is-warn" role="alert">
        <div className="axp-systems-check-banner__row">
          <RunBadge r="waiting" /><span className="axp-systems-check-banner__text">Fix all is waiting for you: {c?.title ?? s.prompt.id} (step {s.prompt.index} of {s.prompt.total})</span>
          <Button tone="primary" icon="settings" onClick={() => rt.openDialog('system-check')}>Continue</Button>
        </div>
      </div>
    );
  }
  if (!s.report || list.length === 0) return null;
  const errors = list.filter((c) => c.status === 'error').length;
  return (
    <div className={`axp-systems-check-banner ${errors ? 'is-error' : 'is-warn'}`} role="alert">
      <div className="axp-systems-check-banner__row">
        <Icon name="alert" />
        <button type="button" className="axp-systems-check-banner__text" aria-expanded={open} onClick={() => setOpen(!open)}>
          {openCount ? <>{openCount} setup issue{openCount === 1 ? '' : 's'}{errors ? ` (${errors} blocking)` : ''}: the console isn't fully configured</> : <>All fixed</>}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
        <Button tone="primary" icon="settings" onClick={() => rt.openDialog('system-check')}>Fix…</Button>
        {open && <button type="button" className="fx-iconbtn" aria-label="Minimize" title="Minimize to one line" onClick={() => setOpen(false)}><Icon name="minimize" size={16} /></button>}
      </div>
      {open && (
        <ul className="axp-systems-check-banner__list">
          {list.some((c) => c.fix?.type === 'action') && (
            <li className="axp-systems-check-banner__fixall">
              <ActBadge icon="zap" label={`Auto fix all (${list.filter((c) => c.fix?.type === 'action').length})`} disabled={list.some((c) => s.run[c.id] === 'working')} onClick={() => void (async () => { for (const c of list.filter((x) => x.fix?.type === 'action')) await autoFix(c, rt); })()} />
            </li>
          )}
          {guidedOrder(list).map((c) => {
            const label = autoFixLabel(c);
            return (
              <li key={c.id} className="axp-systems-check-banner__li">
                <button type="button" className="axp-systems-check-banner__item" onClick={() => rt.openDialog('system-check', { focus: c.id })}>
                  <StatusDot s={c.status} /><span className="axp-systems-check-banner__title">{c.title}</span><SourceBadge ai={isAiCheck(c)} /><span className="axp-systems-check-banner__sum">{s.runMsg[c.id] || c.summary}</span>
                </button>
                {s.run[c.id] === 'working' || s.run[c.id] === 'waiting' || (s.fixedUntil[c.id] && !isIssue(c))
                  ? <RunBadge r={s.fixedUntil[c.id] && !isIssue(c) ? 'done' : s.run[c.id]} />
                  : label
                    ? <ActBadge icon={fixIcon(c)} label={label} onClick={() => void autoFix(c, rt)} />
                    : claudeConnected()
                      ? <ActBadge icon="zap" label="Auto fix" onClick={() => void autoFix(c, rt)} />
                      : <ActBadge icon="settings" label="Fix…" onClick={() => rt.openDialog('system-check', { focus: c.id })} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Mount once in the shell: runs the check when the console loads and when the token changes. */
export function useSystemCheckOnLoad() {
  useEffect(() => {
    const t = setTimeout(() => void loadSystemCheck(true), 400); // after the backend health check
    const onToken = () => void loadSystemCheck(true);
    globalThis.addEventListener(api.TOKEN_CHANGED, onToken);
    return () => { clearTimeout(t); globalThis.removeEventListener(api.TOKEN_CHANGED, onToken); };
  }, []);
}

/* ---------------- bits ---------------- */

const STATUS_LABEL: Record<Status, string> = { ok: 'OK', warn: 'Warning', error: 'Blocking', info: 'Info', unknown: 'Not checked' };
export function StatusDot({ s }: { s: Status }) { return <span className={`axp-systems-check-dot is-${s}`} title={STATUS_LABEL[s]} aria-label={STATUS_LABEL[s]} />; }
function StatusChip({ s }: { s: Status }) { return <Chip tone={s === 'ok' ? 'success' : s === 'error' ? 'danger' : s === 'warn' ? 'warning' : undefined}>{STATUS_LABEL[s]}</Chip>; }
const RUN_LABEL: Record<Run, string> = { queued: 'Queued', working: 'Working', waiting: 'Waiting for you', done: 'Completed', failed: 'Failed', 'needs-you': 'Needs you', skipped: 'Skipped' };
/** A small action badge (icon + a word) for the banner's drop-down rows: same height as the run badges. */
function ActBadge({ icon, label, onClick, disabled, title }: { icon: string; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return <button type="button" className="axp-systems-check-act" disabled={disabled} title={title ?? label} onClick={onClick}><Icon name={icon} size={11} />{label}</button>;
}
const fixIcon = (c: Check) => (claudeConnected() ? 'zap' : c.fix?.type === 'host' && !hostAuto.has(c.id) ? 'copy' : c.fix?.type === 'secrets' ? 'key' : c.fix?.type === 'settings' ? 'settings' : 'zap');

function RunBadge({ r }: { r?: Run }) {
  if (!r) return null;
  return <span className={`axp-systems-check-run is-${r}`} role="status">{r === 'working' ? <span className="axp-systems-check-run__spin" aria-hidden /> : <Icon name={r === 'done' ? 'check' : r === 'failed' ? 'x' : r === 'needs-you' || r === 'waiting' ? 'alert' : r === 'skipped' ? 'minus' : 'clock'} size={12} />}{RUN_LABEL[r]}</span>;
}

export function FixPanel({ c }: { c: Check }) {
  const rt = useRuntime();
  const s = useSys();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => rt.toast('Command copied', 'success'), () => rt.toast('Clipboard blocked', 'warning'));
  const save = async () => {
    if (c.fix?.type !== 'secrets') return;
    setBusy(true); setMsg('');
    try {
      for (const f of c.fix.fields) {
        const v = (vals[f.key] ?? '').trim();
        if (!v) continue;
        const r = await call<{ checks: Check[] }>('secret', { method: 'POST', body: JSON.stringify({ key: f.key, value: v }) });
        r.checks.forEach(replace);
      }
      setVals({}); const now = snap.report?.checks.find((x) => x.id === c.id);
      setMsg(now?.status === 'ok' ? 'Saved and verified.' : `Saved. ${now?.summary ?? ''}`);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const clear = async (key: string) => { setBusy(true); try { (await call<{ checks: Check[] }>('secret/clear', { method: 'POST', body: JSON.stringify({ key }) })).checks.forEach(replace); setMsg('Removed.'); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  const again = async () => { setBusy(true); try { const n = await recheck(c.id); setMsg(n.status === 'ok' ? 'Passes now.' : n.summary); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  const f = c.fix;
  return (
    <div className="axp-systems-check-fix">
      {f?.type === 'secrets' && (
        <form className="axp-systems-check-fix__form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {f.fields.map((x) => (
            <label key={x.key} className="axp-systems-check-field">
              <span>{x.label} {x.set && <Chip tone="success">saved</Chip>}</span>
              <span className="axp-systems-check-field__row">
                <input className="fx-input fx-mono" type={x.secret ? 'password' : x.key.endsWith('_URL') ? 'url' : 'text'} autoComplete="off" spellCheck={false} placeholder={x.set ? (x.secret ? '•••••••• (saved; type to replace)' : x.value) : x.placeholder}
                  value={vals[x.key] ?? ''} onChange={(e) => setVals({ ...vals, [x.key]: e.target.value })} aria-label={x.label} />
                {x.set && <Button icon="trash" disabled={busy} onClick={() => void clear(x.key)}>Clear</Button>}
              </span>
              <span className="fx-small fx-muted">{x.help}</span>
            </label>
          ))}
          <div className="fx-row fx-row--wrap"><Button tone="primary" icon="save" disabled={busy || !Object.values(vals).some((v) => v.trim())} onClick={() => void save()}>{busy ? 'Testing…' : 'Save & test'}</Button></div>
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Saved on the console server only (owner-only file), never sent back to the browser or committed.</p>
        </form>
      )}
      {f?.type === 'host' && (
        <div className="axp-systems-check-fix__host">
          <p className="fx-small" style={{ margin: 0 }}>Run this on the VPS (mosh or ssh). The console can't change the host from its container.</p>
          <div className="fx-row fx-row--wrap"><code className="axp-systems-check-cmd">{f.command}</code><Button icon="copy" onClick={() => copy(f.command)}>Copy</Button></div>
        </div>
      )}
      {f?.type === 'settings' && <Button icon="settings" onClick={() => rt.dispatch(`settings.open:${f.tab}`)}>{f.label}</Button>}
      <div className="fx-row fx-row--wrap">
        {c.status !== 'ok' && autoFixLabel(c) && <Button tone="primary" icon={c.fix?.type === 'host' && !hostAuto.has(c.id) ? 'copy' : c.fix?.type === 'secrets' ? 'key' : c.fix?.type === 'settings' ? 'settings' : 'zap'} disabled={busy || s.fixing || s.run[c.id] === 'working'} onClick={() => void autoFix(c, rt).then(() => setMsg(snap.runMsg[c.id] ?? ''))}>{autoFixLabel(c)}</Button>}
        <Button icon="refresh" disabled={busy || s.fixing} onClick={() => void again()}>Check again</Button>{msg && <span className="fx-small" role="status">{msg}</span>}
      </div>
    </div>
  );
}

function CheckBody({ c, inPrompt }: { c: Check; inPrompt?: boolean }) {
  const s = useSys();
  return (
    <div className="axp-systems-check-body">
      {!inPrompt && <p style={{ margin: 0 }}>{c.summary}</p>}
      {!inPrompt && s.runMsg[c.id] && <p className="fx-small axp-systems-check-runmsg" style={{ margin: 0 }}><RunBadge r={s.run[c.id]} /> {s.runMsg[c.id]}</p>}
      {c.details.length > 0 && <ul className="axp-systems-check-details">{c.details.map((d) => <li key={d} className="fx-mono fx-small">{d}</li>)}</ul>}
      {c.status !== 'ok' && c.fix && <><h4 className="axp-systems-check-h">Fix it here</h4><FixPanel c={c} /></>}
      {c.instructions.length > 0 && <><h4 className="axp-systems-check-h">{c.status === 'ok' ? 'How it was set up' : 'Fix it manually'}</h4><StepList className="axp-systems-check-steps" steps={c.instructions} /></>}
      {c.links.length > 0 && <><h4 className="axp-systems-check-h">Resources</h4><ul className="axp-systems-check-links">{c.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <Icon name="external" size={12} /></a></li>)}</ul></>}
      {c.status === 'ok' && c.fix?.type === 'secrets' && <FixPanel c={c} />}
    </div>
  );
}

/* ---------------- dialog ---------------- */

type View = 'grid' | 'service' | 'guided';

export function SystemCheckDialog({ focus }: { focus?: string }) {
  const s = useSys();
  const [view, setView] = useState<View>('grid');
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const [filter, setFilter] = useState<'issues' | 'all'>('issues');
  useEffect(() => { if (!s.report && !s.loading) void loadSystemCheck(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (s.unauthorized) return <p>Set the console token (Settings → Account &amp; security) to run the systems check.</p>;
  if (!s.report) return <p className="fx-muted">{s.error || 'Running the systems check…'}</p>;
  const r = s.report;
  const iss = issues(r);
  const rows = filter === 'issues' ? guidedOrder(iss) : [...r.checks].sort((a, b) => a.order - b.order);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const goGrid = (id: string) => { setView('grid'); setFilter('all'); setOpen(new Set([id])); };
  const done = Object.values(s.run).filter((x) => x === 'done' || x === 'failed' || x === 'needs-you' || x === 'skipped').length;
  const total = Object.keys(s.run).length;

  return (
    <div className="axp-systems-check">
      <div className="axp-systems-check__top">
        <div className="axp-systems-check__counts">
          {(['error', 'warn', 'ok', 'unknown'] as Status[]).map((k) => <span key={k} className="axp-systems-check__count"><StatusDot s={k} /> {r.counts[k] ?? 0} {STATUS_LABEL[k].toLowerCase()}</span>)}
          <span className="fx-muted fx-small">checked {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="fx-muted fx-small">
            {s.aiBusy ? 'Mosses is reading the codebase for new checks…'
              : r.routine ? `AI routine: ${r.routine.checks} checks${r.routine.stale ? ' (code changed since)' : ''}${r.aiOn ? '' : ', run without AI'}`
                : r.aiOn ? 'AI on: no routine yet' : 'checks from the codebase (AI off)'}
          </span>
          {(s.aiError || r.aiNote) && <span className="fx-small axp-systems-check-bad">{s.aiError || r.aiNote}</span>}
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" disabled={s.loading || s.fixing} onClick={() => void loadSystemCheck(true)}>{s.loading ? 'Checking…' : 'Check again'}</Button>
          <Button tone="primary" icon="zap" disabled={s.fixing || iss.length === 0} onClick={() => { setView('grid'); setFilter('issues'); void fixAll(); }}>{s.fixing ? `Fixing ${Math.min(done + 1, total)} of ${total}…` : 'Fix all'}</Button>
        </div>
      </div>
      {total > 0 && <div className="axp-systems-check__progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${(done / Math.max(1, total)) * 100}%` }} /></div>}

      {s.prompt && <PromptPanel p={s.prompt} />}

      <div className="axp-systems-check__tabs" role="tablist">
        {([['grid', 'Grid', 'list'], ['service', 'By service', 'grid'], ['guided', 'Guided setup', 'play']] as [View, string, string][]).map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className="axp-systems-check__tab" onClick={() => setView(id)}><Icon name={icon} size={14} /> {label}</button>
        ))}
      </div>

      {view === 'grid' && (
        <div className="axp-systems-check__grid">
          <div className="fx-row fx-row--wrap">
            <label className="fx-row" style={{ gap: 'calc(var(--fx-space) * 0.5)' }}><input type="radio" checked={filter === 'issues'} onChange={() => setFilter('issues')} /> Issues ({iss.length})</label>
            <label className="fx-row" style={{ gap: 'calc(var(--fx-space) * 0.5)' }}><input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> Everything ({r.checks.length})</label>
          </div>
          {rows.length === 0 && <p className="fx-muted">No issues: everything the console needs is configured.</p>}
          <table className="fx-table axp-systems-check-table">
            <thead><tr><th aria-label="Expand" /><th>Status</th><th>Check</th><th className="axp-systems-check-hide-sm">Service</th><th className="axp-systems-check-hide-sm">Summary</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.id}>
                  <tr className={`axp-systems-check-row ${open.has(c.id) ? 'is-open' : ''}`} onClick={() => toggle(c.id)}>
                    <td><button type="button" className="fx-iconbtn" aria-expanded={open.has(c.id)} aria-label={`Details for ${c.title}`} onClick={(e) => { e.stopPropagation(); toggle(c.id); }}><Icon name={open.has(c.id) ? 'chevron-down' : 'chevron-right'} size={14} /></button></td>
                    <td>{s.run[c.id] ? <RunBadge r={s.run[c.id]} /> : <StatusChip s={c.status} />}</td>
                    <td><strong>{c.title}</strong>{' '}<SourceBadge ai={isAiCheck(c)} /><span className="axp-systems-check-show-sm fx-small fx-muted"><br />{c.summary}</span></td>
                    <td className="axp-systems-check-hide-sm">{r.services.find((x) => x.id === c.service)?.label ?? c.service}</td>
                    <td className="axp-systems-check-hide-sm fx-small">{c.summary}</td>
                  </tr>
                  {open.has(c.id) && <tr className="axp-systems-check-exp"><td colSpan={5}><CheckBody c={c} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'service' && (
        <div className="axp-systems-check__cards">
          {r.services.map((sv) => {
            const cs = r.checks.filter((c) => c.service === sv.id);
            const bad = cs.filter(isIssue);
            const worst: Status = cs.some((c) => c.status === 'error') ? 'error' : bad.length ? 'warn' : cs.some((c) => c.status === 'unknown') ? 'unknown' : 'ok';
            return (
              <section key={sv.id} className={`axp-systems-check-card is-${worst}`}>
                <header className="axp-systems-check-card__head"><Icon name={sv.icon} /><strong className="fx-grow">{sv.label}</strong><StatusChip s={worst} /></header>
                <p className="fx-small fx-muted" style={{ margin: 0 }}>{sv.description}</p>
                <ul className="axp-systems-check-card__list">
                  {cs.map((c) => <li key={c.id}><button type="button" className="axp-systems-check-card__item" onClick={() => goGrid(c.id)}><StatusDot s={c.status} /><span className="fx-grow">{c.title}</span><SourceBadge ai={isAiCheck(c)} />{s.run[c.id] && <RunBadge r={s.run[c.id]} />}</button></li>)}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {view === 'guided' && <Guided list={guidedOrder(iss)} />}
    </div>
  );
}

/** The step Fix all is waiting on: what's needed, the fix form or command, and Done / Skip / Stop. */
function PromptPanel({ p }: { p: Prompt }) {
  const s = useSys();
  const c = s.report?.checks.find((x) => x.id === p.id);
  if (!c) return null;
  const isSecret = c.fix?.type === 'secrets';
  return (
    <section className="axp-systems-check-prompt" aria-live="polite" aria-label={`Fix all needs you: ${c.title}`}>
      <header className="axp-systems-check-prompt__head">
        <RunBadge r="waiting" />
        <strong className="fx-grow">Step {p.index} of {p.total}: {c.title} <SourceBadge ai={isAiCheck(c)} /></strong>
      </header>
      <p className="axp-systems-check-prompt__note" style={{ margin: 0 }}>{p.note}</p>
      <CheckBody c={c} inPrompt />
      <div className="fx-row fx-row--wrap axp-systems-check-prompt__actions">
        <Button tone="primary" icon="check" onClick={() => answerPrompt('done')}>{isSecret ? 'Check again & continue' : 'Done, check it'}</Button>
        <Button icon="arrow-right" onClick={() => answerPrompt('skip')}>Skip</Button>
        <Button icon="x" onClick={() => answerPrompt('stop')}>Stop Fix all</Button>
      </div>
    </section>
  );
}

function Guided({ list }: { list: Check[] }) {
  const s = useSys();
  const [i, setI] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  if (list.length === 0) return <div className="axp-systems-check-guided__done"><Icon name="check-circle" size={32} /><p>All set: the console and its features are configured.</p></div>;
  const idx = Math.min(i, list.length - 1);
  const c = list[idx]!;
  const live = s.report?.checks.find((x) => x.id === c.id) ?? c;
  return (
    <div className="axp-systems-check-guided">
      <ol className="axp-systems-check-guided__steps">
        {list.map((x, k) => {
          const now = s.report?.checks.find((y) => y.id === x.id) ?? x;
          return <li key={x.id}><button type="button" className={`axp-systems-check-guided__step ${k === idx ? 'is-active' : ''} ${now.status === 'ok' ? 'is-done' : ''}`} onClick={() => setI(k)}>
            <StatusDot s={now.status} /><span className="fx-grow">{k + 1}. {x.title}</span><SourceBadge ai={isAiCheck(x)} />{skipped.has(x.id) && <span className="fx-small fx-muted">skipped</span>}{s.run[x.id] && <RunBadge r={s.run[x.id]} />}</button></li>;
        })}
      </ol>
      <div className="axp-systems-check-guided__pane">
        <p className="fx-eyebrow" style={{ margin: 0 }}>Step {idx + 1} of {list.length}{live.dependsOn.length ? ` · after ${live.dependsOn.join(', ')}` : ''}</p>
        <h3 style={{ margin: 0 }}>{live.title} <StatusChip s={live.status} /></h3>
        <CheckBody c={live} />
        <div className="fx-row fx-row--wrap">
          <Button icon="arrow-left" disabled={idx === 0} onClick={() => setI(idx - 1)}>Back</Button>
          <Button icon="minus" disabled={idx >= list.length - 1} onClick={() => { setSkipped(new Set([...skipped, c.id])); setI(idx + 1); }}>Skip</Button>
          <Button tone="primary" icon="arrow-right" disabled={idx >= list.length - 1} onClick={() => setI(idx + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

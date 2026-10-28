/*
 * "Fix failed" dialog (Brett, Oct 28 2026). Opens when an Auto fix from the systems check banner fails.
 *  - Shows the Claude connection badge (connected / out of credits / dead) with the model and the account.
 *  - Connected: "Approve Mosses" hands the check to Mosses, who asks axHub to start headless Claude Code on the VPS
 *    (you approve that launch on axHub too; the link shows here). The session works on its own branch, never main.
 *  - Not connected: explains the error and how to fix it, shows the VPS command (copy), and "Auto fix with Vinny"
 *    runs that command through axHub vps.run (no model needed; approved on axHub).
 * Framework components and theme tokens only.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Note, Section, useRuntime } from '@console/axf/react';
import { call, loadSystemCheck } from './SystemCheck';

type ConnState = 'ok' | 'no-credit' | 'dead';
interface Conn { state: ConnState; model: string; profile: string; error: string; testedAt: number }
interface Job { id: string; state: 'asking' | 'waiting' | 'launched' | 'failed'; message: string; confirmationId?: string | null; branch?: string }
interface Vps { by: 'vinny' | 'check'; name: string; command: string; commandId: string | null }
interface Help { check: { id: string; title: string; summary: string }; fixed: boolean; failure: string; claude: Conn; mosses: { ok: boolean; why: string }; job: Job | null; vps: Vps | null; vinny: boolean }
interface VRun { id: string; state: 'asking' | 'waiting' | 'running' | 'done' | 'failed'; message: string; link?: string; output?: string }

const APPROVALS = 'https://axhub.amberxai.com/auth/admin/approvals/';
const BADGE: Record<ConnState, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  ok: { tone: 'success', label: 'Claude connected' },
  'no-credit': { tone: 'warning', label: 'Claude out of credits' },
  dead: { tone: 'danger', label: 'Claude not connected' },
};
const HOW_TO: Record<Exclude<ConnState, 'ok'>, string> = {
  'no-credit': 'The account answers but has no credit left or hit its limit. Add credit, wait for the limit to reset, or switch the AI assistant to another key or account (Settings → Plugins → AI assistant), then test again.',
  dead: 'The console can’t reach Claude. Check the AI assistant has a provider and a working key (Keys needed → Anthropic), that the Mosses agent is installed, and that the console can reach the internet. Then test again.',
};

const open = (s: string) => s === 'asking' || s === 'waiting' || s === 'running';

export function FixHelpDialog({ id, reason }: { id: string; reason?: string }) {
  const rt = useRuntime();
  const [h, setH] = useState<Help | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<VRun | null>(null);

  const load = (refresh = false) =>
    call<Help>(`fix-help/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason ?? '')}${refresh ? '&refresh=1' : ''}`)
      .then((x) => { setH(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, [id]);
  // Follow a Claude launch while it waits for approval.
  useEffect(() => {
    if (!h?.job || !open(h.job.state)) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [h]);
  // Follow Vinny's run until it's done or failed, then check again.
  useEffect(() => {
    if (!run || !open(run.state)) return;
    const t = setTimeout(() => {
      void call<{ run: VRun }>(`fix-help-run/${encodeURIComponent(run.id)}`).then(async (r) => {
        setRun(r.run);
        if (!open(r.run.state)) { await loadSystemCheck(true); void load(); rt.toast(`Vinny: ${r.run.message}`, r.run.state === 'done' ? 'success' : 'warning'); }
      }, () => undefined);
    }, 3000);
    return () => clearTimeout(t);
  }, [run]);

  if (err) return <Note tone="danger">{err}</Note>;
  if (!h) return <p className="fx-muted">Loading…</p>;
  if (h.fixed) return <Note tone="success">{h.check.title} passes now: nothing left to fix.</Note>;

  const c = h.claude;
  const b = BADGE[c.state];
  const approveMosses = async () => {
    setBusy(true);
    try {
      const r = await call<{ job: Job | null; message?: string }>(`fix-help-claude/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ reason: h.failure || reason || '' }) });
      if (r.message) rt.toast(r.message, 'success');
      await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); await load(true); }
    setBusy(false);
  };
  const vinnyFix = async () => {
    setBusy(true);
    try { setRun((await call<{ run: VRun }>(`fix-help-vinny/${encodeURIComponent(id)}`, { method: 'POST' })).run); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    setBusy(false);
  };
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => rt.toast('Command copied', 'success'), () => rt.toast('Couldn’t copy', 'danger')); };

  return (
    <div className="fx-stack">
      <Note tone="warning"><strong>{h.check.title}</strong>: the fix didn’t work.{h.failure ? ` ${h.failure}` : ''}</Note>

      <Section title="Claude connection" aside={<Button tone="ghost" icon="refresh" disabled={busy} onClick={() => void load(true)}>Test again</Button>}>
        <div className="fx-row fx-row--wrap">
          <Chip tone={b.tone}>{b.label}</Chip>
          {c.model && <span className="fx-small">Model <span className="fx-mono">{c.model}</span></span>}
          {c.profile && <span className="fx-small">Account <strong>{c.profile}</strong></span>}
          {c.testedAt > 0 && <span className="fx-small fx-muted">tested {new Date(c.testedAt * 1000).toLocaleTimeString(undefined, { timeStyle: 'short' })}</span>}
        </div>
        {c.state !== 'ok' && c.error && <p className="fx-small fx-mono axp-systems-check-bad">{c.error}</p>}
      </Section>

      {c.state === 'ok' ? (
        <Section title="Fix it with Mosses">
          <p className="fx-small">Mosses asks axHub to start headless Claude Code on the VPS with this check’s details. It commits the repair on its own branch (never main), and you approve the launch on axHub first.</p>
          {!h.mosses.ok && <Note tone="danger">{h.mosses.why}</Note>}
          {h.job ? (
            <div className="fx-stack">
              <div className="fx-row fx-row--wrap">
                <Chip tone={h.job.state === 'launched' ? 'success' : h.job.state === 'failed' ? 'danger' : 'warning'}>{h.job.state}</Chip>
                <span className="fx-small">{h.job.message}</span>
                {h.job.branch && <span className="fx-small fx-mono">{h.job.branch}</span>}
              </div>
              {h.job.confirmationId && h.job.state === 'waiting' && (
                <Button tone="primary" icon="external" onClick={() => globalThis.open(APPROVALS + h.job!.confirmationId, '_blank', 'noopener')}>Approve on axHub</Button>
              )}
              {h.job.state === 'launched' && <Button icon="hammer" onClick={() => rt.dispatch('build-manager.open')}>Follow it in the Build manager</Button>}
              {h.job.state === 'failed' && <Button tone="primary" icon="sparkles" disabled={busy || !h.mosses.ok} onClick={() => void approveMosses()}>Try again</Button>}
            </div>
          ) : (
            <Button tone="primary" icon="sparkles" disabled={busy || !h.mosses.ok} onClick={() => void approveMosses()}>{busy ? 'Asking…' : 'Approve Mosses: fix it with Claude Code'}</Button>
          )}
        </Section>
      ) : (
        <Section title="Why Claude can’t take it">
          <p className="fx-small">{HOW_TO[c.state]}</p>
          {c.state === 'no-credit' && <Button icon="settings" onClick={() => rt.dispatch('settings.open:ai-assistant')}>Open the AI assistant settings</Button>}
          {c.state === 'dead' && <Button icon="key" onClick={() => rt.openDialog('keys-needed', {})}>Open Keys needed</Button>}
        </Section>
      )}

      {c.state !== 'ok' && (
        <Section title="Fix it on the VPS">
          {h.vps ? (
            <div className="fx-stack">
              <p className="fx-small">{h.vps.by === 'vinny' ? `Vinny’s command “${h.vps.name}”` : 'The check’s own command'}:</p>
              <pre className="fx-mono fx-small axp-systems-check-cmd">{h.vps.command}</pre>
              <div className="fx-row fx-row--wrap">
                <Button icon="copy" onClick={() => copy(h.vps!.command)}>Copy</Button>
                {h.vps.by === 'vinny' && (
                  <Button tone="primary" icon="zap" disabled={busy || !h.vinny || (!!run && open(run.state))} onClick={() => void vinnyFix()}>Auto fix with Vinny</Button>
                )}
              </div>
              {h.vps.by === 'vinny' && <p className="fx-small fx-muted">Vinny runs it through axHub (vps.run). No model needed; you approve it on axHub, where the exact command is shown.</p>}
              {h.vps.by === 'check' && <p className="fx-small fx-muted">Vinny has no command for this check yet; run it in the Coolify terminal, or add it to his command book.</p>}
              {run && (
                <div className="fx-row fx-row--wrap">
                  <Chip tone={run.state === 'done' ? 'success' : run.state === 'failed' ? 'danger' : 'warning'}>{run.state}</Chip>
                  <span className="fx-small">{run.message}</span>
                  {run.link && run.state === 'waiting' && <Button tone="primary" icon="external" onClick={() => globalThis.open(run.link, '_blank', 'noopener')}>Approve on axHub</Button>}
                </div>
              )}
              {run?.output && <pre className="fx-mono fx-small axp-systems-check-cmd">{run.output.slice(-2000)}</pre>}
            </div>
          ) : (
            <p className="fx-small fx-muted"><Icon name="info" size={12} /> There’s no VPS command for this check. Follow its steps in the systems check.</p>
          )}
        </Section>
      )}
    </div>
  );
}

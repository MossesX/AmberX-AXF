import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Button, Checkbox, Container, Note, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

/*
 * Settings → Plugins → Build orchestrator → API limits & routing rules (Brett, Nov 9 2026: "I need the settings in the
 * orchestrator to configure the API limits and the rules"). The dispatcher's own part is here: the API overflow rule and
 * which API accounts it may use (pipeline-settings@1). The API accounts (label, daily and weekly spend caps, alert level,
 * on/off, add / remove) and the routing rules (add, edit, reorder, on/off; job type, model, priority, steps, minutes,
 * subscriptions busy) are the one Job routing config the launcher reads; the editor comes from capability
 * axf.job-routing@1 (web) so both screens change the same thing and no plugin imports another's folder.
 * Without that capability the panel says so. API: GET /pipeline/limits reads all of it (plugin command pipeline-limits).
 */

const FOLDER = 'build-orchestrator';
const JOB_ROUTING = 'axf.job-routing@1';
const api = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

type Section = 'status' | 'workers' | 'api' | 'rules' | 'test';
type ApiAccount = { name: string; label: string; enabled: boolean };
type JobRoutingService = { version: number; JobRouting: ComponentType<{ only?: Section[] }>; useApiAccounts: () => ApiAccount[]; open: () => void };
type Limits = { ok: boolean; apiOverflow: boolean; apiAccounts: string[]; why: string; error?: string };

const jobRouting = () => (globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices?.[JOB_ROUTING] as JobRoutingService | undefined;

function AllowedPicker({ svc, value, onChange }: { svc: JobRoutingService; value: string[]; onChange: (v: string[]) => void }) {
  const accounts = svc.useApiAccounts();
  if (!accounts.length) return <p className="fx-muted">No API accounts set up yet: add one under API accounts & spend caps below.</p>;
  return (
    <div className="ol-checks" role="group" aria-label="API accounts the dispatcher may use">
      {accounts.map((a) => (
        <Checkbox key={a.name} label={`${a.label}${a.label !== a.name ? ` · ${a.name}` : ''}${a.enabled ? '' : ' (off)'}`} checked={value.includes(a.name)}
          onChange={() => onChange(value.includes(a.name) ? value.filter((n) => n !== a.name) : [...value, a.name])} />
      ))}
    </div>
  );
}

export function LimitsPanel() {
  const rt = useRuntime();
  const svc = jobRouting();
  const [s, setS] = useState<Limits | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const r = await api.call<Limits>('pipeline/limits');
      if (!r.ok) throw new Error(r.error);
      setS(r); setAllowed(r.apiAccounts); setTyped(r.apiAccounts.join(', ')); setError('');
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (body: Record<string, unknown>, what: string) => {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>('pipeline/settings', body);
      if (!r.ok) throw new Error(r.error);
      rt.toast(what, 'success'); await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  const list = svc ? allowed : typed.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const changed = !!s && list.join(',') !== s.apiAccounts.join(',');
  return (
    <div className="fx-stack fx-stack--lg" data-axf-orchestrator-limits>
      {error && <Note tone="danger">API limits unavailable: {error}</Note>}
      <Container title="When builds may use an API account" icon="layers">
        <div className="fx-stack">
          <p className="fx-muted">API keys bill per token. The dispatcher sends a build to one only by a routing rule, by the overflow rule below, or when you set that build's route to API. Each account then still has to be on, have a key and be under its daily and weekly caps.</p>
          <Switch label="API overflow" hint="Every subscription account full or out → an API-key account. Turning it on is your own click; anyone may turn it off."
            checked={!!s?.apiOverflow} disabled={!s || busy} onChange={(on) => void save({ apiOverflow: on }, `API overflow ${on ? 'on' : 'off'}`)} />
          <p className="fx-muted">API accounts the dispatcher may use (none ticked = any of them).</p>
          {svc ? <AllowedPicker svc={svc} value={allowed} onChange={setAllowed} />
            : <TextField label="API accounts (comma-separated, empty = any)" value={typed} onChange={setTyped} />}
          <div><Button tone="primary" icon="save" busy={busy} disabled={!s || busy || !changed} onClick={() => void save({ apiAccounts: list }, list.length ? `Dispatcher may use ${list.join(', ')}` : 'Dispatcher may use any API account')}>Save allowed accounts</Button></div>
        </div>
      </Container>
      {svc ? <svc.JobRouting only={['api', 'rules', 'test']} />
        : <Note tone="warning">API account caps and routing rules come from the Claude accounts plugin (capability {JOB_ROUTING}), which is off. Switch it on under Settings → Plugins → Plugin switches.</Note>}
      {s?.why && svc && <Note tone="warning">{s.why}</Note>}
    </div>
  );
}

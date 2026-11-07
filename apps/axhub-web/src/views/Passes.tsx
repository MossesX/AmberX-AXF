/**
 * Timed passes (axHub decision 112, docs/veto-pass.md in the axHub repo): "allow theme changes for the next 30 minutes".
 * While a pass is on, calls it covers run at once instead of waiting on the veto countdown (an Everything pass covers every
 * service, decision 113; a narrow pass never covers destructive tools).
 * A one-tap "Everything for 2 hours" first, then active passes with their countdown and what each covers (Revoke,
 * Extend), then a form that picks from the hub's lists (decision 114: Service, Scope, Tools, Minutes), then the ended ones.
 * Every action goes through the hub's session API (`/auth/api/passes`), never a token.
 */
import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Container, Note, SelectField, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { PASS_EVERYTHING, filterPassTools, passClock, passCoverage, passGrantBody, passScopeChoices, passSecondsLeft, relTime, type PassCoverage, type PassForm, type PassOptions } from '../hub/core';
import { go } from '../hub/route';
import { HubGate, TapTwice, useHubJson, when } from './hubPage';

interface PassView {
  id: string;
  service: string;
  tools: string[];
  scope?: string[];
  all?: boolean;
  includeIrreversible?: boolean;
  scopeLabel?: string;
  covers?: PassCoverage;
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
          <p className="fx-muted">For a while, calls a pass covers run at once instead of waiting on the veto countdown. Everything covers every service; irreversible calls still ask unless you include them.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="list" onClick={() => go(rt, 'approvals-log', { pass: 'any' })}>Ran under a pass</Button>
        </div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && <Everything presets={d.minutes.presets} busy={busy} onGrant={(body) => act('/auth/api/passes', body, 'Pass on: everything')} />}
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
              <Covers c={passCoverage(p)} />
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
                  <td>{passCoverage(p).scope} · {passCoverage(p).services} · {p.revokedAt ? `revoked ${relTime(p.revokedAt)}${p.revokedBy ? ` by ${p.revokedBy}` : ''}` : `ended ${relTime(p.expiresAt)}`} · {p.uses} call{p.uses === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}
    </div>
  );
}

/** What a pass covers, one line per part, so a theme-only pass can't pass for everything. */
function Covers({ c }: { c: PassCoverage }) {
  return (
    <table className="fx-table">
      <tbody>
        <tr><th>Covers</th><td><strong>{c.scope}</strong></td></tr>
        <tr><th>Services</th><td>{c.services}</td></tr>
        <tr><th>Tools</th><td>{c.tools}</td></tr>
        {c.never && <tr><th>Still asks</th><td>{c.never}</td></tr>}
      </tbody>
    </table>
  );
}

/** The one-tap pass Brett asks for most: everything, 2 hours (other lengths next to it). */
function Everything({ presets, busy, onGrant }: { presets: number[]; busy: boolean; onGrant: (body: Record<string, unknown>) => void }) {
  const grant = (m: number) => onGrant({ minutes: m, reason: `Everything for ${m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}` });
  return (
    <Container title="Everything" icon="zap">
      <div className="fx-stack" data-axf-pass-everything>
        <p className="fx-muted">Every held call on every service runs at once: the VPS shell, GitHub, the console, memory, AmberX. Irreversible calls (wiping a disk, a database or a repo) still ask.</p>
        <Button tone="success" icon="zap" disabled={busy} onClick={() => grant(120)}>Everything for 2 hours</Button>
        <div className="fx-row fx-row--wrap">
          {presets.filter((m) => m !== 120).map((m) => (
            <Button key={m} size="sm" disabled={busy} onClick={() => grant(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</Button>
          ))}
        </div>
      </div>
    </Container>
  );
}

function Grant({ limits, busy, onGrant }: { limits: PassesPage['minutes']; busy: boolean; onGrant: (body: Record<string, unknown>) => void }) {
  const opts = useHubJson<PassOptions>('/auth/api/passes/options');
  const [form, setForm] = useState<PassForm>({ service: '', scope: PASS_EVERYTHING, tools: null, minutes: 30, reason: '', includeIrreversible: false });
  const [q, setQ] = useState('');
  const [tried, setTried] = useState(false);
  const o = opts.data;
  const set = (patch: Partial<PassForm>) => setForm((f) => ({ ...f, ...patch }));
  const svc = o?.services.find((s) => s.namespace === form.service);
  const everything = !form.service && form.scope === PASS_EVERYTHING;
  const checked = o ? passGrantBody(form, o) : { error: '' };
  const presets = o?.minutes.presets ?? limits.presets;
  const toggleTool = (name: string, on: boolean) => {
    const now = form.tools ?? [];
    set({ tools: on ? [...now, name] : now.filter((t) => t !== name) });
  };
  return (
    <Container title="Make a pass" icon="plus" collapsible defaultOpen={false}>
      <div className="fx-stack" data-axf-pass-form>
        {opts.error && <Note tone="danger" icon="alert">{opts.error}</Note>}
        {!o && !opts.error && <p className="fx-muted">Loading services…</p>}
        {o && (
          <>
            <SelectField
              label="Service"
              value={form.service}
              empty="All services"
              options={o.services.map((s) => ({ value: s.namespace, label: s.narrow ? s.label : `${s.label} (Everything only)`, disabled: !s.enabled }))}
              onChange={(v) => set({ service: v, scope: v ? '' : PASS_EVERYTHING, tools: null, includeIrreversible: false })}
              hint={svc ? (svc.why ?? svc.description) : 'All services: pick Everything, or a scope that applies wherever it appears.'}
            />
            <SelectField
              label="Scope"
              value={form.scope}
              options={passScopeChoices(o, form.service)}
              onChange={(v) => set({ scope: v, ...(v === PASS_EVERYTHING ? {} : { includeIrreversible: false }) })}
              hint={everything ? o.everything.description : form.scope ? 'Only calls whose target is this scope.' : 'Every call to this service.'}
            />
            {svc && svc.narrow && (
              <div className="fx-stack">
                <Checkbox label="All tools" checked={form.tools === null} onChange={(on) => set({ tools: on ? null : [] })} />
                {form.tools !== null && (
                  <>
                    {!svc.toolsKnown && <Note icon="alert">{svc.label} didn't answer just now, so its tools can't be listed. Tick All tools, or try again later.</Note>}
                    {svc.toolsKnown && <TextField label="Find a tool" type="search" value={q} onChange={setQ} placeholder="Name or what it does" />}
                    <div className="fx-stack" role="group" aria-label="Tools">
                      {filterPassTools(svc.tools, q).map((t) => (
                        <div key={t.name}>
                          <Checkbox label={`${t.name}: ${t.description}`} checked={form.tools?.includes(t.name) ?? false} disabled={!t.coverable} onChange={(on) => toggleTool(t.name, on)} />
                          {t.note && <p className="fx-muted">{t.note}</p>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <SelectField label="How long" value={String(form.minutes)} options={presets.map((m) => ({ value: String(m), label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }))} onChange={(v) => set({ minutes: Number(v) })} />
            <Checkbox label="Include irreversible calls (deleting a repo, wiping a disk or database)" checked={form.includeIrreversible} disabled={!everything} onChange={(on) => set({ includeIrreversible: on })} />
            <TextField label="What for" value={form.reason} onChange={(v) => set({ reason: v })} placeholder={everything ? 'Optional: e.g. Build day' : 'e.g. Theme changes with Claude'} />
            {tried && 'error' in checked && checked.error && <Note tone="danger" icon="alert">{checked.error}</Note>}
            <div className="fx-row">
              <Button tone="success" icon="check" disabled={busy} onClick={() => { setTried(true); if ('body' in checked) onGrant(checked.body); }}>Switch the pass on</Button>
            </div>
          </>
        )}
      </div>
    </Container>
  );
}

/**
 * Hub → Apps and connectors (hub-console@1 screen `connectors`) and its service detail (rows: `grid:hub.connectors/row:<ns>`).
 * Every connected service with its status, default policy, tool count and key health (systems-check style items), from
 * axHub's own list_services and the policy table (policy-table@1, read with the console's hub token). A row opens to the
 * service's detail: its tools and input schemas, the policy editor per tool (allow / veto / confirm / deny, the hold in
 * seconds; a confirm that writes PUT /auth/api/policy through Brett's session) and its recent calls from the approval
 * log. Add / reconnect / remove connector have no hub route yet: they say so, with the hub's own CLI line.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, TextField, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS, when, type Unavailable } from './data';
import { UnavailableNote } from './approvals';
import { TapTwice, useHubAction } from './controls';
import { clearFocus, useFocus } from './store';

export interface PolicyTool { name: string; description?: string; annotations?: { destructive?: boolean; readOnlyHint?: boolean }; explicit?: string; policy?: string; vetoSeconds?: number; vetoWarningSeconds?: number }
export interface ServiceRow {
  namespace: string; type?: string; enabled?: boolean; defaultPolicy?: string; policyPreset?: string; toolsStale?: boolean; tools?: PolicyTool[];
  listed?: boolean; description?: string; toolCount?: number | null; status?: string;
}
export interface ConnectorsPage {
  services: ServiceRow[]; veto: { defaultSeconds: number; min: number; max: number } | { unavailable: Unavailable };
  health: { namespace: string; status: 'ok' | 'warn' | 'error'; why: string }[]; checkedAt: string; listUnavailable?: Unavailable; policyUnavailable?: Unavailable;
}
export interface ServiceDetail {
  namespace: string; type?: string; enabled?: boolean; defaultPolicy?: string; policyPreset?: string; toolsStale?: boolean;
  tools: ({ name: string; description?: string; inputSchema?: unknown } & Partial<PolicyTool>)[]; policyTools: PolicyTool[];
  recentCalls: Record<string, unknown>[]; recentUnavailable?: Unavailable | null; health: { status: string }; describeUnavailable?: Unavailable;
}

export const CONNECTORS_GRID = 'hub.connectors';
const SHOW_KEY = 'axf.hub.connectors.show';
const POLICIES = ['allow', 'veto', 'confirm', 'deny'] as const;
const HEALTH_TONE: Record<string, 'success' | 'warning' | 'danger'> = { ok: 'success', warn: 'warning', error: 'danger' };
const POLICY_TONE: Record<string, 'success' | 'warning' | 'accent' | 'danger' | undefined> = { allow: 'success', veto: 'warning', confirm: 'accent', deny: 'danger' };
const isUnavailable = (v: unknown): v is { unavailable: Unavailable } => !!v && typeof v === 'object' && 'unavailable' in (v as object);

export function ConnectorsScreen(_props: { screen: HubScreen }) {
  const rt = useRuntime();
  const [show, setShow] = useState<string>(() => (rt.settings.get(SHOW_KEY) as string) || 'enabled');
  const { data, stale, reload } = useHubRead<ConnectorsPage>('connectors', { show }, 60000);
  const g = data && data.ok ? data : null;
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const focus = useFocus();
  useEffect(() => { if (focus?.screen === 'connectors' && focus.row) setExpanded((e) => (e.includes(focus.row!) ? e : [...e, focus.row!])); }, [focus]);
  useEffect(() => { if (focus?.screen === 'connectors' && focus.row && g) { document.querySelector(`[data-axf-hub-screen="connectors"] [data-axf-row="${focus.row}"]`)?.scrollIntoView({ block: 'center' }); if (g.services.some((s) => s.namespace === focus.row)) clearFocus(); } }, [focus, g]);
  const health = useMemo(() => new Map((g?.health ?? []).map((h) => [h.namespace, h])), [g]);
  const add = useHubAction('connectors', 'add', undefined, () => void reload());

  const columns: GridColumn<ServiceRow>[] = [
    { id: 'service', label: 'Service', width: 'minmax(calc(var(--fx-space) * 10), 2fr)', fixed: true, sortable: true, sortValue: (r) => r.namespace, render: (r) => <span className="axp-hub-admin-what"><strong className="axp-hub-admin-what__title">{r.namespace}</strong>{r.type ? <span className="axp-hub-admin-what__tool"><Chip>{r.type}</Chip></span> : null}</span> },
    { id: 'status', label: 'Status', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => (r.enabled === false ? 'z' : health.get(r.namespace)?.status ?? 'a'), render: (r) => (r.enabled === false ? <Chip>off</Chip> : <Chip tone={HEALTH_TONE[health.get(r.namespace)?.status ?? 'ok']}>{health.get(r.namespace)?.status === 'ok' ? (r.listed ? 'connected' : 'in the policy table') : health.get(r.namespace)?.why || 'check'}</Chip>) },
    { id: 'policy', label: 'Default policy', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => r.defaultPolicy ?? '', render: (r) => (r.defaultPolicy ? <Chip tone={POLICY_TONE[r.defaultPolicy]}>{r.defaultPolicy}</Chip> : <span className="fx-muted">—</span>) },
    { id: 'tools', label: 'Tools', width: 'minmax(max-content, 1fr)', align: 'end', sortable: true, sortValue: (r) => r.toolCount ?? r.tools?.length ?? 0, render: (r) => <span className="fx-muted">{r.toolCount ?? r.tools?.length ?? 0}{r.toolsStale ? ' (stale)' : ''}</span> },
    { id: 'preset', label: 'Preset', width: 'minmax(max-content, 1fr)', render: (r) => <span className="fx-muted">{r.policyPreset ?? '—'}</span> },
  ];
  const rows = g?.services ?? [];
  const groups: GridGroup<ServiceRow>[] = [{ id: 'services', title: g ? `${rows.length} service${rows.length === 1 ? '' : 's'}` : 'Services', icon: 'layers', rows, groups: [], fixed: true }];

  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="connectors">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · connectors</p>
          <h1>Apps and connectors</h1>
          <p className="fx-muted">Every service the hub connects, its tools and what each may do (allow, veto, confirm, deny). Open a row for the service's detail and its policy editor.{g ? ` Checked ${relTime(g.checkedAt)}.` : ''}</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check now</Button>
          <SelectField label="Show" value={show} onChange={(v) => { setShow(v); rt.settings.set(SHOW_KEY, v); }} options={[{ value: 'enabled', label: 'Enabled services' }, { value: 'all', label: 'Every service' }]} />
        </div>
      </header>

      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {g?.listUnavailable && <Note tone="warning">The hub's service list could not be read ({UNAVAILABLE_WORDS[g.listUnavailable.code] ?? g.listUnavailable.message}); the policy table alone is shown.</Note>}
      {g?.policyUnavailable && <Note tone="warning">The policy table could not be read ({UNAVAILABLE_WORDS[g.policyUnavailable.code] ?? g.policyUnavailable.message}); policies are not shown.</Note>}

      {g && g.health.some((h) => h.status !== 'ok') && (
        <Container title="Key health" icon="alert">
          <table className="fx-table">
            <tbody>
              {g.health.filter((h) => h.status !== 'ok').map((h) => <tr key={h.namespace}><th>{h.namespace}</th><td><Chip tone={HEALTH_TONE[h.status]}>{h.status}</Chip> {h.why}</td></tr>)}
            </tbody>
          </table>
        </Container>
      )}

      {!data && <p className="fx-muted">Reading the hub…</p>}
      {g && rows.length === 0 && <Note>No services{show === 'enabled' ? ' are enabled' : ''}.</Note>}
      {g && rows.length > 0 && (
        <DataGrid<ServiceRow>
          id={CONNECTORS_GRID}
          label="Connectors"
          groups={groups}
          columns={columns}
          rowId={(r) => r.namespace}
          rowLabel={(r) => `${r.namespace} ${r.type ?? ''}`}
          hidden={hidden}
          onToggleColumn={(c, on) => setHidden((h) => (on ?? h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))}
          onShowAll={() => setHidden([])}
          sort={sort}
          onSort={(c) => setSort((s0) => (c === null ? null : s0 && s0.col === c ? (s0.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
          expanded={expanded}
          onToggleExpand={(id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))}
          onRowClick={(r, e) => { if (!(e.target as Element).closest?.('button, a, input, select, textarea')) setExpanded((x) => (x.includes(r.namespace) ? x.filter((y) => y !== r.namespace) : [...x, r.namespace])); }}
          renderDetail={(r) => <ServiceDetailPanel namespace={r.namespace} veto={g && !isUnavailable(g.veto) ? g.veto : null} onDone={() => void reload()} />}
          rowTone={(r) => (r.enabled === false ? 'muted' : health.get(r.namespace)?.status === 'error' ? 'danger' : health.get(r.namespace)?.status === 'warn' ? 'warning' : 'success')}
          empty="No services."
        />
      )}

      <Container title="Add a connector" icon="plus" collapsible defaultOpen={false}>
        <div className="fx-stack">
          <p className="fx-muted">axHub configures services in its own command line today; the console asks the hub and shows what it says.</p>
          <div className="fx-row"><Button icon="plus" disabled={add.busy} onClick={() => void add.run({})}>Add a connector</Button></div>
        </div>
      </Container>
    </div>
  );
}

/** One service: tools and schemas, the policy editor and recent calls (hub-service@1). */
export function ServiceDetailPanel({ namespace, veto, onDone }: { namespace: string; veto: { defaultSeconds: number; min: number; max: number } | null; onDone: () => void }) {
  const rt = useRuntime();
  const { data, reload } = useHubRead<ServiceDetail>('connectors', {}, 120000, namespace);
  const d = data && data.ok ? data : null;
  const reconnect = useHubAction('connectors', 'reconnect', namespace, () => { void reload(); onDone(); });
  const remove = useHubAction('connectors', 'remove', namespace, () => { void reload(); onDone(); });
  const [schemaOpen, setSchemaOpen] = useState('');
  if (data && !data.ok) return <div className="axp-hub-admin-detail"><UnavailableNote r={data} /></div>;
  if (!d) return <p className="fx-muted axp-hub-admin-detail">Reading the service…</p>;
  const policyByTool = new Map(d.policyTools.map((t) => [t.name, t]));
  return (
    <div className="fx-stack axp-hub-admin-detail" data-axf-hub-service={namespace}>
      <div className="fx-row fx-row--wrap">
        <Chip>{d.type ?? 'service'}</Chip>
        <Chip tone={d.enabled === false ? undefined : 'success'}>{d.enabled === false ? 'off' : 'enabled'}</Chip>
        {d.defaultPolicy && <Chip tone={POLICY_TONE[d.defaultPolicy]}>default {d.defaultPolicy}</Chip>}
        {d.policyPreset && <Chip>{d.policyPreset}</Chip>}
        {d.toolsStale && <Chip tone="warning">tool list stale</Chip>}
        <Button size="sm" icon="refresh" disabled={reconnect.busy} onClick={() => void reconnect.run({})}>Reconnect</Button>
        <TapTwice size="sm" tone="danger" icon="trash" label="Remove" again="Tap again to remove" disabled={remove.busy} armed={remove.armed} onArm={() => void remove.run({}, 'DELETE')} onRun={() => void remove.run({}, 'DELETE')} />
        <Button size="sm" tone="ghost" icon="list" onClick={() => rt.dispatch('hub.open:log')}>Its calls in the log</Button>
      </div>
      {d.describeUnavailable && <Note tone="warning">The hub did not describe this service ({UNAVAILABLE_WORDS[d.describeUnavailable.code] ?? d.describeUnavailable.message}); its policy rows are shown.</Note>}

      <Container title={`Tools and policy · ${d.tools.length}`} icon="sliders" collapsible defaultOpen>
        <table className="fx-table">
          <tbody>
            {d.tools.map((t) => {
              const p = policyByTool.get(t.name);
              return (
                <tr key={t.name}>
                  <th>
                    <div className="fx-stack">
                      <span className="fx-mono">{t.name}</span>
                      {(t.description || p?.description) && <span className="fx-muted fx-small">{t.description || p?.description}</span>}
                      {(t.annotations?.destructive || p?.annotations?.destructive) && <Chip tone="danger">destructive</Chip>}
                      {t.inputSchema ? <Button size="sm" tone="ghost" icon={schemaOpen === t.name ? 'chevron-up' : 'chevron-down'} onClick={() => setSchemaOpen(schemaOpen === t.name ? '' : t.name)}>{schemaOpen === t.name ? 'Hide schema' : 'Schema'}</Button> : null}
                      {schemaOpen === t.name && <pre className="fx-mono fx-small">{JSON.stringify(t.inputSchema, null, 1)}</pre>}
                    </div>
                  </th>
                  <td><PolicyEditor namespace={namespace} tool={t.name} policy={p} veto={veto} onDone={() => { void reload(); onDone(); }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Container>

      <Container title={`Recent calls · ${d.recentCalls.length}`} icon="history" collapsible defaultOpen={false}>
        {d.recentUnavailable ? <UnavailableNote r={d.recentUnavailable} /> : d.recentCalls.length === 0 ? <p className="fx-muted">No calls in the log.</p> : (
          <table className="fx-table">
            <tbody>
              {d.recentCalls.slice(0, 20).map((c, i) => (
                <tr key={String(c.id ?? i)}>
                  <th>{when(String(c.createdAt ?? ''))}</th>
                  <td><span className="fx-mono">{String(c.qualifiedTool ?? '')}</span> · <Chip>{String(c.status ?? '')}</Chip>{c.decidedBy ? ` · ${String(c.decidedBy)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </div>
  );
}

/** allow / veto / confirm / deny (or follow the service) and the hold in seconds for one tool: a confirm that writes the policy table. */
function PolicyEditor({ namespace, tool, policy, veto, onDone }: { namespace: string; tool: string; policy?: PolicyTool; veto: { defaultSeconds: number; min: number; max: number } | null; onDone: () => void }) {
  const [pick, setPick] = useState<string>(policy?.explicit ?? '');
  const [seconds, setSeconds] = useState(String(policy?.vetoSeconds ?? veto?.defaultSeconds ?? 90));
  const set = useHubAction('connectors', 'policy', namespace, onDone);
  const changed = pick !== (policy?.explicit ?? '') || (pick === 'veto' && Number(seconds) !== (policy?.vetoSeconds ?? veto?.defaultSeconds ?? 90));
  const body = { tool, policy: pick === '' ? null : pick, ...(pick === 'veto' ? { vetoSeconds: Number(seconds) } : {}), reason: `Policy of ${namespace}.${tool} from the console` };
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <SelectField label="Policy" value={pick} onChange={setPick} empty={`Follow the service${policy?.policy ? ` (${policy.policy})` : ''}`} options={POLICIES.map((p) => ({ value: p, label: p }))} />
        {pick === 'veto' && <TextField label={`Hold (s${veto ? `, ${veto.min}–${veto.max}` : ''})`} type="number" value={seconds} onChange={setSeconds} />}
        <TapTwice size="sm" icon="save" label="Save" again="Tap again to write the policy" disabled={set.busy || !changed} armed={set.armed} onArm={() => void set.run(body)} onRun={() => void set.run(body)} />
      </div>
      {policy?.policy && <span className="fx-muted fx-small">In force: <Chip tone={POLICY_TONE[policy.policy]}>{policy.policy}</Chip>{policy.policy === 'veto' && policy.vetoSeconds ? ` · ${policy.vetoSeconds} s hold` : ''}</span>}
    </div>
  );
}

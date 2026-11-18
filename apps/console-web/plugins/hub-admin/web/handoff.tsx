/**
 * Hub → Handoff (hub-console@1 screen `handoff`): the Claude account handoff kits the hub built (hub-handoffs@1), each
 * opening to its run (hub-handoff@1): progress, the prompt with Copy, the kit files, the installer log. Send copies or
 * opens the prompt in a session and marks the run sent (a command). Accept on this device and Clear have no hub route
 * yet: they say so, with the route the hub should grow.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, Note, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup } from '@console/axf/libs/datagrid';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS, when } from './data';
import { UnavailableNote } from './approvals';
import { TapTwice, useHubAction } from './controls';
import { clearFocus, useFocus } from './store';

export interface RunSummary { id: string; at: number; project: string; repo: string; commit: string; published: { pushed: boolean; sha: string } | null; failed: boolean | string; files: number }
export interface HandoffStep { id: string; group: string; label: string; remaining: boolean; done: boolean; state: string; note: string; at: number }
export interface Run extends Omit<RunSummary, 'files'> {
  note: string; instructions: string; prompt: string; files: { path: string; bytes: number }[]; log: string[]; elapsed: number; steps: HandoffStep[]; sentAt: number;
}

export const HANDOFF_GRID = 'hub.handoff';

export function HandoffScreen(_props: { screen: HubScreen }) {
  const { data, stale, reload } = useHubRead<{ runs: RunSummary[] }>('handoff', {}, 60000);
  const g = data && data.ok ? data : null;
  const [expanded, setExpanded] = useState<string[]>([]);
  const focus = useFocus();
  useEffect(() => { if (focus?.screen === 'handoff' && focus.row) setExpanded((e) => (e.includes(focus.row!) ? e : [...e, focus.row!])); }, [focus]);
  useEffect(() => { if (focus?.screen === 'handoff' && focus.row && g) { document.querySelector(`[data-axf-hub-screen="handoff"] [data-axf-row="${focus.row}"]`)?.scrollIntoView({ block: 'center' }); if (g.runs.some((r) => r.id === focus.row)) clearFocus(); } }, [focus, g]);
  const columns: GridColumn<RunSummary>[] = [
    { id: 'when', label: 'When', width: 'minmax(max-content, 1fr)', fixed: true, sortable: true, sortValue: (r) => r.at, render: (r) => <strong>{when(r.at)}</strong> },
    { id: 'project', label: 'Project', width: 'minmax(max-content, 1.5fr)', sortable: true, sortValue: (r) => r.project, render: (r) => <span className="fx-mono">{r.project}{r.repo ? ` · ${r.repo}` : ''}</span> },
    { id: 'state', label: 'State', width: 'minmax(max-content, 1fr)', render: (r) => <Chip tone={r.failed ? 'danger' : r.published?.pushed ? 'success' : undefined}>{r.failed ? 'failed' : r.published?.pushed ? 'published' : 'not published'}</Chip> },
    { id: 'files', label: 'Files', width: 'max-content', align: 'end', render: (r) => <span className="fx-muted">{r.files}</span> },
  ];
  const rows = g?.runs ?? [];
  const groups: GridGroup<RunSummary>[] = [{ id: 'runs', title: g ? `${rows.length} run${rows.length === 1 ? '' : 's'}` : 'Runs', icon: 'package', rows, groups: [], fixed: true }];
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="handoff">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · Claude handoff</p>
          <h1>Handoff</h1>
          <p className="fx-muted">The handoff kits the hub built for a new Claude account: open one, send its prompt to a session and mark it sent.</p>
        </div>
        <div className="fx-row"><Button icon="refresh" onClick={() => void reload()}>Check</Button></div>
      </header>
      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {!data && <p className="fx-muted">Reading the hub…</p>}
      {g && rows.length === 0 && <Note>No handoff runs yet.</Note>}
      {g && rows.length > 0 && (
        <DataGrid<RunSummary>
          id={HANDOFF_GRID}
          label="Handoff runs"
          groups={groups}
          columns={columns}
          rowId={(r) => r.id}
          rowLabel={(r) => `${r.project} ${when(r.at)}`}
          hidden={[]}
          expanded={expanded}
          onToggleExpand={(id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))}
          onRowClick={(r, e) => { if (!(e.target as Element).closest?.('button, a, input, select, textarea')) setExpanded((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id])); }}
          renderDetail={(r) => <RunDetail id={r.id} onDone={() => void reload()} />}
          rowTone={(r) => (r.failed ? 'danger' : r.published?.pushed ? 'success' : 'muted')}
          empty="No handoff runs."
        />
      )}
    </div>
  );
}

function RunDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const rt = useRuntime();
  const { data, reload } = useHubRead<Run>('handoff', {}, 120000, id);
  const run = data && data.ok ? data : null;
  const send = useHubAction('handoff', 'send', id, () => { void reload(); onDone(); });
  const accept = useHubAction('handoff', 'accept', id, () => void reload());
  const clear = useHubAction('handoff', 'clear', id, () => { void reload(); onDone(); });
  if (data && !data.ok) return <div className="axp-hub-admin-detail"><UnavailableNote r={data} /></div>;
  if (!run) return <p className="fx-muted axp-hub-admin-detail">Reading the run…</p>;
  const done = run.steps.filter((s) => s.done).length;
  const copy = async () => { try { await navigator.clipboard.writeText(run.prompt); rt.toast('Prompt copied. Paste it into the new account’s session.', 'success', 'Handoff'); } catch { rt.toast('Could not copy; open the prompt and copy it by hand.', 'warning', 'Handoff'); } };
  return (
    <div className="fx-stack axp-hub-admin-detail" data-axf-hub-handoff={run.id}>
      <div className="fx-row fx-row--wrap">
        <Chip>{run.project}</Chip>
        {run.repo && <Chip>{run.repo}</Chip>}
        {run.commit && <span className="fx-mono fx-muted">{run.commit.slice(0, 8)}</span>}
        <Chip tone={run.failed ? 'danger' : run.published?.pushed ? 'success' : undefined}>{run.failed ? `failed${typeof run.failed === 'string' ? `: ${run.failed}` : ''}` : run.published?.pushed ? 'published' : 'not published'}</Chip>
        {run.sentAt ? <Chip tone="success">sent {relTime(run.sentAt)}</Chip> : null}
      </div>
      {run.note && <p className="fx-muted">{run.note}</p>}
      <Container title={`Steps · ${done}/${run.steps.length}`} icon={done >= run.steps.length && run.steps.length ? 'check-circle' : 'list'} collapsible defaultOpen={done < run.steps.length}>
        <table className="fx-table"><tbody>
          {run.steps.map((s) => <tr key={s.id}><th>{s.label}</th><td><Chip tone={s.done ? 'success' : s.remaining ? undefined : 'warning'}>{s.done ? 'done' : s.state || 'waiting'}</Chip>{s.note ? ` · ${s.note}` : ''}</td></tr>)}
        </tbody></table>
      </Container>
      <Container title="The prompt" icon="copy" collapsible defaultOpen={false} actions={<Button size="sm" icon="copy" onClick={() => void copy()}>Copy</Button>}>
        <pre className="fx-mono fx-small">{run.prompt}</pre>
        {run.instructions && <p className="fx-muted">{run.instructions}</p>}
      </Container>
      <Container title={`Kit files · ${run.files.length}`} icon="folder" collapsible defaultOpen={false}>
        <table className="fx-table"><tbody>
          {run.files.map((f) => <tr key={f.path}><th className="fx-mono">{f.path}</th><td className="fx-muted">{f.bytes} bytes</td></tr>)}
        </tbody></table>
      </Container>
      {run.log.length > 0 && (
        <Container title="Installer log" icon="terminal" collapsible defaultOpen={false}>
          <pre className="fx-mono fx-small">{run.log.join('\n')}</pre>
        </Container>
      )}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="rocket" disabled={send.busy} onClick={() => { void copy(); void send.run({}); }}>Send: copy the prompt and mark sent</Button>
        <Button icon="smartphone" disabled={accept.busy} onClick={() => void accept.run({})}>Accept on this device</Button>
        <TapTwice tone="danger" icon="trash" label="Clear" again="Tap again to clear" disabled={clear.busy} armed={clear.armed} onArm={() => void clear.run({}, 'DELETE')} onRun={() => void clear.run({}, 'DELETE')} />
      </div>
    </div>
  );
}

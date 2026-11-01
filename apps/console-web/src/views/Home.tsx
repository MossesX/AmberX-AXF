import { FRAMEWORK_VERSION } from '../axf/core';
import { useEffect } from 'react';
import { Button, Chip, Container, Icon, IconButton, useAxfState, useRuntime } from '../axf/react';
import { useStore } from '../store';
import { EmptyState } from '../emptyState';
import type { Status } from '../api';
import { PlanSummaryCard } from './Plan';
import { BuildSummaryCard } from './BuildManager';

const TABS: [string, string][] = [['foundations', 'Foundations'], ['kernel', 'Kernel'], ['console', 'Console'], ['modules', 'Modules'], ['demos', 'Demos']];

/** Home's ⋯ menu (context-menu target): the less-used page actions. */
const HOME_MORE = 'cx-home.more';

export function Home() {
  const rt = useRuntime();
  useEffect(() => {
    rt.contextExtras.set(HOME_MORE, () => ([
      { id: 'home-terminal', label: 'Output terminal', icon: 'terminal', action: 'terminal.open' },
      { id: 'home-export', label: 'Export plan', icon: 'copy', action: 'console.exportPlan' },
      { id: 'home-token', label: 'Console token', icon: 'lock', action: 'dialog:token' },
    ]));
    return () => { rt.contextExtras.delete(HOME_MORE); };
  }, [rt]);
  const s = useStore();
  useAxfState();
  // the app's own name (GizmoX AI Studio): the branding package is shared by every app through the axHub look
  const brand = rt.manifest.app.name || rt.branding()?.name;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Development console · AmberX AXF {FRAMEWORK_VERSION} · tracker {s.tracker.generatedAt.slice(0, 10) || '—'}</p>
          <h1>{brand}</h1>
          <p className="fx-muted">What the framework has, its libraries, UI kits and boilerplates, on every port.</p>
        </div>
        <div className="fx-row fx-row--wrap cx-home__actions">
          <Chip tone={s.backend ? 'success' : 'warning'}>{s.backend ? 'Engine online' : 'Engine offline'}</Chip>
          <Button icon="folder" onClick={() => rt.openDialog('project')}>{s.project || 'Open project'}</Button>
          <Button tone="primary" icon="layers" onClick={() => rt.navigate('tracker')}>Tracker</Button>
          <IconButton icon="more" label="More: terminal, export plan, token" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); rt.openContext(r.left, r.bottom, HOME_MORE); }} />
        </div>
      </header>

      <div className="fx-grid">
        <PlanSummaryCard />
        <BuildSummaryCard />
        <Container title="Coverage" icon="chart">
          <table className="fx-table"><tbody>
            {TABS.map(([id, label]) => { const c = s.coverage(id); const total = Math.max(1, Object.values(c).reduce((a, b) => a + b, 0)); return (
              <tr key={id}><th>{label}</th><td className="cx-home__bar"><Bar c={c} total={total} /></td><td className="fx-mono fx-small cx-home__num">{c.built}/{total}</td></tr>); })}
          </tbody></table>
        </Container>
        <Container title="Project" icon="package">
          <table className="fx-table"><tbody>
            <tr><th>Open project</th><td className="fx-mono">{s.project || <span className="fx-muted">none — installs and imports need one</span>}</td></tr>
            <tr><th>Build engine</th><td>{s.backend ? <Chip tone="success">online</Chip> : <><Chip tone="warning">offline</Chip> <span className="fx-muted fx-small">commands are recorded for Claude Code</span></>}</td></tr>
            <tr><th>Libraries</th><td>{s.libraries.length} installable · {s.modules.length} Android modules</td></tr>
            <tr><th>Boilerplates</th><td>{s.boilerplates.length}</td></tr>
            <tr><th>MCP endpoint</th><td>{s.backend ? <span className="fx-mono fx-small">{location.origin}/mcp <span className="fx-muted">(Bearer AXF_TOKEN)</span></span> : <span className="fx-muted">local: python3 apps/console-web/server/mcp_server.py</span>}</td></tr>
          </tbody></table>
        </Container>
        <Container title="Recent installs & imports" icon="download">
          {s.ports.length === 0 ? <EmptyState icon="download" action={{ label: 'Libraries', icon: 'package', onClick: () => rt.navigate('libraries') }}>Nothing installed or imported yet.</EmptyState> : (
            <ul className="home-tree">{[...s.ports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map((p) => <li key={p.id}><span><Icon name={p.kind === 'ui-import' ? 'grid' : 'box'} /> {p.name} <Chip tone={p.status === 'installed' || p.status === 'ported' ? 'success' : 'warning'}>{p.status}</Chip></span><span className="fx-muted fx-small">{p.kind} · {p.source}{p.project ? ` → ${p.project}` : ''}</span></li>)}</ul>)}
        </Container>
      </div>
    </div>
  );
}

function Bar({ c, total }: { c: Record<Status, number>; total: number }) {
  return <div className="cx-bar">{(['built', 'partial', 'placeholder', 'planned'] as Status[]).map((k) => <span key={k} className={`cx-bar__${k}`} style={{ width: `${(c[k] / total) * 100}%` }} title={`${k} ${c[k]}`} />)}</div>;
}

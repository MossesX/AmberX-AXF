import { FRAMEWORK_VERSION } from '../axf/core';
import { Button, Chip, Container, Icon, useRuntime } from '../axf/react';
import { useStore } from '../store';
import type { Status } from '../api';
import { PlanSummaryCard } from './Plan';
import { BuildSummaryCard } from './BuildManager';

const TABS: [string, string][] = [['foundations', 'Foundations'], ['kernel', 'Kernel'], ['console', 'Console'], ['modules', 'Modules'], ['demos', 'Demos']];

export function Home() {
  const rt = useRuntime();
  const s = useStore();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX AXF {FRAMEWORK_VERSION} · web console · tracker {s.tracker.generatedAt.slice(0, 10) || '—'} · backend {s.backend ? 'online' : 'offline'}</p>
          <h1>AXF Dev Console</h1>
          <p className="fx-muted">Tracks what the framework has, assembles libraries from the feature catalog, installs them into projects with a wizard, ports third-party UI libraries into hot-swappable kits, and manages boilerplates — on every port.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="layers" onClick={() => rt.navigate('tracker')}>Tracker</Button>
          <Button icon="folder" onClick={() => rt.openDialog('project')}>{s.project || 'Open project'}</Button>
          <Button icon="terminal" onClick={() => rt.dispatch('terminal.open')}>Terminal</Button>
          <Button icon="copy" onClick={() => rt.dispatch('console.exportPlan')}>Export plan</Button>
          <Button icon="play" onClick={() => rt.navigate('build')}>Build queue</Button>
          <Button icon="lock" onClick={() => rt.openDialog('token')}>Console token</Button>
        </div>
      </header>

      <div className="fx-grid">
        <PlanSummaryCard />
        <BuildSummaryCard />
        <Container title="Coverage" icon="chart">
          <table className="fx-table"><tbody>
            {TABS.map(([id, label]) => { const c = s.coverage(id); const total = Math.max(1, Object.values(c).reduce((a, b) => a + b, 0)); return (
              <tr key={id}><th>{label}</th><td><Bar c={c} total={total} /></td><td className="fx-mono fx-small">{c.built}/{total}</td></tr>); })}
          </tbody></table>
        </Container>
        <Container title="Project" icon="package">
          <table className="fx-table"><tbody>
            <tr><th>Open project</th><td className="fx-mono">{s.project || <span className="fx-muted">none — installs and imports need one</span>}</td></tr>
            <tr><th>Build engine</th><td>{s.backend ? <Chip tone="success">online</Chip> : <Chip tone="warning">offline — commands are recorded for Claude Code</Chip>}</td></tr>
            <tr><th>Libraries</th><td>{s.libraries.length} installable · {s.modules.length} Android modules</td></tr>
            <tr><th>Boilerplates</th><td>{s.boilerplates.length}</td></tr>
            <tr><th>MCP endpoint</th><td>{s.backend ? <span className="fx-mono fx-small">{location.origin}/mcp <span className="fx-muted">(Bearer AXF_TOKEN)</span></span> : <span className="fx-muted">local: python3 apps/console-web/server/mcp_server.py</span>}</td></tr>
          </tbody></table>
        </Container>
        <Container title="Recent installs & imports" icon="download">
          {s.ports.length === 0 ? <p className="fx-muted">Nothing yet. Install a library from Libraries, or Import a third-party UI library.</p> : (
            <ul className="home-tree">{[...s.ports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map((p) => <li key={p.id}><span><Icon name={p.kind === 'ui-import' ? 'grid' : 'box'} /> {p.name} <Chip tone={p.status === 'installed' || p.status === 'ported' ? 'success' : 'warning'}>{p.status}</Chip></span><span className="fx-muted fx-small">{p.kind} · {p.source}{p.project ? ` → ${p.project}` : ''}</span></li>)}</ul>)}
        </Container>
      </div>
    </div>
  );
}

function Bar({ c, total }: { c: Record<Status, number>; total: number }) {
  return <div className="cx-bar">{(['built', 'partial', 'placeholder', 'planned'] as Status[]).map((k) => <span key={k} className={`cx-bar__${k}`} style={{ width: `${(c[k] / total) * 100}%` }} title={`${k} ${c[k]}`} />)}</div>;
}

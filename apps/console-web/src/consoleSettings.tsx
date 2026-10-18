import { useEffect, useState } from 'react';
import { Button, useRuntime } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { getToken, health, isBackendUp } from './api';
import { PluginsPanel } from './views/Plugins';

/** Console token (AXF_TOKEN) kept in this browser. */
function TokenPanel() {
  const rt = useRuntime();
  const has = Boolean(getToken());
  return (
    <div className="fx-stack">
      <p style={{ marginTop: 0 }}>{has ? 'A console token is saved in this browser.' : 'No console token saved. Writes and plugin pages need it.'}</p>
      <p className="fx-muted">It's the <code>AXF_TOKEN</code> printed by <code>install-console.sh</code>. It stays in this browser only.</p>
      <div><Button icon="lock" onClick={() => rt.openDialog('token')}>{has ? 'Change token' : 'Set token'}</Button></div>
    </div>
  );
}

/** The console's own backend: API health and the MCP endpoint other tools connect to. */
function BackendPanel() {
  const [up, setUp] = useState<boolean | null>(isBackendUp() ? true : null);
  const [mcp, setMcp] = useState<{ url?: string; auth?: string; tools?: string[] } | null>(null);
  useEffect(() => {
    void health().then(setUp);
    fetch('/api/mcp', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(setMcp, () => setMcp(null));
  }, []);
  return (
    <div className="fx-stack">
      <p style={{ marginTop: 0 }}>Console API: <strong>{up === null ? 'checking…' : up ? 'online' : 'offline'}</strong></p>
      {mcp?.url && (
        <>
          <p style={{ margin: 0 }}>MCP endpoint: <code>{mcp.url}</code></p>
          <p className="fx-muted" style={{ margin: 0 }}>{mcp.tools?.length ?? 0} tools · auth: {mcp.auth}</p>
        </>
      )}
    </div>
  );
}

/** The console's contributions to the framework settings page. */
export const consoleSettings: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.settings',
  label: 'Console settings',
  version: '0.1.0',
  settingsPanels: [
    { id: 'console.token', tab: 'account', title: 'Console token', icon: 'lock', order: 30, render: () => <TokenPanel /> },
    { id: 'console.backend', tab: 'connections', title: 'Console backend', icon: 'terminal', order: 10, render: () => <BackendPanel /> },
    { id: 'console.plugins', tab: 'plugins', title: 'Console plugins', icon: 'package', order: 10, render: () => <PluginsPanel /> },
  ],
};

import { useEffect, useState } from 'react';
import { Button, useRuntime } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { getToken, health, isBackendUp, post, setToken } from './api';
import { PluginsPanel } from './views/Plugins';

/** Console token (AXF_TOKEN) kept in this browser, plus a server-side reset underneath. */
function TokenPanel() {
  const rt = useRuntime();
  const has = Boolean(getToken());
  return (
    <div className="fx-stack">
      <p style={{ marginTop: 0 }}>{has ? 'A console token is saved in this browser.' : 'No console token saved. Writes and plugin pages need it.'}</p>
      <p className="fx-muted">It's the <code>AXF_TOKEN</code> printed by <code>install-console.sh</code>. It stays in this browser only.</p>
      <div><Button icon="lock" onClick={() => rt.openDialog('token')}>{has ? 'Change token' : 'Set token'}</Button></div>
      <TokenReset />
    </div>
  );
}

/** Reset: the server issues a new token, saves it in .axf-console/env, and the old one stops working everywhere. */
function TokenReset() {
  const rt = useRuntime();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [fresh, setFresh] = useState('');
  const reset = async () => {
    setStep('busy');
    const r = (await post('token/reset', { confirm: 'reset' })) as { ok: boolean; token?: string; error?: string; unauthorized?: boolean };
    if (!r.ok || !r.token) {
      rt.toast(r.unauthorized ? 'Reset refused: the token saved in this browser is wrong.' : r.error ?? 'Reset failed', 'danger');
      setStep('idle');
      return;
    }
    setToken(r.token);
    setFresh(r.token);
    setStep('done');
    rt.toast('Token reset. The old one no longer works.', 'success');
  };
  const copy = () => {
    navigator.clipboard?.writeText(fresh).then(() => rt.toast('Token copied', 'success'), () => rt.toast('Select the token and copy it manually', 'warning'));
  };
  return (
    <div className="fx-stack" style={{ borderTop: 'var(--fx-border-w) solid var(--fx-border)', paddingTop: 'var(--fx-space)' }}>
      <p className="fx-muted" style={{ margin: 0 }}>On the server the token is saved in <code>/opt/axf/.axf-console/env</code>.</p>
      {step === 'idle' && <div><Button icon="refresh" disabled={!getToken()} onClick={() => setStep('confirm')}>Reset token</Button></div>}
      {(step === 'confirm' || step === 'busy') && (
        <>
          <p style={{ margin: 0 }}>Reset the token? The current one stops working right away: in this console, the server panel, Claude Code's MCP connection and any open terminal.</p>
          <div className="fx-row fx-row--wrap">
            <Button tone="danger" icon="refresh" disabled={step === 'busy'} onClick={() => void reset()}>{step === 'busy' ? 'Resetting…' : 'Reset now'}</Button>
            <Button tone="ghost" disabled={step === 'busy'} onClick={() => setStep('idle')}>Cancel</Button>
          </div>
        </>
      )}
      {step === 'done' && (
        <>
          <p style={{ margin: 0 }}>New token, shown once. It's already saved in this browser:</p>
          <div className="fx-row fx-row--wrap">
            <input className="fx-input fx-mono fx-grow" readOnly value={fresh} aria-label="New console token" onFocus={(e) => e.currentTarget.select()} />
            <Button icon="copy" onClick={copy}>Copy</Button>
          </div>
          <p className="fx-muted" style={{ margin: 0 }}>Paste it into the server panel (Connection → Token) and wherever Claude Code reads <code>AXF_TOKEN</code>.</p>
        </>
      )}
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

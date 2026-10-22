import { useEffect, useState } from 'react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/*
 * Claude badge: on every console load it tests the AI connection (server/__init__.py → axf.llm@1) and attaches a
 * badge asset (framework type `badge`, id `claude`) to the banner's left side. Connected: green, and a tooltip pops out to
 * its right for 5 s: "Powered by <model>". Not connected: grey, "AI unavailable". Removing the plugin removes only this
 * badge; the banner / badge / clock asset types are part of the framework.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const BADGE_ID = 'claude';
const KEY = `badge:${BADGE_ID}`;
const POP_MS = 5000;

interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  return j;
}

/** "Powered by Claude Opus 5.5" when connected, else "AI unavailable". */
export const popupText = (r: TestResult | null) => (r?.ok ? `Powered by ${r.name || 'Claude'}` : 'AI unavailable');

function badgeAsset(r: TestResult | null, checking: boolean) {
  const ok = !!r?.ok;
  return {
    $axf: 'asset@1', type: 'badge', id: BADGE_ID, name: 'Claude', version: '0.1.0', author: 'Claude badge plugin',
    description: 'AI connection status, attached to the banner by the Claude badge plugin.', tags: ['ai', 'status'],
    data: {
      icon: 'sparkles', label: 'Claude', shape: 'pill', tone: checking ? 'muted' : ok ? 'success' : 'muted',
      tooltip: checking ? 'Checking the AI connection…' : ok ? `${popupText(r)}${r?.provider ? ` · ${r.provider}` : ''} · ${(r!.ms / 1000).toFixed(1)} s` : `AI unavailable${r?.error ? `: ${r.error}` : ''}`,
      link: 'settings.open:claude-badge',
    },
  };
}

let last: TestResult | null = null;
let tested = false;
const listeners = new Set<(r: TestResult | null) => void>();

function show(rt: AxfRuntime, r: TestResult | null, checking: boolean) {
  rt.registry.register(badgeAsset(r, checking), 'app', ID);
  rt.attachToBanner({ type: 'badge', id: BADGE_ID, at: 'left', order: 5, origin: ID });
}

/** Run the connection test, repaint the badge and pop the tooltip out for 5 s. */
export async function testConnection(rt: AxfRuntime): Promise<TestResult> {
  show(rt, last, true);
  let r: TestResult;
  try { r = await call<TestResult>('test', { method: 'POST' }); }
  catch (e) { r = { at: Date.now(), ok: false, model: '', name: '', provider: '', ms: 0, error: (e as Error).message }; }
  last = r;
  show(rt, r, false);
  rt.showBannerPopup(KEY, popupText(r), POP_MS);
  listeners.forEach((f) => f(r));
  return r;
}

function SettingsPanel({ rt }: { rt: AxfRuntime }) {
  const [r, setR] = useState<TestResult | null>(last);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listeners.add(setR); return () => { listeners.delete(setR); }; }, []);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every time the console loads, one tiny message goes through the AI assistant. The Claude badge on the banner turns green and says which model answered, or grey with “AI unavailable”.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void testConnection(rt).finally(() => setBusy(false)); }}>{busy ? 'Testing…' : 'Test again'}</Button>
        {r && <Chip tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'connected' : 'unavailable'}</Chip>}
        {r && <span className="fx-small">{popupText(r)}</span>}
      </div>
      {r && (
        <p className="fx-small fx-muted">
          <Icon name="clock" size={12} /> {new Date(r.at).toLocaleTimeString()} · {(r.ms / 1000).toFixed(1)} s
          {r.model ? <> · model <span className="fx-mono">{r.model}</span></> : null}{r.provider ? <> · provider {r.provider}</> : null}
          {r.error ? <> · {r.error}</> : null}
        </p>
      )}
    </div>
  );
}

let runtime: AxfRuntime | null = null;

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude badge',
  version: '0.1.0',
  appMenu,
  provides: ['banner.badge.claude'],
  // Only a badge on the app's banner: inside a host that hides the banner (Patches) it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  register(rt) {
    runtime = rt;
    show(rt, last, !tested && !last);
    if (!tested) { tested = true; setTimeout(() => void testConnection(rt), 600); } // after the backend health check
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Claude badge', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The AI connection badge on the banner.' }],
  settingsPanels: [
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'AI connection', icon: 'sparkles', order: 10, render: () => (runtime ? <SettingsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

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
 * its right for 5 s: "Powered by <model>". Account works but out of credits: amber, "Out of credits". Can't connect (bad
 * token, invalid account, no assistant): grey, "AI unavailable". Each state's icon is a setting (hot: the badge repaints
 * the moment it changes). Removing the plugin removes only this badge; the banner / badge / clock asset types are part of the framework.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const BADGE_ID = 'claude';
const KEY = `badge:${BADGE_ID}`;
const POP_MS = 5000;

export type BadgeState = 'ok' | 'no-credit' | 'error';
interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean; state?: BadgeState }

/** The three states, their banner tone, default icon and the words the badge uses. */
export const STATES: Record<BadgeState, { label: string; tone: 'success' | 'warning' | 'muted'; chip: 'success' | 'warning' | 'danger'; icon: string; key: string; setting: string }> = {
  ok: { label: 'connected', tone: 'success', chip: 'success', icon: 'sparkles', key: 'claude-badge.icon.ok', setting: 'Connected (has credits)' },
  'no-credit': { label: 'out of credits', tone: 'warning', chip: 'warning', icon: 'zap', key: 'claude-badge.icon.no-credit', setting: 'Account works, out of credits' },
  error: { label: 'unavailable', tone: 'muted', chip: 'danger', icon: 'sparkles', key: 'claude-badge.icon.error', setting: "Can't connect (bad token or account)" },
};
const ICONS = ['sparkles', 'zap', 'check', 'star', 'cloud', 'key', 'lock', 'shield', 'alert', 'info', 'x', 'minus', 'clock', 'eye', 'bell', 'rocket'];
const ICON_LABEL = (i: string) => i.charAt(0).toUpperCase() + i.slice(1);

/** A saved result's state (results saved before this state existed carry none). */
export const stateOf = (r: TestResult | null): BadgeState => (r?.state && r.state in STATES ? r.state : r?.ok ? 'ok' : 'error');
const iconOf = (rt: AxfRuntime, st: BadgeState) => { const v = rt.settings.get(STATES[st].key); return typeof v === 'string' && ICONS.includes(v) ? v : STATES[st].icon; };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  return j;
}

/** "Powered by Claude Opus 5.5" when connected, "Out of credits" when the account works but has none, else "AI unavailable". */
export const popupText = (r: TestResult | null) => {
  const st = stateOf(r);
  return st === 'ok' ? `Powered by ${r?.name || 'Claude'}` : st === 'no-credit' ? 'Claude is out of credits' : 'AI unavailable';
};

function badgeAsset(rt: AxfRuntime, r: TestResult | null, checking: boolean) {
  const st = stateOf(r);
  const why = r?.error ? `: ${r.error}` : '';
  return {
    $axf: 'asset@1', type: 'badge', id: BADGE_ID, name: 'Claude', version: '0.1.0', author: 'Claude badge plugin',
    description: 'AI connection status, attached to the banner by the Claude badge plugin.', tags: ['ai', 'status'],
    data: {
      icon: iconOf(rt, checking && !r ? 'ok' : st), label: 'Claude', shape: 'pill', tone: checking ? 'muted' : STATES[st].tone,
      tooltip: checking ? 'Checking the AI connection…'
        : st === 'ok' ? `${popupText(r)}${r?.provider ? ` · ${r.provider}` : ''} · ${(r!.ms / 1000).toFixed(1)} s`
        : st === 'no-credit' ? `Out of credits: the account works but can't answer until it's topped up${why}` : `AI unavailable${why}`,
      link: 'settings.open:claude-badge',
    },
  };
}

let last: TestResult | null = null;
let tested = false;
let checking = false;
const listeners = new Set<(r: TestResult | null) => void>();

function show(rt: AxfRuntime, r: TestResult | null, checking: boolean) {
  rt.registry.register(badgeAsset(rt, r, checking), 'app', ID);
  rt.attachToBanner({ type: 'badge', id: BADGE_ID, at: 'left', order: 5, origin: ID });
}

/** Run the connection test, repaint the badge and pop the tooltip out for 5 s. */
export async function testConnection(rt: AxfRuntime): Promise<TestResult> {
  show(rt, last, true);
  checking = true;
  let r: TestResult;
  try { r = await call<TestResult>('test', { method: 'POST' }); }
  catch (e) { r = { at: Date.now(), ok: false, model: '', name: '', provider: '', ms: 0, error: (e as Error).message }; }
  last = r;
  checking = false;
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
      <p className="fx-small fx-muted">Every time the console loads, one tiny message goes through the AI assistant. The Claude badge on the banner turns green and says which model answered, amber with “Out of credits” when the account works but has no credits left, or grey with “AI unavailable” when it can't connect (bad token or account).</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void testConnection(rt).finally(() => setBusy(false)); }}>{busy ? 'Testing…' : 'Test again'}</Button>
        {r && <Chip tone={STATES[stateOf(r)].chip}>{STATES[stateOf(r)].label}</Chip>}
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

/** The three states as the badge draws them now, with the icon picked for each (repaints as the icons change). */
function StatesPreview({ rt }: { rt: AxfRuntime }) {
  const [, tick] = useState(0);
  useEffect(() => { const offs = (Object.keys(STATES) as BadgeState[]).map((st) => rt.settings.onChange(STATES[st].key, () => tick((n) => n + 1))); return () => offs.forEach((off) => off?.()); }, [rt]);
  return (
    <div className="fx-row fx-row--wrap">
      {(Object.keys(STATES) as BadgeState[]).map((st) => (
        <Chip key={st} tone={STATES[st].chip}><Icon name={iconOf(rt, st)} size={12} /> {STATES[st].label}</Chip>
      ))}
    </div>
  );
}

let runtime: AxfRuntime | null = null;
let watching = false;

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude badge',
  version: '0.2.0',
  appMenu,
  provides: ['banner.badge.claude'],
  // Only a badge on the app's banner: inside a host that hides the banner (Patches) it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  register(rt) {
    runtime = rt;
    if (!watching) {
      watching = true; // hot render: a new icon repaints the badge at once
      for (const st of Object.keys(STATES) as BadgeState[]) rt.settings.onChange(STATES[st].key, () => { if (runtime) show(runtime, last, checking); });
    }
    show(rt, last, !tested && !last);
    if (!tested) { tested = true; setTimeout(() => void testConnection(rt), 600); } // after the backend health check
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Claude badge', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The AI connection badge on the banner.' }],
  settings: [{
    id: 'claude-badge.icons', label: 'Badge icons', icon: 'star', tab: 'claude-badge', order: 20,
    description: 'The icon the Claude badge shows in each of its three states.',
    settings: (Object.keys(STATES) as BadgeState[]).map((st) => ({
      key: STATES[st].key, label: STATES[st].setting, kind: 'choice' as const, default: STATES[st].icon, scope: 'device' as const,
      options: ICONS.map((i) => ({ value: i, label: ICON_LABEL(i) })),
    })),
  }],
  settingsPanels: [
    { id: 'claude-badge.states', tab: 'claude-badge', title: 'The three states', icon: 'eye', order: 15, render: () => (runtime ? <StatesPreview rt={runtime} /> : null) },
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'AI connection', icon: 'sparkles', order: 10, render: () => (runtime ? <SettingsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

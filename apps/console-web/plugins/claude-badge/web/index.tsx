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
 * token, invalid account, no assistant): grey, "AI unavailable".
 * A second badge (id `claude-vps`) watches the Claude Code login on the VPS with plain code, no tokens: green logged in,
 * amber limit hit, red not logged in, grey when the VPS can't be read.
 * For each badge: shown or hidden, Icons only (the framework's `icon` badge shape) and an icon per state, all settings
 * (hot: a badge repaints the moment one changes). Removing the plugin removes only these badges; the banner / badge / clock asset types are part of the framework.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const BADGE_ID = 'claude';
const VPS_BADGE_ID = 'claude-vps';
const POP_MS = 5000;
const VPS_POLL_MS = 60000;

export type BadgeState = 'ok' | 'no-credit' | 'error';
interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean; state?: BadgeState; account?: string }

/** The three states, their banner tone, default icon and the words the badge uses. */
export const STATES: Record<BadgeState, { label: string; tone: 'success' | 'warning' | 'muted'; chip: 'success' | 'warning' | 'danger'; icon: string; key: string; setting: string }> = {
  ok: { label: 'connected', tone: 'success', chip: 'success', icon: 'sparkles', key: 'claude-badge.icon.ok', setting: 'Connected (has credits)' },
  'no-credit': { label: 'out of credits', tone: 'warning', chip: 'warning', icon: 'zap', key: 'claude-badge.icon.no-credit', setting: 'Account works, out of credits' },
  error: { label: 'unavailable', tone: 'muted', chip: 'danger', icon: 'sparkles', key: 'claude-badge.icon.error', setting: "Can't connect (bad token or account)" },
};
/** The same three states on the VPS badge. Its error is red; grey is kept for "can't read the VPS" (see `vpsTone`). */
export const VPS_STATES: typeof STATES = {
  ok: { label: 'logged in', tone: 'success', chip: 'success', icon: 'cloud', key: 'claude-badge.vps.icon.ok', setting: 'Logged in and working' },
  'no-credit': { label: 'limit hit', tone: 'warning', chip: 'warning', icon: 'zap', key: 'claude-badge.vps.icon.no-credit', setting: 'Limit hit or out of credits' },
  error: { label: 'not logged in', tone: 'muted', chip: 'danger', icon: 'alert', key: 'claude-badge.vps.icon.error', setting: "Not logged in or can't connect" },
};

export type BadgeKind = 'console' | 'vps';
/** The two badges: which asset each draws, its state words and its own settings. */
export const BADGES: Record<BadgeKind, { id: string; label: string; title: string; order: number; aliases: string[]; states: typeof STATES; show: string; iconOnly: string }> = {
  console: { id: BADGE_ID, label: 'Claude', title: 'Console connection', order: 5, aliases: ['claude', 'console connection'], states: STATES, show: 'claude-badge.console.show', iconOnly: 'claude-badge.console.icon-only' },
  vps: { id: VPS_BADGE_ID, label: 'VPS', title: 'VPS connection', order: 6, aliases: ['vps', 'vps connection'], states: VPS_STATES, show: 'claude-badge.vps.show', iconOnly: 'claude-badge.vps.icon-only' },
};
const KINDS = Object.keys(BADGES) as BadgeKind[];
const STATE_IDS = Object.keys(STATES) as BadgeState[];
const ICONS = ['sparkles', 'zap', 'check', 'star', 'cloud', 'key', 'lock', 'shield', 'alert', 'info', 'x', 'minus', 'clock', 'eye', 'bell', 'rocket', 'terminal', 'user'];
const ICON_LABEL = (i: string) => i.charAt(0).toUpperCase() + i.slice(1);

/** A saved result's state (results saved before this state existed carry none). */
export const stateOf = (r: TestResult | null): BadgeState => (r?.state && r.state in STATES ? r.state : r?.ok ? 'ok' : 'error');
const iconOf = (rt: AxfRuntime, kind: BadgeKind, st: BadgeState) => { const s = BADGES[kind].states[st]; const v = rt.settings.get(s.key); return typeof v === 'string' && ICONS.includes(v) ? v : s.icon; };
const shown = (rt: AxfRuntime, kind: BadgeKind) => rt.settings.get(BADGES[kind].show) !== false;
const shape = (rt: AxfRuntime, kind: BadgeKind): 'pill' | 'icon' => (rt.settings.get(BADGES[kind].iconOnly) === true ? 'icon' : 'pill');

/** One read of the Claude Code login on the VPS (GET /vps): plain code, no tokens, never a credential. */
export interface VpsResult { at: number; ok: boolean; state: BadgeState; reachable: boolean; account: string; email: string; plan: string; expiresAt: string; limitedAt: number; error: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  return j;
}

/** "Powered by Claude Opus 5.5" when connected, "Out of credits" when the account works but has none, else "AI unavailable". */
export const popupText = (r: TestResult | null) => {
  const st = stateOf(r);
  return st === 'ok' ? `Powered by ${r?.name || 'Claude'}${r?.account ? ` · ${r.account}` : ''}` : st === 'no-credit' ? 'Claude is out of credits' : 'AI unavailable';
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };

/** What the VPS badge says in one line. */
export const vpsText = (r: VpsResult | null) => {
  if (!r) return 'Checking the VPS login…';
  if (r.state === 'ok') return `Claude Code on the VPS${r.email ? ` · ${r.email}` : ''}`;
  if (r.state === 'no-credit') return `VPS Claude hit its limit${r.limitedAt ? ` at ${timeOf(r.limitedAt)}` : ''}${r.email ? ` · ${r.email}` : ''}`;
  return r.reachable ? 'VPS Claude is not logged in' : "Can't read the VPS login";
};
/** Grey when the login couldn't be read, red when it was read and it's out. */
export const vpsTone = (r: VpsResult | null): 'success' | 'warning' | 'danger' | 'muted' => (!r || !r.reachable ? 'muted' : r.state === 'error' ? 'danger' : VPS_STATES[r.state].tone);

function vpsAsset(rt: AxfRuntime, r: VpsResult | null) {
  const d = BADGES.vps;
  const until = r?.state === 'ok' && r.expiresAt ? dayOf(r.expiresAt) : '';
  const rest = [r?.plan, until ? `login good to ${until}` : '', r && !r.reachable ? r.error : ''].filter(Boolean).join(' · ');
  return {
    $axf: 'asset@1', type: 'badge', id: d.id, name: 'VPS connection', version: '0.1.0', author: 'Claude badge plugin',
    description: 'Claude Code login on the VPS, attached to the banner by the Claude badge plugin.', tags: ['ai', 'status', 'vps'],
    data: { icon: iconOf(rt, 'vps', r?.state ?? 'ok'), label: d.label, shape: shape(rt, 'vps'), tone: vpsTone(r), tooltip: rest ? `${vpsText(r)} · ${rest}` : vpsText(r), link: 'settings.open:claude-badge' },
  };
}

function badgeAsset(rt: AxfRuntime, r: TestResult | null, checking: boolean) {
  const st = stateOf(r);
  const why = r?.error ? `: ${r.error}` : '';
  return {
    $axf: 'asset@1', type: 'badge', id: BADGE_ID, name: 'Claude', version: '0.1.0', author: 'Claude badge plugin',
    description: 'AI connection status, attached to the banner by the Claude badge plugin.', tags: ['ai', 'status'],
    data: {
      icon: iconOf(rt, 'console', checking && !r ? 'ok' : st), label: BADGES.console.label, shape: shape(rt, 'console'), tone: checking ? 'muted' : STATES[st].tone,
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
let vpsLast: VpsResult | null = null;
let vpsTimer: ReturnType<typeof setInterval> | null = null;
const vpsListeners = new Set<(r: VpsResult | null) => void>();

/** Put one badge on the banner as its settings say, or take it off. */
function attach(rt: AxfRuntime, kind: BadgeKind, asset: object) {
  const d = BADGES[kind];
  if (!shown(rt, kind)) { rt.detachFromBanner(`badge:${d.id}`); return; }
  rt.registry.register(asset as never, 'app', ID);
  rt.attachToBanner({ type: 'badge', id: d.id, at: 'left', order: d.order, origin: ID, widget: { label: d.title, priority: 8, aliases: d.aliases } });
}

function show(rt: AxfRuntime, r: TestResult | null, checking: boolean) { attach(rt, 'console', badgeAsset(rt, r, checking)); }
function showVps(rt: AxfRuntime, r: VpsResult | null) { attach(rt, 'vps', vpsAsset(rt, r)); }

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
  if (shown(rt, 'console')) rt.showBannerPopup(`badge:${BADGE_ID}`, popupText(r), POP_MS);
  listeners.forEach((f) => f(r));
  return r;
}

/** Read the VPS login and repaint; the tooltip pops out only when the state changes after the first read. */
export async function checkVps(rt: AxfRuntime): Promise<VpsResult | null> {
  let r: VpsResult;
  try { r = await call<VpsResult>('vps'); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('(404)')) { stopVpsPoll(); return vpsLast; } // the plugin was switched off: nothing to repaint, register() restarts it
    r = { at: Date.now(), ok: false, state: 'error', reachable: false, account: '', email: '', plan: '', expiresAt: '', limitedAt: 0, error: msg };
  }
  const changed = !!vpsLast && (vpsLast.state !== r.state || vpsLast.reachable !== r.reachable);
  vpsLast = r;
  showVps(rt, r);
  if (changed && shown(rt, 'vps')) rt.showBannerPopup(`badge:${VPS_BADGE_ID}`, vpsText(r), POP_MS);
  vpsListeners.forEach((f) => f(r));
  return r;
}

function stopVpsPoll() { if (vpsTimer) clearInterval(vpsTimer); vpsTimer = null; }
/** The VPS badge stays live while it shows and the page is open; a hidden page or badge reads nothing. */
function startVpsPoll(rt: AxfRuntime) {
  if (vpsTimer) return;
  vpsTimer = setInterval(() => { if (!document.hidden && shown(rt, 'vps')) void checkVps(rt); }, VPS_POLL_MS);
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

function VpsPanel({ rt }: { rt: AxfRuntime }) {
  const [r, setR] = useState<VpsResult | null>(vpsLast);
  const [busy, setBusy] = useState(false);
  useEffect(() => { vpsListeners.add(setR); return () => { vpsListeners.delete(setR); }; }, []);
  const until = r?.expiresAt ? dayOf(r.expiresAt) : '';
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Watches the Claude Code login on the VPS with plain code, so it costs no tokens. Green is logged in and working, amber is limit hit or out of credits (for 24 hours after a build hits it, unless you switch accounts), red is not logged in, grey is the console can't read the VPS.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkVps(rt).finally(() => setBusy(false)); }}>{busy ? 'Checking…' : 'Check now'}</Button>
        {r && <Chip tone={VPS_STATES[r.state].chip}>{r.reachable ? VPS_STATES[r.state].label : "can't read"}</Chip>}
        {r && <span className="fx-small">{vpsText(r)}</span>}
      </div>
      {r && (
        <p className="fx-small fx-muted">
          <Icon name="clock" size={12} /> {new Date(r.at).toLocaleTimeString()}
          {r.account ? <> · account <span className="fx-mono">{r.account}</span></> : null}{r.plan ? <> · plan {r.plan}</> : null}{until ? <> · login good to {until}</> : null}
          {r.error ? <> · {r.error}</> : null}
        </p>
      )}
    </div>
  );
}

/** Each badge's three states as it draws them now, with the icon picked for each (repaints as the icons change). */
function StatesPreview({ rt }: { rt: AxfRuntime }) {
  const [, tick] = useState(0);
  useEffect(() => { const offs = KINDS.flatMap((k) => STATE_IDS.map((st) => rt.settings.onChange(BADGES[k].states[st].key, () => tick((n) => n + 1)))); return () => offs.forEach((off) => off?.()); }, [rt]);
  return (
    <div className="fx-stack">
      {KINDS.map((k) => (
        <div key={k} className="fx-row fx-row--wrap">
          <span className="fx-small fx-muted">{BADGES[k].title}</span>
          {STATE_IDS.map((st) => (
            <Chip key={st} tone={BADGES[k].states[st].chip}><Icon name={iconOf(rt, k, st)} size={12} /> {BADGES[k].states[st].label}</Chip>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One badge's settings group: show or hide it, Icons only, and the icon for each state. */
const badgeGroup = (kind: BadgeKind, id: string, order: number) => ({
  id, label: `${BADGES[kind].title} badge`, icon: kind === 'vps' ? 'cloud' : 'star', tab: 'claude-badge', order,
  description: 'Whether this badge is on the banner, how it draws and the icon for each of its three states.',
  settings: [
    { key: BADGES[kind].show, label: 'Show on the banner', kind: 'toggle' as const, default: true, scope: 'device' as const },
    { key: BADGES[kind].iconOnly, label: 'Icons only', kind: 'toggle' as const, default: false, scope: 'device' as const, description: 'Just the icon, no words. The colour still shows the state.' },
    ...STATE_IDS.map((st) => {
      const s = BADGES[kind].states[st];
      return { key: s.key, label: s.setting, kind: 'choice' as const, default: s.icon, scope: 'device' as const, options: ICONS.map((i) => ({ value: i, label: ICON_LABEL(i) })) };
    }),
  ],
});

let runtime: AxfRuntime | null = null;
let watching = false;

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude badge',
  version: '0.4.0',
  appMenu,
  provides: ['banner.badge.claude', 'banner.badge.claude-vps'],
  // Only a badge on the app's banner: inside a host that hides the banner it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  register(rt) {
    runtime = rt;
    if (!watching) {
      watching = true; // hot render: a new icon, Icons only or Show repaints the badge at once
      const repaint = (kind: BadgeKind) => { if (!runtime) return; if (kind === 'console') show(runtime, last, checking); else showVps(runtime, vpsLast); };
      for (const k of KINDS) {
        for (const key of [...STATE_IDS.map((st) => BADGES[k].states[st].key), BADGES[k].iconOnly]) rt.settings.onChange(key, () => repaint(k));
      }
      rt.settings.onChange(BADGES.console.show, () => { if (!runtime) return; repaint('console'); if (!tested && shown(runtime, 'console')) { tested = true; void testConnection(runtime); } });
      rt.settings.onChange(BADGES.vps.show, () => { if (!runtime) return; repaint('vps'); if (shown(runtime, 'vps')) void checkVps(runtime); });
    }
    show(rt, last, !tested && !last);
    showVps(rt, vpsLast);
    // A hidden console badge spends nothing: its test only runs from Test again, or once it is shown.
    if (!tested && shown(rt, 'console')) { tested = true; setTimeout(() => void testConnection(rt), 600); } // after the backend health check
    if (shown(rt, 'vps')) setTimeout(() => void checkVps(rt), 800);
    startVpsPoll(rt);
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Claude badge', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The console and VPS connection badges on the banner.' }],
  settings: [badgeGroup('console', 'claude-badge.icons', 20), badgeGroup('vps', 'claude-badge.vps', 21)],
  settingsPanels: [
    { id: 'claude-badge.states', tab: 'claude-badge', title: 'The three states', icon: 'eye', order: 15, render: () => (runtime ? <StatesPreview rt={runtime} /> : null) },
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'AI connection', icon: 'sparkles', order: 10, render: () => (runtime ? <SettingsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.vps-status', tab: 'claude-badge', title: 'VPS connection', icon: 'cloud', order: 12, render: () => (runtime ? <VpsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

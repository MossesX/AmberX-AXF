import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import type { BadgeData } from '@console/axf/core/types';
import { BannerBadge, Button, Chip, Container, Icon, Note, SelectField, Segmented, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { ANIM_STATES, DEFAULT_STYLE, LOOK_ASSETS, MOTIONS, TONES, TONE_LABEL, badgeData, lookOf, normalizeStyle, type AnimState, type Animation, type Style, type Tone } from './look';
import './claude-badge.css';

/*
 * Claude badge: on every console load it tests the AI connection (server/__init__.py → axf.llm@1) and attaches a
 * badge asset (framework type `badge`, id `claude`) to the banner's left side. Connected: green, and a tooltip pops out to
 * its right for 5 s: "Powered by <model>". Account works but out of credits: amber, "Out of credits". Can't connect (bad
 * token, invalid account, no assistant): grey, "AI unavailable". Each state's icon is a setting (hot: the badge repaints
 * the moment it changes). Removing the plugin removes only this badge; the banner / badge / clock asset types are part of the framework.
 *
 * Follow Amber (Brett, Nov 4 2026): a tap switches Follow Amber (action followAmber.toggle, the shared followAmber.enabled
 * switch) when it is installed; while it is on the badge draws two-tone (its connection colour + a faded second tone)
 * with an animation, and pulses each time Amber opens something (counter followAmber.opened). What a tap did before
 * (settings, test again) and the last thing Amber opened are in its right-click / long-press menu. The look (20 badge
 * assets in looks.json, brand-icon looks among them), any brand-package icon, and an animation per state are kept on
 * the server (style.json), so REST, MCP and the CLI change it too.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const BADGE_ID = 'claude';
const KEY = `badge:${BADGE_ID}`;
const POP_MS = 5000;
const LOOKS_DIALOG = 'claude-badge.looks';
const ICONS_DIALOG = 'claude-badge.icons';
/** The shared Follow Amber switch and its neutral signals (no plugin is named: any provider of these works). */
const FOLLOW_KEY = 'followAmber.enabled';
const FOLLOW_TOGGLE = 'followAmber.toggle';
const FOLLOW_OPENED = 'followAmber.opened';
const FOLLOW_LAST = 'followAmber.last';

export type BadgeState = 'ok' | 'no-credit' | 'error';
interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean; state?: BadgeState; account?: string }

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
  return st === 'ok' ? `Powered by ${r?.name || 'Claude'}${r?.account ? ` · ${r.account}` : ''}` : st === 'no-credit' ? 'Claude is out of credits' : 'AI unavailable';
};

/* ---------------- Follow Amber, as the badge sees it ---------------- */

const canFollow = (rt: AxfRuntime) => !!rt.actions.get(FOLLOW_TOGGLE);
const following = (rt: AxfRuntime) => canFollow(rt) && rt.settings.get(FOLLOW_KEY) === true;
interface Shown { kind?: string; target: string; label?: string; at?: string }
function lastShown(rt: AxfRuntime): Shown | null {
  try { const v = rt.settings.get(FOLLOW_LAST); const j = typeof v === 'string' && v ? (JSON.parse(v) as Shown) : null; return j?.target ? j : null; } catch { return null; }
}

/* ---------------- the style (server style.json) ---------------- */

let style: Style = DEFAULT_STYLE;
let styleVersion = 0;
const styleSubs = new Set<() => void>();
const setStyle = (s: Style) => { style = s; styleVersion += 1; styleSubs.forEach((f) => f()); if (runtime) show(runtime, last, checking); };
const useStyle = () => { useSyncExternalStore((f) => { styleSubs.add(f); return () => styleSubs.delete(f); }, () => styleVersion); return style; };

async function loadStyle(): Promise<void> {
  try { setStyle(normalizeStyle((await call<{ style: unknown }>('style')).style)); } catch { /* the defaults stand */ }
}
async function saveStyle(patch: Partial<Omit<Style, 'animations'>> & { animations?: Partial<Record<AnimState, Partial<Animation>>> }): Promise<void> {
  const prev = style;
  // hot: the badge repaints at once, the server's answer confirms it
  setStyle(normalizeStyle({ ...style, ...patch, animations: Object.fromEntries(ANIM_STATES.map((s) => [s.id, { ...style.animations[s.id], ...(patch.animations?.[s.id] ?? {}) }])) }));
  try { setStyle(normalizeStyle((await call<{ style: unknown }>('style-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })).style)); }
  catch (e) { setStyle(prev); runtime?.toast((e as Error).message, 'danger', 'Claude badge'); }
}

/* ---------------- the badge ---------------- */

let pulse = 0;

function badgeAsset(rt: AxfRuntime, r: TestResult | null, checking: boolean) {
  const st = stateOf(r);
  const why = r?.error ? `: ${r.error}` : '';
  const follow = following(rt);
  const lead = canFollow(rt) ? `Follow Amber ${follow ? 'on' : 'off'} (tap to turn it ${follow ? 'off' : 'on'}) · ` : '';
  const data = badgeData(style, { tone: checking ? 'muted' : STATES[st].tone, checking, following: follow, failed: !checking && st !== 'ok', pulse, stateIcon: iconOf(rt, checking && !r ? 'ok' : st) });
  return {
    $axf: 'asset@1', type: 'badge', id: BADGE_ID, name: 'Claude', version: '0.2.0', author: 'Claude badge plugin',
    description: 'AI connection status and the Follow Amber switch, attached to the banner by the Claude badge plugin.', tags: ['ai', 'status'],
    data: {
      ...data, label: follow ? 'Claude · Following' : 'Claude',
      tooltip: lead + (checking ? 'Checking the AI connection…'
        : st === 'ok' ? `${popupText(r)}${r?.provider ? ` · ${r.provider}` : ''} · ${(r!.ms / 1000).toFixed(1)} s`
        : st === 'no-credit' ? `Out of credits: the account works but can't answer until it's topped up${why}` : `AI unavailable${why}`),
      link: canFollow(rt) ? FOLLOW_TOGGLE : 'settings.open:claude-badge',
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

/* ---------------- previews ---------------- */

/** The badge as it would draw, for pickers (no tap). */
function Preview({ s, follow = true, pulseAt = 0, tone = 'success', checkingNow = false, failed = false, label }: { s: Style; follow?: boolean; pulseAt?: number; tone?: Tone; checkingNow?: boolean; failed?: boolean; label?: string }) {
  const rt = useRuntime();
  const d = badgeData(s, { tone, checking: checkingNow, following: follow, failed, pulse: pulseAt, stateIcon: iconOf(rt, 'ok') });
  return <span className="axp-claude-badge__preview" aria-label={label}><BannerBadge data={{ ...d, label: 'Claude', tooltip: label } as unknown as BadgeData} /></span>;
}

function LookPicker({ onPicked }: { onPicked?: () => void }) {
  const s = useStyle();
  const plain = LOOK_ASSETS.filter((l) => !l.tags.includes('brand'));
  const brand = LOOK_ASSETS.filter((l) => l.tags.includes('brand'));
  const tile = (l: (typeof LOOK_ASSETS)[number]) => {
    const on = s.look === l.data.look;
    return (
      <button key={l.id} type="button" className={`fx-btn fx-btn--ghost axp-claude-badge__tile${on ? ' is-on' : ''}`} aria-pressed={on} title={l.description}
        onClick={() => { void saveStyle({ look: l.data.look, icon: '' }); onPicked?.(); }}>
        <Preview s={{ ...s, look: l.data.look, icon: '' }} label={l.name} />
        <span className="fx-small">{l.name}</span>
      </button>
    );
  };
  return (
    <div className="fx-stack">
      <div className="axp-claude-badge__grid" role="group" aria-label="Badge looks">{plain.map(tile)}</div>
      <strong className="fx-small">From the brand library</strong>
      <div className="axp-claude-badge__grid" role="group" aria-label="Brand looks">{brand.map(tile)}</div>
    </div>
  );
}

type IconTab = 'marks' | 'animated' | 'glyphs' | 'icons';
/** Every brand-package icon (logo marks, animated logos, icon-pack glyphs) and the built-in icons. */
function IconPicker({ onPicked }: { onPicked?: () => void }) {
  const rt = useRuntime();
  const s = useStyle();
  const [tab, setTab] = useState<IconTab>('marks');
  const marks = rt.registry.list('logo-mark' as never) as { id: string; name: string; data: { form?: string } }[];
  const anims = rt.registry.list('animated-logo' as never) as { id: string; name: string }[];
  const packs = rt.registry.list('icon-pack' as never) as { id: string; name: string; data: { glyphs?: Record<string, unknown> } }[];
  const items: { value: string; name: string }[] =
    tab === 'marks' ? marks.map((m) => ({ value: `mark:${m.id}`, name: m.name }))
    : tab === 'animated' ? anims.map((a) => ({ value: `anim:${a.id}`, name: a.name }))
    : tab === 'glyphs' ? packs.flatMap((p) => Object.keys(p.data.glyphs ?? {}).map((g) => ({ value: `glyph:${p.id}/${g}`, name: `${p.name} · ${g}` })))
    : ICONS.map((i) => ({ value: `icon:${i}`, name: ICON_LABEL(i) }));
  // brand icons draw best on a look that shows a mark; the picked look stays unless it can't show one
  const host = lookOf(s.look).data.shape === 'dot' ? 'brand' : s.look;
  return (
    <div className="fx-stack">
      <Segmented<IconTab> label="Icon source" value={tab} onChange={setTab} size="sm" options={[
        { value: 'marks', label: `Logo marks (${marks.length})` }, { value: 'animated', label: `Animated (${anims.length})` },
        { value: 'glyphs', label: 'Icon packs' }, { value: 'icons', label: 'Built-in' }]} />
      <div className="fx-row fx-row--wrap">
        <Button size="sm" tone="ghost" icon="undo" disabled={!s.icon} onClick={() => { void saveStyle({ icon: '' }); onPicked?.(); }}>Use the look's own icon</Button>
        {s.icon && <span className="fx-small fx-muted">Now: <span className="fx-mono">{s.icon}</span></span>}
      </div>
      {!items.length ? <p className="fx-small fx-muted">None installed: the Brand library adds more.</p> : (
        <div className="axp-claude-badge__grid" role="group" aria-label="Icons">
          {items.map((it) => {
            const on = s.icon === it.value;
            return (
              <button key={it.value} type="button" className={`fx-btn fx-btn--ghost axp-claude-badge__tile${on ? ' is-on' : ''}`} aria-pressed={on} title={it.name}
                onClick={() => { void saveStyle({ icon: it.value, look: host }); onPicked?.(); }}>
                <Preview s={{ ...s, look: host, icon: it.value }} label={it.name} />
                <span className="fx-small axp-claude-badge__name">{it.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- settings ---------------- */

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

function FollowPanel({ rt }: { rt: AxfRuntime }) {
  const s = useStyle();
  const [, tick] = useState(0);
  const [demo, setDemo] = useState(0);
  useEffect(() => rt.settings.onChange(FOLLOW_KEY, () => tick((n) => n + 1)), [rt]);
  const on = following(rt);
  return (
    <div className="fx-stack">
      {!canFollow(rt) && <Note tone="info">Follow Amber isn't installed or is off (Settings → Plugins), so a tap opens these settings instead.</Note>}
      <div className="fx-row fx-row--wrap axp-claude-badge__previews">
        <Preview s={s} follow={false} label="Follow Amber off" /><span className="fx-small fx-muted">off</span>
        <Preview s={s} follow pulseAt={demo} label="Follow Amber on" /><span className="fx-small fx-muted">on</span>
        <Button size="sm" tone="ghost" icon="zap" onClick={() => setDemo((n) => n + 1)}>Play the “Amber opened something” pulse</Button>
      </div>
      {canFollow(rt) && (
        <div className="fx-row fx-row--wrap">
          <Chip tone={on ? 'accent' : undefined}>{on ? 'Following Amber' : 'Not following'}</Chip>
          <Button size="sm" icon="eye" onClick={() => rt.dispatch(FOLLOW_TOGGLE)}>{on ? 'Turn Follow Amber off' : 'Turn Follow Amber on'}</Button>
        </div>
      )}
      <p className="fx-small fx-muted">Tap the badge to switch Follow Amber. While it's on the badge keeps its connection colour and adds a faded second tone, animated. Right-click or long-press it for settings, Test again, the last thing Amber opened and Change badge.</p>
      <Segmented<Tone> label="Second tone" value={s.tone2} onChange={(v) => void saveStyle({ tone2: v, color2: '' })} size="sm" options={TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))} />
      <div className="fx-row fx-row--wrap">
        <TextField label="Custom second colour" value={s.color2} onChange={(v) => { if (!v || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) void saveStyle({ color2: v }); }} hint="#rrggbb, or empty to use the tone above (follows the theme)" />
      </div>
    </div>
  );
}

function LookPanel({ rt }: { rt: AxfRuntime }) {
  const s = useStyle();
  const look = lookOf(s.look);
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap axp-claude-badge__previews">
        <Preview s={s} label={look.name} /><strong className="fx-small">{look.name}</strong>
        {s.icon && <span className="fx-small fx-muted">icon <span className="fx-mono">{s.icon}</span></span>}
      </div>
      <div className="fx-row fx-row--wrap">
        <Button icon="star" onClick={() => rt.openDialog(LOOKS_DIALOG, {})}>Change badge…</Button>
        <Button icon="palette" onClick={() => rt.openDialog(ICONS_DIALOG, {})}>Pick a brand icon…</Button>
      </div>
      <Container title={`All ${LOOK_ASSETS.length} looks`} icon="grid" collapsible defaultOpen={false}><LookPicker /></Container>
    </div>
  );
}

function AnimationRow({ state }: { state: (typeof ANIM_STATES)[number] }) {
  const s = useStyle();
  const a = s.animations[state.id];
  const [demo, setDemo] = useState(0);
  const set = (p: Partial<Animation>) => void saveStyle({ animations: { [state.id]: p } });
  const pulseOnly = state.id === 'opened';
  return (
    <div className="fx-stack axp-claude-badge__anim">
      <div className="fx-row fx-row--wrap axp-claude-badge__previews">
        <strong className="fx-small">{state.label}</strong>
        {pulseOnly
          ? <><Preview s={s} follow pulseAt={demo} label={state.label} /><Button size="sm" tone="ghost" icon="zap" onClick={() => setDemo((n) => n + 1)}>Play</Button></>
          : <Preview s={s} follow={state.id === 'follow'} checkingNow={state.id === 'connecting'} failed={state.id === 'error'} tone={state.id === 'error' ? 'muted' : state.id === 'connecting' ? 'muted' : 'success'} label={state.label} />}
      </div>
      <SelectField label="Animation" value={a.motion} onChange={(v) => set({ motion: v })} options={MOTIONS.map((m) => ({ value: m.id, label: `${m.label}: ${m.description}` }))} />
      {!pulseOnly && <>
        <Slider label="Speed (seconds per loop)" value={a.speed} min={0.5} max={12} step={0.5} unit=" s" onChange={(v) => set({ speed: v })} />
        <Slider label="Intensity" value={Math.round(a.intensity * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set({ intensity: v / 100 })} />
        <Switch label="Loop" checked={a.loop} onChange={(v) => set({ loop: v })} hint="Off: play once each time the state starts" />
      </>}
    </div>
  );
}

function AnimationsPanel() {
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">One animation per state. CSS only; with the system's reduce motion setting on, the badge stays a still two-tone.</p>
      {ANIM_STATES.map((st) => <AnimationRow key={st.id} state={st} />)}
    </div>
  );
}

let runtime: AxfRuntime | null = null;
let watching = false;
let seenOpened = 0;

/** The badge's own right-click / long-press items (the banner's menu stays; Follow Amber adds its own switch item). */
function menuItems(rt: AxfRuntime) {
  const shown = lastShown(rt);
  const items: { id: string; label?: string; icon?: string; action?: string; separator?: boolean }[] = [];
  if (canFollow(rt)) {
    if (shown) items.push({ id: 'claude-badge.reopen', label: `Open again: ${shown.label || shown.target}`, icon: 'external', action: 'followAmber.reopen' });
    if (rt.actions.get('followAmber.recent')) items.push({ id: 'claude-badge.recent', label: 'What Amber opened…', icon: 'clock', action: 'followAmber.recent' });
    items.push({ id: 'claude-badge.sep', separator: true });
  }
  items.push(
    { id: 'claude-badge.change', label: 'Change badge…', icon: 'star', action: `dialog:${LOOKS_DIALOG}` },
    { id: 'claude-badge.icon', label: 'Pick a brand icon…', icon: 'palette', action: `dialog:${ICONS_DIALOG}` },
    { id: 'claude-badge.test', label: 'Test the AI connection', icon: 'refresh', action: 'claude-badge.test' },
    { id: 'claude-badge.settings', label: 'Claude badge settings', icon: 'settings', action: 'settings.open:claude-badge' },
  );
  return items;
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude badge',
  version: '0.4.0',
  appMenu,
  provides: ['banner.badge.claude'],
  // Only a badge on the app's banner: inside a host that hides the banner it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  register(rt) {
    runtime = rt;
    for (const l of LOOK_ASSETS) rt.registry.register(l as never, 'app', ID); // the looks are badge assets too
    if (!watching) {
      watching = true; // hot render: a new icon, the Follow Amber switch or Amber opening something repaints the badge at once
      for (const st of Object.keys(STATES) as BadgeState[]) rt.settings.onChange(STATES[st].key, () => { if (runtime) show(runtime, last, checking); });
      rt.settings.onChange(FOLLOW_KEY, () => { if (runtime) show(runtime, last, checking); });
      seenOpened = rt.badge(FOLLOW_OPENED);
      rt.subscribe(() => {
        const n = rt.badge(FOLLOW_OPENED);
        if (n !== seenOpened) { seenOpened = n; pulse += 1; show(rt, last, checking); }
      });
      // another console (or MCP / the CLI) may change the look: read it again when this one comes back into view
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void loadStyle(); });
    }
    rt.actions.register('claude-badge.test', () => void testConnection(rt), { label: 'Test the AI connection', keywords: ['claude', 'ai', 'badge'] } as never);
    rt.contextExtras.set('*:claude-badge', (_t, payload) => (payload === KEY ? menuItems(rt) : []));
    show(rt, last, !tested && !last);
    void loadStyle();
    if (!tested) { tested = true; setTimeout(() => void testConnection(rt), 600); } // after the backend health check
  },
  dialogs: {
    [LOOKS_DIALOG]: { title: 'Change badge', icon: 'star', render: () => <LookPicker /> },
    [ICONS_DIALOG]: { title: 'Pick a brand icon', icon: 'palette', render: () => <IconPicker /> },
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Claude badge', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The AI connection badge on the banner; tap it for Follow Amber.' }],
  settings: [{
    id: 'claude-badge.icons', label: 'Badge icons', icon: 'star', tab: 'claude-badge', order: 20,
    description: 'The icon the Claude badge shows in each of its three states (when the look and the picked icon leave it to the state).',
    settings: (Object.keys(STATES) as BadgeState[]).map((st) => ({
      key: STATES[st].key, label: STATES[st].setting, kind: 'choice' as const, default: STATES[st].icon, scope: 'device' as const,
      options: ICONS.map((i) => ({ value: i, label: ICON_LABEL(i) })),
    })),
  }],
  settingsPanels: [
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'AI connection', icon: 'sparkles', order: 10, render: () => (runtime ? <SettingsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.follow', tab: 'claude-badge', title: 'Follow Amber (tap the badge)', icon: 'eye', order: 12, render: () => (runtime ? <FollowPanel rt={runtime} /> : null) },
    { id: 'claude-badge.look', tab: 'claude-badge', title: 'Badge look', icon: 'star', order: 13, render: () => (runtime ? <LookPanel rt={runtime} /> : null) },
    { id: 'claude-badge.animations', tab: 'claude-badge', title: 'Animations', icon: 'zap', order: 14, render: () => <AnimationsPanel /> },
    { id: 'claude-badge.states', tab: 'claude-badge', title: 'The three states', icon: 'eye', order: 15, render: () => (runtime ? <StatesPreview rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

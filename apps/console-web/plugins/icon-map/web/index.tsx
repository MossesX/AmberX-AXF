/**
 * Icon map console plugin (ai.amberx.axf.console.icon-map; icon-map@1, framework/core/engines/icon-map-rules.mjs).
 *
 * Every icon, badge and logo slot in every app, plugin and screen, searchable, with a live preview; the icon pack in
 * force (one pick changes every icon) and per-slot picks (one place). State is the plugin's icons.json on the server;
 * this file applies it to the runtime (rt.setIconPack / rt.setIconSlot) on load and every few seconds, and writes it
 * back when a pick is made here, so REST, MCP, the CLI, voice and the page never disagree.
 *
 * Reach: View → Icon map, nav `icon-map`, the actions icon-map.open / icon-map.pack.use:<pack> / icon-map.pack.clear /
 * icon-map.slot.set:<slot>:<glyph> / icon-map.slot.clear:<slot> / icon-map.slot.open:<slot> / icon-map.refresh (search, voice, `function:` control
 * targets), Settings → Plugins → Icon map. Other UI tools reach it through the axf.icon-map@1 web service.
 */
import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './icon-map.css';
import { appMenu } from './menu';
import { IconMapView } from './IconMapView';
import { CHANGED, FOLDER, VIEW, enc, get, packsOf, send, setSelectedSlot, type PackRow, type State } from './shared';

const ID = 'ai.amberx.axf.console.icon-map';
const POLL_MS = 20000;
/** Capability for other UI tools (Theme manager, UI Review, Plugin manager): open a slot, read what a place draws. */
export const ICON_MAP_SERVICE = 'axf.icon-map@1';
const services = () => ((globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices ??= {});

/* ------------------------------------------------------------------ runtime */

/** A pack by id, else by a word of its name, style or tags ("duotone", "filled", "amberx"); the same rule as the server's. */
export function findPack(packs: PackRow[], words: string): PackRow | null {
  const w = words.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!w) return null;
  const exact = packs.find((p) => p.id === w);
  if (exact) return exact;
  const parts = w.replace(/\b(the|icon|icons|pack|set|please)\b/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return packs.find((p) => { const hay = `${p.id} ${p.name.toLowerCase()} ${p.style}`; return parts.every((x) => hay.includes(x)); }) ?? null;
}

/** Make the runtime draw what the server state says (pack + every pick); true when something changed. */
function applyState(rt: AxfRuntime, state: State): boolean {
  let changed = false;
  if ((rt.iconPackId() || '') !== (state.pack || '') && (!state.pack || rt.registry.has('icon-pack', state.pack))) { rt.setIconPack(state.pack || null); changed = true; }
  const have = rt.iconOverrides();
  for (const [slot, glyph] of Object.entries(state.slots ?? {})) if (have[slot] !== glyph) { rt.setIconSlot(slot, glyph); changed = true; }
  for (const slot of Object.keys(have)) if (!(slot in (state.slots ?? {}))) { rt.setIconSlot(slot, null); changed = true; }
  return changed;
}

let lastState = '';
async function pull(rt: AxfRuntime, force = false): Promise<void> {
  try {
    const s = await get<State>('state');
    const key = JSON.stringify([s.pack, s.slots]);
    if (!force && key === lastState) return;
    lastState = key;
    applyState(rt, s);
    window.dispatchEvent(new Event(CHANGED));
  } catch { /* server part off: the runtime keeps its saved picks */ }
}

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Every icon, badge and logo slot in the console and its plugins, with the icon pack in force and per-slot picks.</p>
      <p className="fx-muted" style={{ margin: 0 }}>Also on the API: REST /api/plugins/icon-map, MCP icon-map_* tools, the CLI (axf icon-map …) and voice ("switch to the duotone icon pack").</p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="grid" onClick={() => rt.dispatch(`nav:${VIEW}`)}>Open icon map</Button>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Icon map',
  version: '0.1.0',
  appMenu,
  provides: [ICON_MAP_SERVICE],
  register(rt) {
    const packs = () => packsOf(rt);
    const say = (text: string, tone: 'success' | 'warning' | 'danger' = 'success') => rt.toast(text, tone, 'Icon map');
    rt.actions.register('icon-map.open', () => rt.dispatch(`nav:${VIEW}`), { label: 'Icon map', effect: 'navigate' });
    rt.actions.register('icon-map.pack.use', (args) => {
      const words = args.join(':');
      const p = findPack(packs(), words);
      if (!p) { say(`No icon pack matches "${words}". Packs: ${packs().map((x) => x.id).join(', ') || 'none'}.`, 'warning'); return; }
      if (!rt.setIconPack(p.id)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('PUT', 'pack', { pack: p.id, by: 'console' }).then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say(`${p.name} is the icon pack.`);
    }, { label: 'Switch the icon pack', params: true, effect: 'write' });
    rt.actions.register('icon-map.pack.clear', () => {
      if (!rt.setIconPack(null)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('DELETE', 'pack').then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say('Back to the branding’s icon pack.');
    }, { label: 'Back to the branding icon pack', effect: 'write' });
    rt.actions.register('icon-map.slot.set', ([slot, glyph]) => {
      if (!slot || !glyph) { say('Say which slot and which glyph: icon-map.slot.set:<slot id>:<glyph>.', 'warning'); return; }
      if (!rt.setIconSlot(slot, glyph)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('PUT', `slot/${enc(slot)}`, { glyph, by: 'console' }).then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say(`${slot} draws ${glyph}.`);
    }, { label: 'Pick one slot’s icon', params: true, effect: 'write' });
    rt.actions.register('icon-map.slot.clear', ([slot]) => {
      if (!slot) { say('Say which slot: icon-map.slot.clear:<slot id>.', 'warning'); return; }
      if (!rt.setIconSlot(slot, null)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('DELETE', `slot/${enc(slot)}`).then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say(`${slot} follows the pack again.`);
    }, { label: 'Drop one slot’s pick', params: true, effect: 'write' });
    rt.actions.register('icon-map.refresh', () => { void pull(rt, true); }, { label: 'Reload the icon map', effect: 'read' });
    const openSlot = (slot: string) => { setSelectedSlot(slot || null); rt.dispatch(`nav:${VIEW}`); };
    rt.actions.register('icon-map.slot.open', ([slot]) => openSlot(slot ?? ''), { label: 'Open one slot in the icon map', params: true, effect: 'navigate' });
    // axf.icon-map@1: how the other UI tools reach the map without naming this folder
    services()[ICON_MAP_SERVICE] = {
      version: 1,
      open: openSlot,
      resolve: (name: string, slot?: string, role?: string) => rt.iconResolution(name, slot, role),
      setSlot: (slot: string, glyph: string | null) => rt.dispatch(glyph ? `icon-map.slot.set:${slot}:${glyph}` : `icon-map.slot.clear:${slot}`),
      usePack: (pack: string) => rt.dispatch(`icon-map.pack.use:${pack}`),
      packs: () => packsOf(rt),
      map: (query = '') => get(`map?${query}`),
    };
    // the server's state is the one every transport writes: follow it
    void pull(rt);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(rt); }, POLL_MS);
    window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  },
  views: { [VIEW]: { title: 'Icon map', icon: 'grid', render: () => <IconMapView /> } },
  nav: { label: 'Appearance', items: [{ id: VIEW, label: 'Icon map', icon: 'grid', view: VIEW }] },
  settingsTabs: [{ id: 'icon-map', label: 'Icon map', icon: 'grid', order: 62, parent: 'plugins' }],
  settingsPanels: [
    { id: 'icon-map.open', tab: 'icon-map', title: 'Icon map', icon: 'grid', order: 5, render: () => <OpenPanel /> },
    { id: 'icon-map.lifecycle', tab: 'icon-map', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

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
import { iconMapRules, type AxfRuntime } from '@console/axf/core';
import type { HubValue } from '@console/axf/libs/hubstore';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './icon-map.css';
import { appMenu } from './menu';
import { IconMapView } from './IconMapView';
import { CHANGED, FOLDER, VIEW, enc, get, hubPacks, packsOf, send, setSelectedSlot, type HubPackRow, type PackRow, type State } from './shared';

const ID = 'ai.amberx.axf.console.icon-map';
const POLL_MS = 20000;
const PACK_KEY = iconMapRules.ICON_PACK_KEY;
const SLOT_KEY = iconMapRules.ICON_SLOT_KEY('');
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
  // words in the id or name first ("duotone" → phosphor-duotone), then the style too
  return packs.find((p) => { const hay = `${p.id} ${p.name.toLowerCase()}`; return parts.every((x) => hay.includes(x)); })
    ?? packs.find((p) => { const hay = `${p.id} ${p.name.toLowerCase()} ${p.style}`; return parts.every((x) => hay.includes(x)); }) ?? null;
}

/** The pack the skin in force names itself ('' = the branding's). */
function skinOwnPack(rt: AxfRuntime): string {
  const id = rt.skinInForce().id;
  const d = id ? (rt.registry.get('skin', id)?.data as { iconPack?: string } | undefined) : undefined;
  return typeof d?.iconPack === 'string' && rt.registry.has('icon-pack', d.iconPack) ? d.iconPack : '';
}

/**
 * The pack the console should draw: the hand pick, else this skin's default set in the Icon map, else the skin's own
 * pack (else the branding's). Returns undefined when nothing here decides (no pick, no default, nothing dropped).
 */
let decided = '';
function packFor(rt: AxfRuntime, state: State): string | undefined {
  if (state.pack) return state.pack;
  const skin = rt.skinInForce().id;
  const def = skin ? state.skinPacks?.[skin] : '';
  if (def) return def;
  return decided ? skinOwnPack(rt) : undefined;
}

/** Make the runtime draw what the server state says (pack + every pick); true when something changed. */
function applyState(rt: AxfRuntime, state: State): boolean {
  let changed = false;
  const target = packFor(rt, state);
  if (target !== undefined && (rt.iconPackId() || '') !== target && (!target || rt.registry.has('icon-pack', target))) { rt.setIconPack(target || null); changed = true; }
  if (target !== undefined) decided = state.pack || state.skinPacks?.[rt.skinInForce().id] || '';
  const have = rt.iconOverrides();
  for (const [slot, glyph] of Object.entries(state.slots ?? {})) if (have[slot] !== glyph) { rt.setIconSlot(slot, glyph); changed = true; }
  for (const slot of Object.keys(have)) if (!(slot in (state.slots ?? {}))) { rt.setIconSlot(slot, null); changed = true; }
  return changed;
}

let lastStateObj: State | null = null;
let lastState = '';
async function pull(rt: AxfRuntime, force = false): Promise<void> {
  try {
    const s = await get<State>('state');
    lastStateObj = s;
    const key = JSON.stringify([s.pack, s.slots, s.skinPacks]);
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
      if (!rt.setIconPack(skinOwnPack(rt) || null)) { say('Your role cannot change the look.', 'danger'); return; }
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
    // Restore previous edit / Restore from axHub: the server keeps the history and the hub copy, so REST / MCP / CLI agree
    const restore = (path: string, from: string, what: string) => {
      const src = from === 'hub' ? 'hub' : 'previous';
      void send<{ ok: boolean; message?: string }>('POST', path, { from: src, by: 'console' }).then(
        (r) => { void pull(rt, true); say(r.message || `${what} restored ${src === 'hub' ? 'from axHub' : 'to the previous edit'}.`); },
        (e: Error) => say(`${what}: ${e.message.replace(/^\d+ /, '').slice(0, 160)}`, 'warning'),
      );
    };
    rt.actions.register('icon-map.slot.restore', ([slot, from = 'previous']) => {
      if (!slot) { say('Say which slot: icon-map.slot.restore:<slot id>:previous|hub.', 'warning'); return; }
      restore(`slot/${enc(slot)}/restore`, from, slot);
    }, { label: 'Restore one slot (previous edit or axHub)', params: true, effect: 'write' });
    rt.actions.register('icon-map.pack.restore', ([from = 'previous']) => restore('pack/restore', from, 'The icon pack'), { label: 'Restore the icon pack (previous edit or axHub)', params: true, effect: 'write' });
    // The template: one icon-pack@1 file mapping every role to a glyph (from a pack, else the role defaults)
    rt.actions.register('icon-map.template', ([from = '']) => {
      void get<{ pack: { id: string } }>(`template${from ? `?from=${encodeURIComponent(from)}` : ''}`).then((r) => {
        const url = URL.createObjectURL(new Blob([`${JSON.stringify(r.pack, null, 2)}\n`], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `${r.pack.id}.json`; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        say(`Template ${r.pack.id}.json: every role mapped. Edit it and import it as a pack.`);
      }, (e: Error) => say(`Template: ${e.message.slice(0, 160)}`, 'warning'));
    }, { label: 'Download the icon pack template', params: true, effect: 'read' });
    // The hub copy: when the look (axf.icons.* ride axHub's appearance document) loads from axHub, tell the server
    let hubReady = false;
    const hubCopy = () => {
      const ready = rt.hasAppearanceSource() && rt.appearanceState()?.status === 'ready';
      if (ready === hubReady) return;
      hubReady = ready;
      if (!ready) return;
      const saved = rt.settings.savedValues();
      const slots: Record<string, string> = {};
      for (const [k, v] of Object.entries(saved)) if (k.startsWith(SLOT_KEY) && typeof v === 'string' && v) slots[k.slice(SLOT_KEY.length)] = v;
      const pack = typeof saved[PACK_KEY] === 'string' ? (saved[PACK_KEY] as string) : '';
      void send('PUT', 'hub-copy', { pack, slots }).catch(() => undefined);
    };
    rt.subscribe(hubCopy);
    hubCopy();
    // Packs are assets: imported ones (the server's data folder) join the registry; a skin change re-applies its default
    let lastSkin = rt.skinInForce().id;
    rt.subscribe(() => { const k = rt.skinInForce().id; if (k !== lastSkin) { lastSkin = k; if (lastStateObj) applyState(rt, lastStateObj); } });
    const loadImported = () => get<{ packs: unknown[] }>('packs/imported').then((r) => {
      for (const a of r.packs) { const id = (a as { id?: string }).id; if (id) rt.registry.register(a, 'imported'); }
      window.dispatchEvent(new Event(CHANGED));
    }, () => undefined);
    void loadImported();
    const download = (name: string, body: unknown) => {
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    rt.actions.register('icon-map.pack.export', ([id]) => {
      if (!id) { say('Say which pack: icon-map.pack.export:<pack id>.', 'warning'); return; }
      void get<{ pack: unknown }>(`packs/${encodeURIComponent(id)}/export`).then((r) => { download(`${id}.json`, r.pack); say(`${id}.json downloaded.`); }, (e: Error) => say(`Export: ${e.message.slice(0, 160)}`, 'warning'));
    }, { label: 'Export an icon pack (file)', params: true, effect: 'read' });
    rt.actions.register('icon-map.pack.import', (args) => {
      const text = args.join(':');
      if (!text.trim().startsWith('{')) { openSlot(''); window.dispatchEvent(new Event('axf:icon-map-import')); return; }
      let pack: unknown; try { pack = JSON.parse(text); } catch { say('That is not valid JSON.', 'warning'); return; }
      void send<{ message: string }>('POST', 'packs/import', { pack, by: 'console' }).then((r) => { say(r.message); void loadImported(); }, (e: Error) => say(`Import: ${e.message.replace(/^\d+ /, '').slice(0, 200)}`, 'warning'));
    }, { label: 'Import an icon pack', params: true, effect: 'write' });
    rt.actions.register('icon-map.pack.remove', ([id]) => {
      if (!id) { say('Say which imported pack: icon-map.pack.remove:<pack id>.', 'warning'); return; }
      void send('DELETE', `packs/imported/${encodeURIComponent(id)}`).then(() => { void pull(rt, true); say(`${id} removed (this console keeps drawing it until it reloads).`); }, (e: Error) => say(`Remove: ${e.message.slice(0, 160)}`, 'warning'));
    }, { label: 'Remove an imported icon pack', params: true, effect: 'write' });
    rt.actions.register('icon-map.skin.pack', ([skin, ...rest]) => {
      const pack = rest.join(':');
      if (!skin || !pack) { say('Say which skin and pack: icon-map.skin.pack:<skin id>:<pack>.', 'warning'); return; }
      void send<{ message: string }>('PUT', `skin-packs/${encodeURIComponent(skin)}`, { pack, by: 'console' }).then((r) => { void pull(rt, true); say(r.message); }, (e: Error) => say(`Skin default: ${e.message.slice(0, 160)}`, 'warning'));
    }, { label: 'Set a skin’s default icon pack', params: true, effect: 'write' });
    rt.actions.register('icon-map.skin.clear', ([skin]) => {
      if (!skin) { say('Say which skin: icon-map.skin.clear:<skin id>.', 'warning'); return; }
      void send('DELETE', `skin-packs/${encodeURIComponent(skin)}`).then(() => { void pull(rt, true); say(`${skin} draws the pack it names again.`); }, () => undefined);
    }, { label: 'Drop a skin’s default icon pack', params: true, effect: 'write' });
    // axHub's shared icon packs (the hub asset library for this type): share, list, take one in
    const hubRefresh = async (quiet = false) => {
      try {
        const rows = Object.values(await hubPacks(rt).rows());
        const list: HubPackRow[] = rows.map((r) => ({ id: r.id, name: r.name, style: r.style, themable: r.themable !== false, by: r.by, at: r.at }));
        await send('PUT', 'hub-packs', { packs: list });
        window.dispatchEvent(new Event(CHANGED));
        if (!quiet) say(`${list.length} icon pack${list.length === 1 ? '' : 's'} shared on axHub.`);
      } catch (e) { if (!quiet) say(`axHub: ${(e as Error).message.slice(0, 160)}`, 'warning'); }
    };
    rt.actions.register('icon-map.hub.refresh', () => { void hubRefresh(); }, { label: 'Read the icon packs shared on axHub', effect: 'read' });
    rt.actions.register('icon-map.pack.share', ([id]) => {
      if (!id) { say('Say which pack: icon-map.pack.share:<pack id>.', 'warning'); return; }
      void get<{ pack: Record<string, unknown> }>(`packs/${encodeURIComponent(id)}/export`).then(async (r) => {
        const d = (r.pack.data ?? {}) as { style?: string; themable?: boolean };
        await hubPacks(rt).put(id, { id, name: String(r.pack.name ?? id), style: d.style ?? 'outline', themable: d.themable !== false, by: 'console', at: new Date().toISOString(), pack: r.pack as HubValue });
        say(`${id} shared on axHub: every app on this project can take it.`);
        void hubRefresh(true);
      }).catch((e: Error) => say(`Share: ${e.message.slice(0, 200)}`, 'warning'));
    }, { label: 'Share an icon pack on axHub', params: true, effect: 'write' });
    rt.actions.register('icon-map.pack.fromhub', ([id]) => {
      if (!id) { say('Say which shared pack: icon-map.pack.fromhub:<pack id>.', 'warning'); return; }
      void hubPacks(rt).get(id).then(async (row) => {
        if (!row?.pack) { say(`axHub has no shared pack "${id}".`, 'warning'); return; }
        await send('POST', 'packs/import', { pack: row.pack, replace: true, by: 'axhub' });
        await loadImported();
        say(`${row.name} taken from axHub: it is in the pack list now.`);
      }).catch((e: Error) => say(`From axHub: ${e.message.replace(/^\d+ /, '').slice(0, 200)}`, 'warning'));
    }, { label: 'Take a shared icon pack from axHub', params: true, effect: 'write' });
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

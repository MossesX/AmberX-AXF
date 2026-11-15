/**
 * Elements from a plugin's manifest (plugin.json, plugin@1), so a new plugin appears in the UI Manager the moment it is
 * installed, with nothing written for the UI Manager:
 *
 *   the plugin itself            plugin:<id>                         (category Plugins)
 *   provides view:<v>            target:view:<v>                     (Screens & pages)
 *   provides settings-tab:<t>    target:settings-tab:<t>             (Settings)
 *   provides dialog:<d>          target:dialog:<d>                   (Dialogs & popups)
 *   provides banner:<b>          plugin:<id>/banner:<b>              (Chrome & navigation)
 *   provides context-menu:<m>    plugin:<id>/context-menu:<m>        (Chrome & navigation)
 *   uiElements: [ … ]            <id>/<row id>                       (declared extras: grids, toolbars, panels …)
 *
 * The target:… ids are the ones the open console reports for the same screens, so the server's element and the live
 * one merge into one entry (web/live.ts mergeElements). Pure: no IO. A plugin is named by its id, never its folder.
 */
import { elementsFromManifest, normalizeElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const humanize = (s) => String(s).replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** What each `provides` kind becomes; kinds not listed here (service, action, asset, slot …) have no element of their own. */
const PROVIDES = {
  view: (v, m) => ({ id: `target:view:${v}`, label: m.tabable?.view === v && m.tabable?.label ? m.tabable.label : v === m.id?.split('.').pop() ? m.name : humanize(v), kind: 'view', category: 'screens', address: `view:${v}` }),
  'settings-tab': (t, m) => ({ id: `target:settings-tab:${t}`, label: `${m.name || humanize(t)} settings`, kind: 'tab', category: 'settings', address: `settings-tab:${t}` }),
  dialog: (d) => ({ id: `target:dialog:${d}`, label: humanize(d), kind: 'dialog', category: 'dialogs', address: `dialog:${d}`, selector: '.fx-dialog' }),
  banner: (b, m) => ({ id: `plugin:${m.id}/banner:${b}`, label: `${humanize(b)} (banner)`, kind: 'banner', category: 'chrome' }),
  'context-menu': (c, m) => ({ id: `plugin:${m.id}/context-menu:${c}`, label: `${humanize(c)} menu`, kind: 'context-menu', category: 'chrome' }),
};

export function manifestElements(manifest, types = {}) {
  const m = isObj(manifest) ? manifest : {};
  if (m.$axf !== 'plugin@1' || typeof m.id !== 'string' || !m.id) return [];
  const app = 'console';
  const raw = [{ id: `plugin:${m.id}`, label: m.name || humanize(m.id.split('.').pop()), kind: 'plugin', category: 'plugins' }];
  for (const p of Array.isArray(m.provides) ? m.provides : []) {
    const at = typeof p === 'string' ? p.indexOf(':') : -1;
    const make = at > 0 ? PROVIDES[p.slice(0, at)] : null;
    if (make && p.slice(at + 1)) raw.push(make(p.slice(at + 1), m));
  }
  const derived = raw.map((r) => normalizeElement({ ...r, plugin: m.id, app }, types)).filter(Boolean);
  const declared = elementsFromManifest(m, types).map((e) => ({ ...e, app: e.app ?? app }));
  // a declared element with the same id as a derived one wins (it says more: selector, tokens, a better label)
  const ids = new Set(declared.map((e) => e.id));
  return [...declared, ...derived.filter((e) => !ids.has(e.id))];
}

/** Every plugin's elements, one id once (two plugins providing the same view: the first keeps it). */
export function allManifestElements(manifests, types = {}) {
  const seen = new Set();
  const out = [];
  for (const m of manifests) for (const e of manifestElements(m, types)) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out;
}

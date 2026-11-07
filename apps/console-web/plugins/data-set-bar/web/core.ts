/**
 * Data set bar — pure core (no React): ids, settings keys, default picks, the console actions, and the context-menu items
 * the right-click menu and the Registry Browser's asset cards show. The engine itself (normalizers, attachments, fuzzy
 * search, rules, sort) is the framework's: core/engines/datasetbar.ts (data-set-bar@1).
 * Self-test: npx -y tsx apps/console-web/plugins/data-set-bar/test.mts
 */
import {
  attachmentPieces, DSB_PIECE_LABELS, DSB_PIECE_TYPES, DSB_PIECES, DSB_PLACEMENT_LABELS, DSB_PLACEMENTS, dsbStateActive, dsbSummary,
  type DataSetBarConfig, type DsbAttachment, type DsbPiece, type DsbPlacement,
} from '@console/axf/core/engines/datasetbar';
import type { MenuEntry } from '@console/axf/core/engines/windows';

export const FOLDER = 'data-set-bar';
export const OWNER = 'data-set-bar';
export const PLUGIN_ID = 'ai.amberx.axf.console.data-set-bar';
export const FILTER_DIALOG = 'data-set-bar.filter';
export const SORT_DIALOG = 'data-set-bar.sort';
export const SETTINGS_DIALOG = 'data-set-bar.settings';
export const SETTINGS_TAB = 'data-set-bar';

/** Settings keys (the app's settings: per device, local-first). */
export const KEY_ATTACHMENTS = 'data-set-bar.attachments';
export const KEY_DEFAULTS = 'data-set-bar.defaults';
export const ALL_KEYS = [KEY_ATTACHMENTS, KEY_DEFAULTS];

/** What a plain "Attach data set bar" uses: the bar asset, its placement, and the asset each piece alone uses. */
export interface Defaults { bar: string; placement: DsbPlacement | ''; search: string; filter: string; sort: string }
export const DEFAULTS: Defaults = { bar: 'default', placement: '', search: 'dataset', filter: 'default', sort: 'default' };
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,47}$/.test(v);
export function parseDefaults(v: unknown): Defaults {
  let j: unknown = v;
  if (typeof v === 'string') { try { j = v ? JSON.parse(v) : {}; } catch { j = {}; } }
  const o = (j && typeof j === 'object' ? j : {}) as Partial<Record<keyof Defaults, unknown>>;
  return {
    bar: idOk(o.bar) ? o.bar : DEFAULTS.bar, placement: (DSB_PLACEMENTS as readonly string[]).includes(o.placement as string) ? (o.placement as DsbPlacement) : '',
    search: idOk(o.search) ? o.search : DEFAULTS.search, filter: idOk(o.filter) ? o.filter : DEFAULTS.filter, sort: idOk(o.sort) ? o.sort : DEFAULTS.sort,
  };
}

/* ---------------- actions (voice through console_action, REST / MCP / CLI through plugin-commands) ---------------- */

export const ACTIONS = {
  list: 'data-set-bar.list', attach: 'data-set-bar.attach', detach: 'data-set-bar.detach', piece: 'data-set-bar.piece', unpiece: 'data-set-bar.unpiece',
  move: 'data-set-bar.move', bar: 'data-set-bar.bar', reset: 'data-set-bar.reset', settings: 'data-set-bar.settings', filter: 'data-set-bar.filter', sort: 'data-set-bar.sort',
  search: 'data-set-bar.search', clear: 'data-set-bar.clear',
} as const;
/** Action arguments are joined with ':'; data set ids may hold ':' so every argument travels encoded. */
export const enc = (v: string) => encodeURIComponent(v);
export const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
export const act = (id: string, ...args: string[]) => (args.length ? `${id}:${args.map(enc).join(':')}` : id);

export const isPiece = (v: unknown): v is DsbPiece => (DSB_PIECES as readonly string[]).includes(v as string);
export const isPlacement = (v: unknown): v is DsbPlacement => (DSB_PLACEMENTS as readonly string[]).includes(v as string);

/* ---------------- the right-click block on a data set ---------------- */

export interface AssetChoice { id: string; name: string }
export interface MenuContext {
  /** data-set-bar assets on offer */
  bars: AssetChoice[];
  /** assets per piece type (search-bar ones already narrowed to scope dataset) */
  pieces: Record<DsbPiece, AssetChoice[]>;
  /** the bar as drawn now (null when not attached) */
  resolved: DataSetBarConfig | null;
}

const placementItems = (dataset: string, action: string, current?: DsbPlacement): MenuEntry[] =>
  DSB_PLACEMENTS.map((p) => ({ id: `dsb-${action}-${p}`, label: DSB_PLACEMENT_LABELS[p], icon: p === 'floating' ? 'move' : p === 'bottom' ? 'chevron-down' : p === 'inline' ? 'minus' : 'chevron-up', action: act(action, dataset, p), ...(current === p ? { label: `${DSB_PLACEMENT_LABELS[p]} (current)` } : {}) }));

/**
 * Items for the context menu opened on a data set (the host records which one in `rt.contextDataset`). Not attached:
 * **Attach data set bar ▸** (one entry per placement) and **Attach piece ▸**. Attached: one **Data set bar ▸** block with
 * Settings…, Filter… / Sort…, Move ▸, Change bar ▸, Attach / Detach piece ▸, Reset to default and Detach data set bar.
 */
export function datasetContextItems(dataset: string, att: DsbAttachment | null, ctx: MenuContext): MenuEntry[] {
  if (!dataset) return [];
  const pieceEntries = (missing: boolean): MenuEntry[] => DSB_PIECES
    .filter((p) => (missing ? !ctx.resolved?.[p] : !!ctx.resolved?.[p]))
    .map((p) => ({ id: `dsb-${missing ? 'piece' : 'unpiece'}-${p}`, label: DSB_PIECE_LABELS[p], icon: p === 'search' ? 'search' : p === 'filter' ? 'sliders' : 'chevron-down', action: act(missing ? ACTIONS.piece : ACTIONS.unpiece, dataset, p) }));
  if (!att) {
    return [
      { id: 'dsb-attach', label: 'Attach data set bar', icon: 'list', items: placementItems(dataset, ACTIONS.attach) },
      { id: 'dsb-attach-piece', label: 'Attach piece', icon: 'plus', items: pieceEntries(true) },
    ];
  }
  const cfg = ctx.resolved;
  const items: MenuEntry[] = [
    { id: 'dsb-settings', label: 'Settings…', icon: 'settings', action: act(ACTIONS.settings, dataset) },
  ];
  if (cfg?.filter) items.push({ id: 'dsb-filter', label: 'Filter…', icon: 'sliders', action: act(ACTIONS.filter, dataset) });
  if (cfg?.sort) items.push({ id: 'dsb-sort', label: 'Sort…', icon: 'chevron-down', action: act(ACTIONS.sort, dataset) });
  items.push({ id: 'dsb-sep1', separator: true });
  items.push({ id: 'dsb-move', label: 'Move', icon: 'move', items: placementItems(dataset, ACTIONS.move, cfg?.placement) });
  if (ctx.bars.length) items.push({ id: 'dsb-change', label: 'Change bar', icon: 'layers', items: ctx.bars.map((b) => ({ id: `dsb-bar-${b.id}`, label: b.name, icon: 'list', action: act(ACTIONS.bar, dataset, b.id), ...(att.bar === b.id ? { label: `${b.name} (current)` } : {}) })) });
  const missing = pieceEntries(true), present = pieceEntries(false);
  if (missing.length) items.push({ id: 'dsb-attach-piece', label: 'Attach piece', icon: 'plus', items: missing });
  if (present.length) items.push({ id: 'dsb-detach-piece', label: 'Detach piece', icon: 'minus', items: present });
  items.push({ id: 'dsb-sep2', separator: true });
  if (dsbStateActive(att.state)) items.push({ id: 'dsb-clear', label: `Clear (${dsbSummary(att.state)})`, icon: 'x', action: act(ACTIONS.clear, dataset) });
  items.push({ id: 'dsb-reset', label: 'Reset to default', icon: 'undo', action: act(ACTIONS.reset, dataset) });
  items.push({ id: 'dsb-detach', label: 'Detach data set bar', icon: 'trash', action: act(ACTIONS.detach, dataset) });
  return [{ id: 'dsb-root', label: 'Data set bar', icon: 'list', items }];
}

/* ---------------- the Registry Browser: right-click an asset card → Attach to data set ▸ ---------------- */

export interface DatasetChoice { id: string; label: string; mounted: boolean }
/** `type:id` of the card → items when the asset is one of ours; data sets on screen first, at most `max`. */
export function assetCardItems(payload: string, datasets: DatasetChoice[], max = 12): MenuEntry[] {
  const i = payload.indexOf(':'); if (i <= 0) return [];
  const type = payload.slice(0, i), id = payload.slice(i + 1);
  const piece = (Object.keys(DSB_PIECE_TYPES) as DsbPiece[]).find((p) => DSB_PIECE_TYPES[p] === type);
  if (type !== 'data-set-bar' && !piece) return [];
  const list = [...datasets].sort((a, b) => Number(b.mounted) - Number(a.mounted) || a.label.localeCompare(b.label)).slice(0, max);
  if (!list.length) return [{ id: 'dsb-card-none', label: 'Attach to data set: open a grid first', icon: 'grid' }];
  const items: MenuEntry[] = list.map((d) => ({ id: `dsb-card-${d.id}`, label: d.mounted ? d.label : `${d.label} (not on screen)`, icon: 'grid', action: type === 'data-set-bar' ? act(ACTIONS.attach, d.id, '', id) : act(ACTIONS.piece, d.id, piece!, id) }));
  return [{ id: 'dsb-card-attach', label: type === 'data-set-bar' ? 'Attach to data set' : `Attach ${DSB_PIECE_LABELS[piece!].toLowerCase()} to data set`, icon: 'list', items }];
}

/** One line per attachment for the `list` action and the settings tab. */
export function describeAttachment(att: DsbAttachment, cfg: DataSetBarConfig, label?: string): string {
  const pieces = attachmentPieces(cfg).map((p) => p.piece).join(' + ') || 'nothing';
  const s = dsbSummary(att.state);
  return `${label ?? att.dataset}: ${att.bar ? `bar ${att.bar}` : 'pieces'} (${pieces}), ${cfg.placement}${s ? `, ${s}` : ''}`;
}

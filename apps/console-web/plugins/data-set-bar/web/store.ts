/**
 * Data set bar — settings-backed store (local-first): the attachments map (one record per data set, data-set-bar@1
 * `DsbAttachment`) and the default picks. Values live in the app's settings on this device (per key, last save wins),
 * so a bar attached here stays here; nothing is written to the server or the hub.
 */
import { useSyncExternalStore } from 'react';
import { useRuntime } from '@console/axf/react';
import {
  attachBar, attachPiece, detachBar, detachPiece, normalizeAttachment, parseAttachments, resetAttachment, resolveAttachment, setAttachmentPlacement, setAttachmentState,
  type DataSetBarConfig, type DsbAttachment, type DsbAttachments, type DsbPiece, type DsbPlacement, type DsbState,
} from '@console/axf/core/engines/datasetbar';
import { KEY_ATTACHMENTS, KEY_DEFAULTS, parseDefaults, type Defaults } from './core';

type Rt = ReturnType<typeof useRuntime>;

/** Re-render on any settings change (settings keep a revision counter). */
export function useSettingsRevision(rt: Rt): number {
  return useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision, rt.settings.getRevision);
}

export const readAttachments = (rt: Rt): DsbAttachments => parseAttachments(rt.settings.get(KEY_ATTACHMENTS));
export function writeAttachments(rt: Rt, map: DsbAttachments): void {
  if (Object.keys(map).length) rt.settings.set(KEY_ATTACHMENTS, JSON.stringify(map)); else rt.settings.clear(KEY_ATTACHMENTS);
}
export const readDefaults = (rt: Rt): Defaults => parseDefaults(rt.settings.get(KEY_DEFAULTS));
export const writeDefaults = (rt: Rt, d: Defaults) => rt.settings.set(KEY_DEFAULTS, JSON.stringify(d));

/** The bar asset's data an attachment draws from (null = pieces only, or the asset is gone). */
export function barData(rt: Rt, att: DsbAttachment | null | undefined): unknown | null {
  if (!att?.bar) return null;
  return rt.registry.get('data-set-bar', att.bar)?.data ?? null;
}
export const resolveFor = (rt: Rt, att: DsbAttachment): DataSetBarConfig => resolveAttachment(att, barData(rt, att));

/* ---------------- the moves (every surface calls these: menu, actions, settings, Registry Browser) ---------------- */

export function doAttach(rt: Rt, dataset: string, placement?: DsbPlacement | '', bar?: string): void {
  const d = readDefaults(rt);
  const id = bar && rt.registry.get('data-set-bar', bar) ? bar : rt.registry.get('data-set-bar', d.bar) ? d.bar : rt.registry.list('data-set-bar')[0]?.id ?? 'default';
  const p = placement || d.placement || undefined;
  writeAttachments(rt, attachBar(readAttachments(rt), dataset, { bar: id, ...(p ? { placement: p } : {}) }));
}
export function doAttachPiece(rt: Rt, dataset: string, piece: DsbPiece, asset?: string, placement?: DsbPlacement | ''): void {
  const d = readDefaults(rt);
  const id = asset || d[piece];
  writeAttachments(rt, attachPiece(readAttachments(rt), dataset, piece, id, placement ? { placement } : {}));
}
export const doDetach = (rt: Rt, dataset: string) => writeAttachments(rt, detachBar(readAttachments(rt), dataset));
export function doDetachPiece(rt: Rt, dataset: string, piece: DsbPiece): void {
  const map = readAttachments(rt);
  writeAttachments(rt, detachPiece(map, dataset, piece, barData(rt, map[dataset])));
}
export const doMove = (rt: Rt, dataset: string, placement: DsbPlacement) => writeAttachments(rt, setAttachmentPlacement(readAttachments(rt), dataset, placement));
export function doChangeBar(rt: Rt, dataset: string, bar: string): void {
  const map = readAttachments(rt); const cur = map[dataset]; if (!cur || !rt.registry.get('data-set-bar', bar)) return;
  writeAttachments(rt, { ...map, [dataset]: { ...cur, bar, updatedAt: new Date().toISOString() } });
}
export function doReset(rt: Rt, dataset: string): void {
  const map = readAttachments(rt); const cur = map[dataset]; if (!cur) return;
  writeAttachments(rt, { ...map, [dataset]: resetAttachment(cur) });
}
export const setState = (rt: Rt, dataset: string, state: DsbState) => writeAttachments(rt, setAttachmentState(readAttachments(rt), dataset, state));
/** Replace one attachment record (saved filters / sorts, overrides edited in its settings dialog, the pill's spot). */
export function updateAttachment(rt: Rt, dataset: string, fn: (att: DsbAttachment) => DsbAttachment): void {
  const map = readAttachments(rt); const cur = map[dataset]; if (!cur) return;
  writeAttachments(rt, { ...map, [dataset]: normalizeAttachment(fn(cur), dataset) });
}

/* ---------------- hooks ---------------- */

export function useAttachments(): DsbAttachments { const rt = useRuntime(); useSettingsRevision(rt); return readAttachments(rt); }
export function useAttachment(dataset: string): DsbAttachment | null { const rt = useRuntime(); useSettingsRevision(rt); return readAttachments(rt)[dataset] ?? null; }
export function useDefaults(): Defaults { const rt = useRuntime(); useSettingsRevision(rt); return readDefaults(rt); }

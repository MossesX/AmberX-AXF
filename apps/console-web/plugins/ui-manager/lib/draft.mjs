/*
 * The window's draft, rebased for Apply (last save wins per key): only the keys the draft changed against the
 * document it started from are written onto what is saved now, so a save made meanwhile elsewhere is kept.
 */
import { diffOverrides, normalizeOverrides, withoutOverride } from '../../../../../framework/core/engines/ui-manager-rules.mjs';

/** → the document Apply saves: `now` with the draft's own changes (vs `start`) written on top. */
export function rebaseDraft(start, draft, now) {
  let doc = normalizeOverrides(now);
  for (const c of diffOverrides(start, draft)) {
    doc = c.to === undefined ? withoutOverride(doc, c.element, c.prop)
      : normalizeOverrides({ ...doc, elements: { ...doc.elements, [c.element]: { ...(doc.elements[c.element] ?? {}), [c.prop]: c.to } } });
  }
  return doc;
}

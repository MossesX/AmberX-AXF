/**
 * Tab control hooks (tab-control@1; build tabs-api-control, Brett Nov 8 2026): TabGroup, hand-drawn strips, Container
 * and settings sections register here; the registry and the path runner are in tabRegistry.ts.
 */
import { useEffect, useId, useRef } from 'react';
import { useRuntime } from './AxfProvider';
import { registerTabTarget } from './tabRegistry';

export { installTabControl, openTabPath, registerTabTarget, liveTabTargets, activeTabsOf, tabDeepLink, tabScreenOf, type TabOpenResult, type LiveTarget } from './tabRegistry';

/**
 * A tab row registers itself (TabGroup does this; a hand-drawn strip must too — check-tab-actions.mjs fails CI otherwise).
 * `onSelect` is what a tap on that tab does.
 */
export function useTabControl(row: { id: string; label: string; value: string; tabs: readonly { value: string; label: string; disabled?: boolean }[]; onSelect: (value: string) => void }) {
  const rt = useRuntime();
  const key = useId();
  const select = useRef(row.onSelect);
  select.current = row.onSelect;
  const sig = row.tabs.filter((t) => !t.disabled).map((t) => `${t.value}\u0001${t.label}`).join('\u0002');
  useEffect(() => {
    const tabs = row.tabs.filter((t) => !t.disabled).map((t) => ({ value: t.value, label: t.label }));
    return registerTabTarget(rt, key, { kind: 'tab-group', id: row.id, label: row.label, screen: rt.getState().view, tabs, value: row.value, select: (v) => select.current(v) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, key, row.id, row.label, row.value, sig]);
}

/** A titled section (Container, a settings group) registers itself so a path part can expand it and scroll to it. */
export function useSectionControl(section: { id?: string; title: unknown; expand?: () => void; element?: () => HTMLElement | null }) {
  const rt = useRuntime();
  const key = useId();
  const expand = useRef(section.expand);
  expand.current = section.expand;
  const el = useRef(section.element);
  el.current = section.element;
  const label = typeof section.title === 'string' ? section.title : '';
  const id = section.id || label;
  useEffect(() => {
    if (!id || !label) return undefined;
    return registerTabTarget(rt, key, { kind: 'section', id, label, screen: rt.getState().view, expand: () => expand.current?.(), element: () => el.current?.() ?? null });
  }, [rt, key, id, label]);
}


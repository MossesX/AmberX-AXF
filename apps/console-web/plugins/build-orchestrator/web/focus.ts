/**
 * Bringing one build forward on the orchestrator (console-commands-reliable, Nov 11 2026: "console_show to a specific
 * build only scrolls to the top of the list"). A console command, a search hit or a context menu asks for a build; the
 * tab that lists it scrolls its row into view, expands it and keeps it highlighted until another build is asked for.
 *
 * The ask is kept for FOCUS_TTL_MS so a tab that mounts after it (the tab switch, the first load of its rows) still
 * picks it up; once a tab has shown the build it settles the ask, so switching tabs later doesn't jump back.
 */
import { useEffect, useState } from 'react';

const FOCUS_EVENT = 'axf:orchestrator-focus';
const FOCUS_TTL_MS = 30_000;
let wanted: { id: string; at: number } | null = null;

/** Ask the orchestrator to bring this build forward (the page may not be on screen yet). */
export function focusBuild(id: string): void {
  wanted = { id, at: Date.now() };
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: id }));
}

/** The build asked for (still fresh), or ''. */
export function wantedBuild(now = Date.now()): string {
  return wanted && now - wanted.at < FOCUS_TTL_MS ? wanted.id : '';
}

/** The ask was carried out: later tab switches don't scroll again. The highlight stays on the row. */
export function settleFocus(id: string): void {
  if (wanted?.id === id) wanted = null;
}

/** The build to highlight on this tab: the one asked for (now or within the last 30 s), until another is asked for. */
export function useFocusedBuild(): string {
  const [id, setId] = useState(() => wantedBuild());
  useEffect(() => {
    const on = (e: Event) => setId(String((e as CustomEvent<string>).detail ?? ''));
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);
  return id;
}

/*
 * Expand / collapse build rows without the UI (Brett, Nov 12 2026: every build is one collapsed row that opens to show
 * everything). Actions build-orchestrator.expand:<build|all> and build-orchestrator.collapse:<build|all> send this event;
 * every orchestrator build table on screen applies it. An open row carries aria-expanded="true" (DataGrid).
 */
const EXPAND_EVENT = 'axf:orchestrator-expand';
export type ExpandAsk = { ids: string[] | 'all'; open: boolean };
export function expandBuilds(ids: string[] | 'all', open: boolean): void {
  window.dispatchEvent(new CustomEvent<ExpandAsk>(EXPAND_EVENT, { detail: { ids, open } }));
}
/** Open rows of one table: starts collapsed (the build asked for opens), follows the expand / collapse actions. */
export function useOpenRows(allIds: readonly string[]): [string[], (f: (o: string[]) => string[]) => void] {
  const [open, setOpen] = useState<string[]>(() => { const w = wantedBuild(); return w ? [w] : []; });
  useEffect(() => {
    const on = (e: Event) => {
      const { ids, open: want } = (e as CustomEvent<ExpandAsk>).detail;
      const list = ids === 'all' ? [...allIds] : ids;
      setOpen((o) => (want ? [...new Set([...o, ...list])] : ids === 'all' ? [] : o.filter((x) => !list.includes(x))));
    };
    window.addEventListener(EXPAND_EVENT, on);
    return () => window.removeEventListener(EXPAND_EVENT, on);
  }, [allIds.join('\n')]);
  return [open, setOpen];
}

/** The row or card of a build on any orchestrator tab (both carry the build's context-menu target). */
export function buildRowSelector(id: string): string {
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  return `[data-fx-ctx-target="axf-orchestrator-build"][data-fx-ctx-payload="${esc}"]`;
}

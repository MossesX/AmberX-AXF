import { useEffect, useSyncExternalStore } from 'react';
import { useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import * as consoleApi from '@console/api';
import { ORCH_VIEW, laneOf, type Lane } from './orchestrator-core.mjs';

/*
 * Opening the orchestrator as "the build queue" (Brett, Nov 9 2026: "Build queue doesn't open the orchestrator. It
 * opens the old build queue."). The Home card, the old Build queue screen id, `orchestrator.open[:lane]` (console_action)
 * and the redirect below all come here: the page opens on the Pipeline tab (Pending / Queued / Building) and, with a
 * lane, scrolls to it.
 */

let request: { lane: Lane | ''; seq: number } = { lane: '', seq: 0 };
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };

/** Open the orchestrator on its Pipeline tab (optionally on one lane: pending | queued | building). */
export function openOrchestrator(rt: AxfRuntime, tab = '') {
  request = { lane: laneOf(tab), seq: request.seq + 1 };
  consoleApi.writeLocal('orch-tab', 'pipeline');
  subs.forEach((f) => f());
  rt.navigate(ORCH_VIEW);
}

/** The latest open request (seq 0 = none yet); the page switches to Pipeline and scrolls to the lane. */
export const useOpenRequest = () => useSyncExternalStore(subscribe, () => request);

/** The old Build queue screen: renders nothing and moves to the orchestrator. */
export function OldQueueRedirect() {
  const rt = useRuntime();
  useEffect(() => { openOrchestrator(rt); }, [rt]);
  return null;
}

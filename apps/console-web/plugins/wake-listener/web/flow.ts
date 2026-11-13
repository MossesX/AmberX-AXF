/**
 * What happens with a command once the wake phrase has been heard (wake-listener@1). Step 1: every command goes to the
 * console's own voice intents (console-control@1 voice, action `console.control.voice`): scroll, open, find, show a build
 * step, plugins on / off, press, set a setting. Step 2 of the build puts the command catalog and the spoken wizard in
 * front of it.
 */
import type { AxfRuntime } from '@console/axf/core';

export interface FlowResult { ok: boolean; say: string; done: boolean }
export type Floor = null;

export interface FlowHost {
  rt: AxfRuntime;
  say: (text: string) => void;
}

/** Runs one spoken command. `done` = the floor is free again (no wizard waiting for an answer). */
export async function handleCommand(host: FlowHost, text: string): Promise<FlowResult> {
  const h = host.rt.actions.get('console.control.voice');
  if (!h) return { ok: false, say: "The console has no voice commands loaded.", done: true };
  host.rt.actions.dispatch(`console.control.voice:${text}`, { runtime: host.rt });
  return { ok: true, say: '', done: true };
}

export function hasFloor(): boolean { return false; }
export function cancelFloor(): string { return ''; }

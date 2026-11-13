/**
 * Console control (console-control@1, framework/spec/CONSOLE-CONTROL.md): the console's own targets on top of what the
 * framework controls register by themselves. App.tsx installs it once per runtime.
 */
import type { AxfRuntime } from '../axf/core';
import { installActionTargets } from './actions';

export function installConsoleControl(rt: AxfRuntime): () => void {
  const actions = installActionTargets(rt);
  return () => { actions.off(); };
}

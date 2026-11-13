/**
 * Console control (console-control@1, framework/spec/CONSOLE-CONTROL.md): the console's own targets on top of what the
 * framework controls register by themselves. App.tsx installs it once per runtime.
 */
import type { AxfRuntime } from '../axf/core';
import { installActionTargets } from './actions';
import { installPluginTargets } from './plugins';

export function installConsoleControl(rt: AxfRuntime): () => void {
  const actions = installActionTargets(rt);
  const plugins = installPluginTargets(rt);
  return () => { actions.off(); plugins(); };
}

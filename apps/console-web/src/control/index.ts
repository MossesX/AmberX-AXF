/**
 * Console control (console-control@1, framework/spec/CONSOLE-CONTROL.md): the console's own targets on top of what the
 * framework controls register by themselves. App.tsx installs it once per runtime.
 */
import type { AxfRuntime } from '../axf/core';
import { installActionTargets } from './actions';
import { installPluginTargets } from './plugins';
import { installControlSearch } from './search';
import { installControlExecutor } from './executor';
import { installVoiceControl } from '../actions/voice-control';
import { installConsoleControlActions } from '../actions/console-control';
import { installSearchPalette } from './SearchPalette';
import { installDeepLink } from './deepLink';

export function installConsoleControl(rt: AxfRuntime): () => void {
  const actions = installActionTargets(rt);
  const plugins = installPluginTargets(rt);
  const search = installControlSearch(rt);
  const executor = installControlExecutor(rt);
  const voice = installVoiceControl(rt);
  const verbs = installConsoleControlActions(rt);
  const palette = installSearchPalette(rt);
  // ?axf-target=<address> on load: open that screen, tab, row or step once it has registered
  const deepLink = installDeepLink(rt);
  return () => { actions.off(); plugins(); search(); executor(); voice(); verbs(); palette(); deepLink(); };
}

/**
 * Console control (console-control@1, framework/spec/CONSOLE-CONTROL.md): the console's own targets on top of what the
 * framework controls register by themselves. App.tsx installs it once per runtime.
 */
import type { AxfRuntime } from '../axf/core';
import { installActionTargets } from './actions';
import { installPluginTargets } from './plugins';
import { installToolbarTargets } from './toolbars';
import { installControlSearch } from './search';
import { installControlExecutor } from './executor';
import { installVoiceControl } from '../actions/voice-control';
import { installConsoleControlActions } from '../actions/console-control';
import { installSearchPalette } from './SearchPalette';
import { installDeepLinks } from './deepLink';

export function installConsoleControl(rt: AxfRuntime): () => void {
  const actions = installActionTargets(rt);
  const plugins = installPluginTargets(rt);
  const toolbars = installToolbarTargets(rt);
  const search = installControlSearch(rt);
  const executor = installControlExecutor(rt);
  const voice = installVoiceControl(rt);
  const verbs = installConsoleControlActions(rt);
  const palette = installSearchPalette(rt);
  // #/<view>, ?axf-target=, ?axf-open= (read before the first render, opened once their screen registered)
  const links = installDeepLinks(rt);
  return () => { actions.off(); plugins(); toolbars(); search(); executor(); voice(); verbs(); palette(); links(); };
}

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
import { installDragActions } from '../actions/drag';

export function installConsoleControl(rt: AxfRuntime): () => void {
  const actions = installActionTargets(rt);
  const plugins = installPluginTargets(rt);
  const search = installControlSearch(rt);
  const executor = installControlExecutor(rt);
  const voice = installVoiceControl(rt);
  const verbs = installConsoleControlActions(rt);
  const palette = installSearchPalette(rt);
  // drag-move@1: drag.list / drag.zones / drag.move / drag.add / drag.remove / drag.preview (actions/drag.ts)
  const drag = installDragActions(rt);
  return () => { actions.off(); plugins(); search(); executor(); voice(); verbs(); palette(); drag(); };
}

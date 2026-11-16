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
import { installPluginSettingsActions } from '../actions/plugin-settings';

export function installConsoleControl(rt: AxfRuntime): () => void {
  const actions = installActionTargets(rt);
  const plugins = installPluginTargets(rt);
  const search = installControlSearch(rt);
  const executor = installControlExecutor(rt);
  const voice = installVoiceControl(rt);
  const verbs = installConsoleControlActions(rt);
  const palette = installSearchPalette(rt);
  // plugin-settings@1: plugin.settings.open / get / set (voice, MCP console_action, control@1)
  const pluginSettings = installPluginSettingsActions(rt);
  return () => { actions.off(); plugins(); search(); executor(); voice(); verbs(); palette(); pluginSettings(); };
}

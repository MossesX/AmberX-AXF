/**
 * Phone Connect (phone-connect@1), the console side: Settings → Plugins → Phone Connect and the phone.* console actions.
 * The server decides everything (server/service.py); this file shows it and calls the same routes as MCP and the CLI.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { registerActions } from './actions';

export const TAB = 'phone-connect';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.phone-connect',
  label: 'Phone Connect',
  version: '0.1.0',
  register(rt) {
    registerActions(rt, () => rt.dispatch(`plugin.settings.open:${TAB}`));
  },
};

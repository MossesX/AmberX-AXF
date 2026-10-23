import type { AxfRuntime } from './axf/core';
import { registerCommands } from './studio/commands';

/**
 * This app's handlers. Every studio command is an AXF action (studio/commands.ts), so the application menu, the
 * toolbars, context menus, shortcuts and search all run the same code; the standard framework actions the app answers
 * (file.new, file.save, edit.undo, help.about…) are registered there too.
 */
export function registerActions(axf: AxfRuntime) {
  registerCommands(axf);
  axf.actions.register('view.shortcuts', () => axf.openDialog('shortcuts'), { label: 'Keyboard shortcuts' });
  axf.actions.register('dev.console', () => axf.openDialog('dev-console'), { label: 'Developer console', requires: 'dev.tools' });
}

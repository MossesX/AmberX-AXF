import type { AxfWebLibrary } from '../../../src/axf/react/library';
import helpPack from '../help.json';
import { registerExpenses } from './module';
import './expenses.css';

/**
 * Expenses as a Molly module (see module.tsx): the plugin provides the module and its actions at start, and puts
 * Add an expense in Molly's View menu. Removing this folder puts Expenses back to opening on its own.
 */
export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.molly.expenses',
  label: 'Expenses',
  version: '0.1.0',
  provides: ['module:expenses'],
  builtWith: { model: 'opus', builtAt: '2026-11-10' },
  help: helpPack.data as AxfWebLibrary['help'],
  register: registerExpenses,
  appMenu: [
    { id: 'molly-expenses.go', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 26, items: [
      { id: 'molly-expenses.add', label: 'Add an expense…', icon: 'plus', action: 'expenses.open:add' },
    ] },
  ],
};

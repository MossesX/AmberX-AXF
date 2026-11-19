/** Every built-in command, all four tabs. Custom ones and edits are overrides (core.ts), never changes here. */
import type { Command } from './core';
import { DEVELOPER_COMMANDS } from './lib-developer';
import { NOTES_COMMANDS } from './lib-notes';
import { SNIPPET_COMMANDS } from './lib-snippets';
import { TASKS_COMMANDS } from './lib-tasks';

export const LIBRARY: readonly Command[] = [...NOTES_COMMANDS, ...TASKS_COMMANDS, ...DEVELOPER_COMMANDS, ...SNIPPET_COMMANDS];

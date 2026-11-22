#!/usr/bin/env node
/** The Todos toolbars (toolbar:todo-manager, toolbar:todo-manager-selection): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'todo-manager.json': ['new-task', 'new-group', 'filters'], 'todo-manager-selection.json': ['done', 'duplicate', 'delete', 'clear'] }, { label: 'Todos toolbars' });

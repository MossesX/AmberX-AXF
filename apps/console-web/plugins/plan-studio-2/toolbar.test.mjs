#!/usr/bin/env node
/** The Plan Studio 2.0 toolbars (toolbar:plan-studio-2, toolbar:plan-studio-2-item): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'plan-studio-2.json': ['new-plan', 'undo', 'expand', 'collapse', 'export', 'reload'], 'plan-studio-2-item.json': ['new-inside', 'move', 'link', 'build', 'delete'] }, { label: 'Plan Studio 2.0 toolbars' });

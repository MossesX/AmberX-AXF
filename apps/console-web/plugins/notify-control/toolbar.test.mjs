#!/usr/bin/env node
/** The Notifications toolbar (toolbar:notify-control): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'notify-control.json': ['read', 'plugin', 'settings'] }, { label: 'Notifications toolbar' });

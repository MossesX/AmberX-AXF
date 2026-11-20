#!/usr/bin/env node
/** The context menu designer's Actions toolbar (toolbar:context-menu-actions): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'context-menu-actions.json': ['filter'] }, { label: 'Context menu actions toolbar' });

#!/usr/bin/env node
/** The Data store toolbar (toolbar:data-store): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'data-store.json': ['backup','verify','sync'] }, { label: 'Data store toolbar' });

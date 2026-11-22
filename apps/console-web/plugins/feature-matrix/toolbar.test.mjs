#!/usr/bin/env node
/** The Feature matrix toolbar (toolbar:feature-matrix): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'feature-matrix.json': ['import', 'reload', 'collapse'] }, { label: 'Feature matrix toolbar' });

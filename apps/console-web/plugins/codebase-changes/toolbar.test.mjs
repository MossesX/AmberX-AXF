#!/usr/bin/env node
/** The Codebase changes toolbar (toolbar:codebase-changes): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'codebase-changes.json': ['live', 'resume', 'branch', 'areas'] }, { label: 'Codebase changes toolbar' });

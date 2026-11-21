#!/usr/bin/env node
/** The Claude accounts toolbar (toolbar:claude-accounts): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'claude-accounts.json': ['switch','check','refresh','routing','workers','runs'] }, { label: 'Claude accounts toolbar' });

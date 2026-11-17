#!/usr/bin/env node
/** The Breakroom toolbar (toolbar:agent-swarm): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'agent-swarm.json': ['hire', 'run', 'types', 'pause', 'card', 'budget'] }, { label: 'Breakroom toolbar' });

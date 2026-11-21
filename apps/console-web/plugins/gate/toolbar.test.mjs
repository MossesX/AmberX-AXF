#!/usr/bin/env node
/** The Gate toolbar (toolbar:gate): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'gate.json': ['land-now','pause','resume','auto','build-rules','history','reset'] }, { label: 'Gate toolbar' });

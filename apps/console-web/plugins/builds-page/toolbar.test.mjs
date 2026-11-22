#!/usr/bin/env node
/** The Builds toolbars (toolbar:builds, toolbar:builds-steps): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'builds.json': ['reload'], 'builds-steps.json': ['select-all', 'divide', 'harvest', 'restore'] }, { label: 'Builds toolbars' });

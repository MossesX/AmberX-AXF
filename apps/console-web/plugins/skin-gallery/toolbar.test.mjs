#!/usr/bin/env node
/** The Skins toolbar (toolbar:skin-gallery): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'skin-gallery.json': ['use', 'back', 'restore', 'undo'] }, { label: 'Skins toolbar' });

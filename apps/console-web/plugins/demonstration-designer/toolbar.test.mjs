#!/usr/bin/env node
/** The Demonstration Designer toolbars (pitch, saved, record, timeline): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, {
  'demonstration-designer.json': ['play', 'export', 'share', 'delete'],
  'demonstration-designer-saved.json': ['refresh'],
  'demonstration-designer-record.json': ['record', 'make'],
  'demonstration-designer-timeline.json': ['add', 'save', 'revert'],
}, { label: 'Demonstration Designer toolbars' });

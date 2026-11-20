#!/usr/bin/env node
/** The Notes toolbars (toolbar:notes, toolbar:notes-note): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'notes.json': ['new-note', 'new-folder', 'reload'], 'notes-note.json': ['edit', 'save', 'rename', 'delete'] }, { label: 'Notes toolbars' });

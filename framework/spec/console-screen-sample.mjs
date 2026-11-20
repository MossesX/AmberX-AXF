/**
 * The sample screen the console-screen@1 fixture and its checker share (spec/fixtures/console-screen.json,
 * spec/check-console-screen.mts): raw elements as a console collects them, and the targets a voice session names.
 */
export const SAMPLE_SCREEN = [
  { label: 'File', kind: 'menu', group: 'app menu', state: { expanded: false }, address: 'button:menu.file', box: { x: 120, y: 8, w: 40, h: 24 } },
  { label: 'View', kind: 'menu', group: 'app menu', state: { expanded: false }, address: 'button:menu.view', box: { x: 168, y: 8, w: 44, h: 24 } },
  { label: 'Building', kind: 'tab', group: 'tabs', state: { selected: true }, address: 'view:build-orchestrator/tab:orchestrator.tabs=building', box: { x: 24, y: 60, w: 90, h: 32 } },
  { label: 'Queue', kind: 'tab', group: 'tabs', address: 'view:build-orchestrator/tab:orchestrator.tabs=queue', box: { x: 118, y: 60, w: 80, h: 32 } },
  { label: 'Refresh', kind: 'button', group: 'toolbar Builds', address: 'toolbar:builds/button:refresh', box: { x: 1380, y: 62, w: 80, h: 28 } },
  { label: 'Stop all', kind: 'button', group: 'toolbar Builds', state: { danger: true }, address: 'toolbar:builds/button:stop-all', box: { x: 1470, y: 62, w: 90, h: 28 } },
  { label: 'voice-console-control · running · step 3 of 6', kind: 'row', group: 'grid Builds', state: { expanded: false }, address: 'grid:builds/row:voice-console-control', box: { x: 24, y: 120, w: 1540, h: 40 } },
  { label: 'Expand row', kind: 'expander', group: 'row voice-console-control', state: { expanded: false }, box: { x: 1520, y: 126, w: 28, h: 28 } },
  { label: 'skin-gallery-fixes · failed · step 2 of 4', kind: 'row', group: 'grid Builds', state: { expanded: true, selected: true }, address: 'grid:builds/row:skin-gallery-fixes', box: { x: 24, y: 164, w: 1540, h: 40 } },
  { label: 'Retry', kind: 'button', group: 'row skin-gallery-fixes', box: { x: 1400, y: 170, w: 70, h: 28 } },
  { label: 'Collapse row', kind: 'expander', group: 'row skin-gallery-fixes', state: { expanded: true }, box: { x: 1520, y: 170, w: 28, h: 28 } },
  { label: 'Retry', kind: 'button', group: 'row plan-studio-search', box: { x: 1400, y: 258, w: 70, h: 28 } },
  { label: 'plan-studio-search · failed · step 1 of 3', kind: 'row', group: 'grid Builds', state: { expanded: false }, address: 'grid:builds/row:plan-studio-search', box: { x: 24, y: 252, w: 1540, h: 40 } },
  { label: 'Search builds', kind: 'input', state: { value: 'skin' }, box: { x: 1100, y: 62, w: 260, h: 28 } },
  { label: 'Approve', kind: 'button', group: 'dialog Approval', box: { x: 700, y: 500, w: 90, h: 32 } },
  { label: 'Settings', kind: 'link', group: 'side menu', address: 'view:settings', box: { x: 0, y: 700, w: 200, h: 36 } },
  { label: 'shipped-features-export · done', kind: 'row', group: 'grid Builds', address: 'grid:builds/row:shipped-features-export', box: { x: 24, y: 1400, w: 1540, h: 40 }, visible: false },
  { label: '', kind: 'button', box: { x: 1, y: 1, w: 10, h: 10 } },
  { label: 'hidden', kind: 'button', box: { x: 1, y: 1, w: 0, h: 10 } },
];

/** What Brett says (or Amber passes on) → what it must name. `prefer` as the action passes it. */
export const SAMPLE_TARGETS = [
  { target: '5', why: 'a number from the map' },
  { target: '#2', why: 'a number with a hash' },
  { target: 'number 9', why: 'a spoken number' },
  { target: '640,300', why: 'coordinates: anywhere on the screenshot' },
  { target: '(12, 40)', why: 'coordinates in brackets' },
  { target: 'grid:builds/row:skin-gallery-fixes', why: 'a full address' },
  { target: 'row:plan-studio-search', why: 'a short address' },
  { target: 'refresh', why: 'one word, case-insensitive' },
  { target: 'the Refresh button', why: 'filler and the kind word dropped' },
  { target: 'refrsh', why: 'a transcription slip still matches' },
  { target: 'queue tab', why: 'a kind word picks the tab' },
  { target: 'row 3', why: 'the third visible row' },
  { target: 'the second row', why: 'an ordinal' },
  { target: 'last row', why: 'the last visible row' },
  { target: 'retry', why: 'two Retry buttons: numbered choices, never a guess' },
  { target: 'the lower retry button', why: 'a position word breaks the tie' },
  { target: 'skin gallery', prefer: ['row'], why: 'words from a row' },
  { target: 'shipped features', why: 'an element that needs a scroll' },
  { target: 'launch rocket', why: 'nothing matches' },
  { target: 'stop all', why: 'a destructive control resolves (the guard stops it)' },
];

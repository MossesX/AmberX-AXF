#!/usr/bin/env node
/**
 * Writes the two shipped assets from the tables below, so the library stays easy to grow:
 *   assets/status-style/library.json   every built-in preset (status-style-library@1)
 *   assets/status-style/default.json   the default style of every known status (status-styles@1)
 *
 *   node apps/console-web/plugins/status-styles/gen-assets.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** [id, name, target, effect, tone, speed, strength, extras] */
const P = (id, name, target, effect, tone, speed = 100, strength = 60, extra = {}) => ({ id, name, target, effect, tone, speed, strength, direction: 'normal', tint: 0, edge: false, bold: false, italic: false, dim: 0, ...extra });

const presets = [
  // resting looks: nothing moves
  P('plain', 'Plain (no style)', 'row', 'none', 'accent', 100, 0),
  P('still-tint-accent', 'Soft accent tint', 'row', 'none', 'accent', 100, 0, { tint: 12 }),
  P('still-tint-success', 'Soft green tint', 'row', 'none', 'success', 100, 0, { tint: 12 }),
  P('still-tint-warning', 'Soft amber tint', 'row', 'none', 'warning', 100, 0, { tint: 14 }),
  P('still-tint-danger', 'Soft red tint', 'row', 'none', 'danger', 100, 0, { tint: 14 }),
  P('still-edge-accent', 'Accent edge bar', 'row', 'none', 'accent', 100, 0, { edge: true }),
  P('still-edge-success', 'Green edge bar', 'row', 'none', 'success', 100, 0, { edge: true }),
  P('still-edge-danger', 'Red edge bar, bold', 'row', 'none', 'danger', 100, 0, { edge: true, bold: true }),
  P('still-dim', 'Dimmed', 'row', 'none', 'muted', 100, 0, { dim: 40 }),
  P('still-dim-italic', 'Dimmed italic', 'row', 'none', 'muted', 100, 0, { dim: 30, italic: true }),
  P('still-bold', 'Bold text', 'text', 'none', 'text', 100, 0, { bold: true }),
  // whole row: blink
  P('row-blink-slow', 'Slow blink', 'row', 'blink', 'accent', 50, 50),
  P('row-blink', 'Blink', 'row', 'blink', 'accent', 100, 60),
  P('row-blink-fast', 'Fast blink', 'row', 'blink', 'accent', 200, 70),
  P('row-breathe', 'Breathe', 'row', 'blink', 'accent', 35, 30),
  // whole row: pulse (a tint that comes and goes)
  P('row-pulse-accent', 'Accent pulse', 'row', 'pulse', 'accent', 100, 55),
  P('row-pulse-slow', 'Slow accent pulse', 'row', 'pulse', 'accent', 50, 45),
  P('row-pulse-success', 'Green pulse', 'row', 'pulse', 'success', 100, 55),
  P('row-pulse-warning', 'Amber pulse', 'row', 'pulse', 'warning', 100, 60),
  P('row-pulse-danger', 'Red pulse', 'row', 'pulse', 'danger', 100, 60, { edge: true }),
  P('row-pulse-info', 'Blue pulse', 'row', 'pulse', 'info', 100, 55),
  // whole row: sweeps
  P('row-sweep-slow', 'Slow fade sweep, left to right', 'row', 'sweep', 'accent', 50, 55),
  P('row-sweep', 'Fade sweep, left to right', 'row', 'sweep', 'accent', 100, 60),
  P('row-sweep-back', 'Fade sweep, right to left', 'row', 'sweep', 'accent', 100, 60, { direction: 'reverse' }),
  P('row-sweep-pingpong', 'Fade sweep, back and forth', 'row', 'sweep', 'accent', 80, 60, { direction: 'alternate' }),
  P('row-sweep-success', 'Green fade sweep', 'row', 'sweep', 'success', 70, 55),
  P('row-sweep-warning', 'Amber fade sweep', 'row', 'sweep', 'warning', 70, 60),
  P('row-sweep-info', 'Blue fade sweep', 'row', 'sweep', 'info', 70, 55),
  P('row-shimmer', 'Shimmer', 'row', 'shimmer', 'text', 100, 45),
  P('row-shimmer-slow', 'Slow shimmer', 'row', 'shimmer', 'text', 50, 40),
  P('row-shimmer-accent', 'Accent shimmer', 'row', 'shimmer', 'accent', 100, 60, { tint: 6 }),
  P('row-fill', 'Fill up, left to right', 'row', 'fill', 'accent', 60, 40),
  P('row-fill-success', 'Green fill up', 'row', 'fill', 'success', 60, 40),
  P('row-stripes', 'Moving stripes', 'row', 'stripes', 'accent', 100, 40),
  P('row-stripes-warning', 'Amber moving stripes', 'row', 'stripes', 'warning', 100, 45),
  P('row-stripes-back', 'Stripes moving backwards', 'row', 'stripes', 'danger', 100, 45, { direction: 'reverse' }),
  // whole row: glow, edge, attention
  P('row-glow', 'Inner glow', 'row', 'glow', 'accent', 100, 70),
  P('row-glow-success', 'Green inner glow', 'row', 'glow', 'success', 80, 70),
  P('row-glow-danger', 'Red inner glow', 'row', 'glow', 'danger', 120, 80),
  P('row-edge-pulse', 'Pulsing edge bar', 'row', 'edge', 'accent', 100, 90),
  P('row-edge-pulse-warning', 'Pulsing amber edge bar', 'row', 'edge', 'warning', 100, 90),
  P('row-flash', 'Double flash', 'row', 'flash', 'accent', 100, 60),
  P('row-flash-danger', 'Red double flash', 'row', 'flash', 'danger', 100, 70, { edge: true }),
  P('row-heartbeat', 'Heartbeat', 'row', 'heartbeat', 'danger', 100, 55),
  P('row-shake', 'Shake now and then', 'row', 'shake', 'danger', 100, 50, { edge: true }),
  P('row-bob', 'Gentle bob', 'row', 'bob', 'accent', 100, 50),
  // text only
  P('text-blink-slow', 'Text: slow blink', 'text', 'blink', 'text', 50, 60),
  P('text-blink', 'Text: blink', 'text', 'blink', 'text', 100, 70),
  P('text-breathe', 'Text: breathe', 'text', 'blink', 'text', 35, 40),
  P('text-pulse-accent', 'Text: accent pulse', 'text', 'pulse', 'accent', 100, 100),
  P('text-pulse-success', 'Text: green pulse', 'text', 'pulse', 'success', 100, 100),
  P('text-pulse-warning', 'Text: amber pulse', 'text', 'pulse', 'warning', 100, 100),
  P('text-pulse-danger', 'Text: red pulse, bold', 'text', 'pulse', 'danger', 100, 100, { bold: true }),
  P('text-glow', 'Text: glow', 'text', 'glow', 'accent', 100, 80),
  P('text-glow-success', 'Text: green glow', 'text', 'glow', 'success', 80, 80),
  P('text-flash', 'Text: double flash', 'text', 'flash', 'accent', 100, 100),
  P('text-flash-danger', 'Text: red double flash', 'text', 'flash', 'danger', 100, 100, { bold: true }),
  P('text-underline', 'Text: underline that comes and goes', 'text', 'underline', 'accent', 100, 100),
  P('text-heartbeat', 'Text: heartbeat', 'text', 'heartbeat', 'danger', 100, 100),
  // badge sized (also fine on a row)
  P('badge-pulse', 'Badge: pulse', 'row', 'pulse', 'text', 100, 50),
  P('badge-blink', 'Badge: slow blink', 'row', 'blink', 'accent', 60, 50),
  P('badge-glow', 'Badge: glow ring', 'row', 'ring', 'accent', 100, 80),
  P('badge-ring-success', 'Badge: green glow ring', 'row', 'ring', 'success', 100, 80),
  P('badge-ring-danger', 'Badge: red glow ring', 'row', 'ring', 'danger', 120, 90),
  P('badge-bob', 'Badge: bob', 'row', 'bob', 'accent', 120, 60),
  P('badge-shimmer', 'Badge: shimmer', 'row', 'shimmer', 'text', 100, 60),
];

const library = {
  $axf: 'asset@1', type: 'status-style', id: 'library', name: 'Status style presets', version: '1.0.0',
  description: 'Every built-in status style preset (status-style-library@1): what an effect is made of, on the whole row or on its text only. A preset holds picks only (effect, colour token, speed, strength, still look); the plugin draws it from theme tokens. Brett\'s own presets are saved beside these in the plugin\'s data folder.',
  author: 'AmberX AXF', tags: ['status-style', 'animation', 'plugin'],
  data: {
    $axf: 'status-style-library@1',
    targets: ['row', 'text'],
    effects: ['none', 'blink', 'pulse', 'sweep', 'shimmer', 'fill', 'stripes', 'glow', 'ring', 'edge', 'flash', 'heartbeat', 'shake', 'bob', 'underline'],
    textEffects: ['none', 'blink', 'pulse', 'glow', 'flash', 'heartbeat', 'underline'],
    tones: ['accent', 'success', 'warning', 'danger', 'info', 'muted', 'text'],
    directions: ['normal', 'reverse', 'alternate'],
    limits: { speed: [25, 400], strength: [0, 100], tint: [0, 60], dim: [0, 80], presets: 200, statuses: 120 },
    presets,
  },
};

/** [status id, label, group, row preset, badge preset, badge animated] */
const S = (id, label, group, preset, badgePreset = 'plain', animated = false) => [id, { label, group, preset, badgePreset, animated }];
const statuses = Object.fromEntries([
  // builds (Pipeline 2.0, status-table@1)
  S('pending', 'Pending', 'Builds', 'plain'),
  S('splitting', 'Splitting', 'Builds', 'row-sweep-slow', 'badge-pulse', true),
  S('split', 'Split', 'Builds', 'plain'),
  S('pulling-main', 'Pulling main', 'Builds', 'row-sweep-info', 'badge-pulse', true),
  S('assigning-models', 'Assigning models', 'Builds', 'row-shimmer-slow', 'badge-pulse', true),
  S('ready', 'Ready for build', 'Builds', 'still-edge-accent'),
  S('sending', 'Sending', 'Builds', 'row-sweep', 'badge-blink', true),
  S('building', 'Building', 'Builds', 'row-sweep-slow', 'badge-pulse', true),
  S('build-complete', 'Build complete', 'Builds', 'still-edge-success'),
  S('merging-pr', 'Merging to one PR', 'Builds', 'row-pulse-slow', 'badge-pulse', true),
  S('pr-pulling-main', 'PR pulling main', 'Builds', 'row-sweep-info', 'badge-pulse', true),
  S('running-ci', 'Running CI', 'Builds', 'row-stripes', 'badge-blink', true),
  S('merging-main', 'Merging into main', 'Builds', 'row-sweep-success', 'badge-ring-success', true),
  S('landed', 'Landed', 'Builds', 'still-tint-success'),
  S('failed', 'Failed', 'Builds', 'still-edge-danger', 'plain'),
  // steps
  S('completed', 'Completed', 'Steps', 'still-edge-success'),
  S('in-pr', 'In PR', 'Steps', 'still-tint-success'),
  // coming with the pipeline repair
  S('scoring-risk', 'Scoring risk', 'Coming statuses', 'row-shimmer-accent', 'badge-pulse', true),
  S('fast-merge', 'Fast merge', 'Coming statuses', 'row-sweep-success', 'badge-ring-success', true),
  S('post-merge-ci', 'Post-merge CI', 'Coming statuses', 'row-stripes', 'badge-blink', true),
  S('rolling-back', 'Rolling back', 'Coming statuses', 'row-stripes-back', 'badge-ring-danger', true),
  S('rolled-back', 'Rolled back', 'Coming statuses', 'still-tint-warning'),
  // plans
  S('idea', 'Idea', 'Plans', 'still-dim-italic'),
  S('draft', 'Draft', 'Plans', 'plain'),
  S('active', 'Active', 'Plans', 'text-pulse-accent', 'badge-pulse', true),
  S('parked', 'Parked', 'Plans', 'still-dim'),
  S('done', 'Done', 'Plans', 'still-dim'),
]);

const defaults = {
  $axf: 'asset@1', type: 'status-style', id: 'default', name: 'Status styles (default)', version: '1.0.0',
  description: 'The style every known status starts with (status-styles@1): the preset on its row, the preset on its badge and whether the badge moves. Moving statuses animate; resting ones carry a still look. Brett\'s changes are saved over these in the plugin\'s data folder.',
  author: 'AmberX AXF', tags: ['status-style', 'default', 'plugin'],
  data: { $axf: 'status-styles@1', enabled: true, rows: true, badges: true, statuses },
};

const files = { 'assets/status-style/library.json': library, 'assets/status-style/default.json': defaults };
let stale = 0;
for (const [rel, doc] of Object.entries(files)) {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const file = join(HERE, rel);
  if (process.argv.includes('--check')) {
    let cur = ''; try { cur = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (cur !== text) { stale += 1; console.error(`stale: ${rel} (run gen-assets.mjs)`); }
  } else { writeFileSync(file, text); console.log(`wrote ${rel} (${rel.includes('library') ? `${presets.length} presets` : `${Object.keys(statuses).length} statuses`})`); }
}
process.exit(stale ? 1 : 0);

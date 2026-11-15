// Checks the series scripts: shape, unique ids, known skins and apps, running time near 3:00, 60-second cuts,
// and the staging rules (staged screens are said to be a preview; real-only videos have none).
// Usage: node apps/amberx-droid/walkthrough/series/check.mjs [--table]
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERIES, VIDEOS, scenesOf, wordCount, estimateSeconds } from './scripts.mjs';
import { MORE } from './more/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const APPS = new Set(['console-web', 'axhub-web', 'amberx-droid', 'axhub-android', 'expenses']);
const KINDS = new Set(['hero', 'deep', 'real']);
const CAMERAS = new Set(['screen', 'story']);
const MIN = 150, MAX = 200; // seconds: no shorter than 2:30, no longer than 3:20
const SHORT_MIN = 50, SHORT_MAX = 70; // the 60-second cuts

const problems = [];
const ids = new Set();

function checkScenes(where, scenes, { real }) {
  scenes.forEach((s, i) => {
    if (!s.say?.trim()) problems.push(`${where} scene ${i + 1}: empty say`);
    if (!s.shot?.trim()) problems.push(`${where} scene ${i + 1}: empty shot`);
    if (!APPS.has(s.app)) problems.push(`${where} scene ${i + 1}: unknown app ${s.app}`);
    if (s.camera && !CAMERAS.has(s.camera)) problems.push(`${where} scene ${i + 1}: unknown camera ${s.camera}`);
    if (s.camera === 'story' && s.staged) problems.push(`${where} scene ${i + 1}: a story shot can't be a staged screen`);
    if (real && s.staged) problems.push(`${where} scene ${i + 1}: staged scene in a real-data-only video`);
  });
  // A cut with staged screens must say so out loud at least once.
  if (scenes.some((s) => s.staged) && !scenes.some((s) => /preview/i.test(s.say)))
    problems.push(`${where}: has staged scenes but the narration never says "preview"`);
}

for (const v of [...VIDEOS, ...MORE]) {
  const where = `video ${v.id}`;
  if (ids.has(v.id)) problems.push(`${where}: duplicate id`);
  ids.add(v.id);
  for (const k of ['id', 'title', 'app', 'viewport', 'skin', 'hook']) if (!v[k]) problems.push(`${where}: missing ${k}`);
  if (!APPS.has(v.app)) problems.push(`${where}: unknown app ${v.app}`);
  if (!SERIES.viewport[v.viewport]) problems.push(`${where}: unknown viewport ${v.viewport}`);
  if (!existsSync(join(repo, 'framework/assets/skin', `${v.skin}.json`))) problems.push(`${where}: no skin asset ${v.skin}`);
  if (v.kind && !KINDS.has(v.kind)) problems.push(`${where}: unknown kind ${v.kind}`);
  const chapterIds = new Set();
  for (const c of v.chapters) {
    if (chapterIds.has(c.id)) problems.push(`${where}: duplicate chapter ${c.id}`);
    chapterIds.add(c.id);
    if (!c.scenes?.length) problems.push(`${where}/${c.id}: no scenes`);
  }
  const real = v.kind === 'real';
  checkScenes(where, scenesOf(v), { real });
  const secs = estimateSeconds(v);
  if (secs < MIN || secs > MAX) problems.push(`${where}: about ${secs}s, outside ${MIN}-${MAX}s`);
  if (v.short) {
    const cut = shortAsVideo(v);
    checkScenes(`${where} (60s)`, scenesOf(cut), { real });
    const s = estimateSeconds(cut);
    if (s < SHORT_MIN || s > SHORT_MAX) problems.push(`${where} (60s): about ${s}s, outside ${SHORT_MIN}-${SHORT_MAX}s`);
  }
  if (v.extra) checkScenes(`${where} (${v.extra.id || 'extra'})`, scenesOf(extraAsVideo(v)), { real });
}
if (VIDEOS.length < 6 || VIDEOS.length > 8) problems.push(`series: ${VIDEOS.length} videos, expected 6-8`);

function shortAsVideo(v) { return { ...v, chapters: [{ id: 'short', scenes: v.short.scenes }] }; }
function extraAsVideo(v) { return { ...v, chapters: v.extra.chapters || [{ id: 'extra', scenes: v.extra.scenes }] }; }

if (process.argv.includes('--table')) {
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const row = (label, v) => {
    const sc = scenesOf(v);
    console.log(`${label.padEnd(26)} ${mmss(estimateSeconds(v))}  ${String(wordCount(v)).padStart(4)} words  ${String(sc.length).padStart(2)} scenes  ${sc.filter((s) => s.staged).length} staged  skin ${v.skin}`);
  };
  for (const v of VIDEOS) row(`${String(v.order).padStart(2)}  ${v.id}`, v);
  for (const v of MORE) {
    row(`${(v.step || '').padStart(3)} ${v.id}`, v);
    if (v.short) row(`     ${v.id} 60s`, shortAsVideo(v));
  }
}
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${VIDEOS.length + MORE.length} videos OK (${MORE.filter((v) => v.short).length} with a 60-second cut)`);

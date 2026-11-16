// Checks the series scripts: shape, unique ids, known skins and apps, running time near 3:00, 60-second cuts,
// and the staging rules (staged screens are said to be a preview; real-only videos have none).
// Usage: node apps/amberx-droid/walkthrough/series/check.mjs [--table] [--acts]
//   --acts  every recordable cut (series-<id>, series-<id>-60) as the recorder sees it: pieces, devices, and how each
//           scene is recorded (a hand-written act, a live screen by route, the designer mock, or a card)
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERIES, VIDEOS, scenesOf, wordCount, estimateSeconds } from './scripts.mjs';
import { MORE } from './more/index.mjs';
import { SCENES as MOCK_SCENES } from './mock/build.mjs';
import { seriesIds, seriesWalkthrough } from './walkthrough.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const APPS = new Set(['console-web', 'axhub-web', 'amberx-droid', 'axhub-android', 'expenses']);
const KINDS = new Set(['hero', 'deep', 'real']);
const CAMERAS = new Set(['screen', 'story']);
const MIN = 150, MAX = 200; // seconds: no shorter than 2:30, no longer than 3:20
const SHORT_MIN = 50, SHORT_MAX = 70; // the 60-second cuts

const MOCK_IDS = new Set(MOCK_SCENES.map((s) => s.id));

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
    // a staged scene recorded on the designer mock names one of its scenes (series/mock/build.mjs)
    if (s.mock && !s.staged) problems.push(`${where} scene ${i + 1}: mock ${s.mock} on a scene that isn't staged`);
    if (s.mock && !MOCK_IDS.has(s.mock)) problems.push(`${where} scene ${i + 1}: unknown mock scene ${s.mock} (one of ${[...MOCK_IDS].join(', ')})`);
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
    const staged = sc.filter((s) => s.staged);
    console.log(`${label.padEnd(26)} ${mmss(estimateSeconds(v))}  ${String(wordCount(v)).padStart(4)} words  ${String(sc.length).padStart(2)} scenes  ${staged.length} staged (${staged.filter((s) => s.mock).length} on the mock)  skin ${v.skin}`);
  };
  for (const v of VIDEOS) row(`${String(v.order).padStart(2)}  ${v.id}`, v);
  for (const v of MORE) {
    row(`${(v.step || '').padStart(3)} ${v.id}`, v);
    if (v.short) row(`     ${v.id} 60s`, shortAsVideo(v));
  }
}
// Every cut must load as a recordable walkthrough: a device and a starting page per piece, an act per scene.
const acts = [];
for (const id of seriesIds()) {
  try {
    const w = seriesWalkthrough(id);
    for (const e of w.walkthroughErrors(w.WALKTHROUGH, w.CHAPTERS)) problems.push(`${id}: ${e}`);
    const n = {}; for (const c of w.CHAPTERS) for (const x of c.scenes) n[x.plan] = (n[x.plan] ?? 0) + 1;
    acts.push({ id, pieces: w.CHAPTERS.map((c) => `${c.id}:${c.device[0]}`).join(' '), n });
  } catch (e) { problems.push(`${id}: ${e.message}`); }
}
if (process.argv.includes('--acts')) {
  for (const a of acts) console.log(`${a.id.padEnd(34)} act ${String(a.n.act ?? 0).padStart(2)}  screen ${String(a.n.route ?? 0).padStart(2)}  mock ${String(a.n.mock ?? 0).padStart(2)}  card ${String(a.n.card ?? 0).padStart(2)}   ${a.pieces}`);
}
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${VIDEOS.length + MORE.length} videos OK (${MORE.filter((v) => v.short).length} with a 60-second cut), ${acts.length} recordable cuts`);

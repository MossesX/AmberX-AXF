// Checks the three-minute series scripts: shape, unique ids, known skins and apps, and running time near 3:00.
// Usage: node apps/amberx-droid/walkthrough/series/check.mjs [--table]
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERIES, VIDEOS, scenesOf, wordCount, estimateSeconds } from './scripts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const APPS = new Set(['console-web', 'axhub-web', 'amberx-droid', 'axhub-android']);
const MIN = 150, MAX = 200; // seconds: no shorter than 2:30, no longer than 3:20

const problems = [];
const ids = new Set();
for (const v of VIDEOS) {
  const where = `video ${v.id}`;
  if (ids.has(v.id)) problems.push(`${where}: duplicate id`);
  ids.add(v.id);
  for (const k of ['id', 'title', 'app', 'viewport', 'skin', 'hook']) if (!v[k]) problems.push(`${where}: missing ${k}`);
  if (!APPS.has(v.app)) problems.push(`${where}: unknown app ${v.app}`);
  if (!SERIES.viewport[v.viewport]) problems.push(`${where}: unknown viewport ${v.viewport}`);
  if (!existsSync(join(repo, 'framework/assets/skin', `${v.skin}.json`))) problems.push(`${where}: no skin asset ${v.skin}`);
  const chapterIds = new Set();
  for (const c of v.chapters) {
    if (chapterIds.has(c.id)) problems.push(`${where}: duplicate chapter ${c.id}`);
    chapterIds.add(c.id);
    if (!c.scenes?.length) problems.push(`${where}/${c.id}: no scenes`);
  }
  const scenes = scenesOf(v);
  scenes.forEach((s, i) => {
    if (!s.say?.trim()) problems.push(`${where} scene ${i + 1}: empty say`);
    if (!s.shot?.trim()) problems.push(`${where} scene ${i + 1}: empty shot`);
    if (!APPS.has(s.app)) problems.push(`${where} scene ${i + 1}: unknown app ${s.app}`);
  });
  // A video with staged screens must say so out loud at least once.
  if (scenes.some((s) => s.staged) && !scenes.some((s) => /preview/i.test(s.say)))
    problems.push(`${where}: has staged scenes but the narration never says "preview"`);
  const secs = estimateSeconds(v);
  if (secs < MIN || secs > MAX) problems.push(`${where}: about ${secs}s, outside ${MIN}-${MAX}s`);
}
if (VIDEOS.length < 6 || VIDEOS.length > 8) problems.push(`series: ${VIDEOS.length} videos, expected 6-8`);

if (process.argv.includes('--table')) {
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  for (const v of VIDEOS) {
    const sc = scenesOf(v);
    console.log(`${String(v.order).padStart(2)}  ${v.id.padEnd(20)} ${mmss(estimateSeconds(v))}  ${String(wordCount(v)).padStart(4)} words  ${String(sc.length).padStart(2)} scenes  ${sc.filter((s) => s.staged).length} staged  skin ${v.skin}`);
  }
}
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${VIDEOS.length} videos OK`);

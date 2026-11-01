// Raw chapter videos + Amber's clips → the published walkthrough in $OUT/publish: walkthrough.mp4 (phone 720×1600,
// H.264 + AAC, faststart), walkthrough.vtt (one cue per sentence), chapters.json (walkthrough-video@1 index: chapters
// with start times and their scenes as indexed segments, the same shape as the demo.amberxai.com player's INDEX) and
// poster.jpg. Adapted from the AmberX Tour recorder's assemble.mjs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { WALKTHROUGH } from './script.mjs';

const OUT = process.env.OUT || '/out';
const PUB = `${OUT}/publish`;
const TMP = `${OUT}/tmp`;
mkdirSync(PUB, { recursive: true });
mkdirSync(TMP, { recursive: true });
const W = 720, H = 1600;
const timeline = JSON.parse(readFileSync(`${OUT}/timeline.json`, 'utf8'));
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const r1 = (t) => Math.round(t * 10) / 10;
const vttTime = (t) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
const sentences = (say) => say.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((x) => x.trim()) ?? [say];

const parts = [], cues = [], chapters = [];
let offset = 0;
for (const ch of timeline) {
  const first = Math.max(0, ch.scenes[0].start - 0.4);
  const last = ch.scenes.at(-1).end;
  const length = last - first;
  // each scene's clip padded with silence to the scene's real on-screen length, then joined
  const inputs = [], filters = [];
  ch.scenes.forEach((s, k) => {
    const span = (k + 1 < ch.scenes.length ? ch.scenes[k + 1].start : s.end) - s.start + (k === 0 ? s.start - first : 0);
    inputs.push('-i', `${OUT}/audio/${ch.id}-${s.i}.wav`);
    const lead = k === 0 ? `adelay=${Math.round((s.start - first) * 1000)}:all=1,` : '';
    filters.push(`[${k}:a]aresample=48000,${lead}apad,atrim=0:${span.toFixed(3)},asetpts=N/SR/TB[a${k}]`);
  });
  filters.push(`${ch.scenes.map((_, k) => `[a${k}]`).join('')}concat=n=${ch.scenes.length}:v=0:a=1[a]`);
  const wav = `${TMP}/${ch.id}.wav`;
  ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[a]', wav]);
  const mp4 = `${TMP}/${ch.id}.mp4`;
  ff(['-ss', first.toFixed(3), '-t', length.toFixed(3), '-i', `${OUT}/raw/${ch.id}.webm`, '-i', wav,
    '-map', '0:v', '-map', '1:a', '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '27',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-shortest', mp4]);
  parts.push(mp4);
  const segments = [];
  for (const s of ch.scenes) {
    const at = offset + (s.start - first);
    const ss = sentences(s.say);
    segments.push({ start: r1(at), title: ss[0].replace(/[.!?]+$/, '').slice(0, 90) });
    const total = ss.reduce((n, x) => n + x.length, 0);
    let t = at;
    for (const x of ss) { const d = (s.dur * x.length) / total; cues.push(`${vttTime(t)} --> ${vttTime(t + d)}\n${x}`); t += d; }
  }
  chapters.push({ id: ch.id, title: ch.title, start: r1(offset), duration: r1(length), segments });
  offset += length;
}

writeFileSync(`${TMP}/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', `${TMP}/list.txt`, '-c', 'copy', '-movflags', '+faststart', `${PUB}/walkthrough.mp4`]);
ff(['-ss', '3', '-i', `${PUB}/walkthrough.mp4`, '-frames:v', '1', '-vf', 'scale=360:800', '-q:v', '4', `${PUB}/poster.jpg`]);
writeFileSync(`${PUB}/walkthrough.vtt`, `WEBVTT\n\n${cues.join('\n\n')}\n`);
const index = {
  $axf: WALKTHROUGH.$axf, id: WALKTHROUGH.id, title: WALKTHROUGH.title, app: WALKTHROUGH.app,
  recordedAt: new Date().toISOString(), duration: r1(offset), width: W, height: H,
  bytes: statSync(`${PUB}/walkthrough.mp4`).size,
  video: 'walkthrough.mp4', captions: 'walkthrough.vtt', poster: 'poster.jpg', chapters,
};
writeFileSync(`${PUB}/chapters.json`, JSON.stringify(index, null, 1));
console.log(`walkthrough: ${(offset / 60).toFixed(1)} min, ${chapters.length} chapters, ${cues.length} captions, ${(index.bytes / 1e6).toFixed(1)} MB`);

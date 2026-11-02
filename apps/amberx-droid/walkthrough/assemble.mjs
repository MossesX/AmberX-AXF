// Raw chapter videos + Amber's clips → the published walkthrough in $OUT/publish: walkthrough.mp4 (phone 720×1600,
// H.264 + AAC, faststart), walkthrough.vtt (one cue per sentence), chapters.json (walkthrough-video@1 index: chapters
// with start times and their scenes as indexed segments, the same shape as the demo.amberxai.com player's INDEX) and
// poster.jpg. Adapted from the AmberX Tour recorder's assemble.mjs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { loadWalkthrough } from './load.mjs';

const OUT = process.env.OUT || '/out';
const { CHAPTERS, WALKTHROUGH, BASE, BASE_META, overrides } = await loadWalkthrough();
const PUB = `${OUT}/publish`;
const TMP = `${OUT}/tmp`;
mkdirSync(PUB, { recursive: true });
mkdirSync(TMP, { recursive: true });
// The frame every chapter is fitted into: the walkthrough's `output` (the AmberX tour: phone 720×1600; the whole-stack
// one: 1920×1080, its phone chapters letterboxed in the middle).
const W = WALKTHROUGH.output?.width ?? 720, H = WALKTHROUGH.output?.height ?? 1600;
const PAD = WALKTHROUGH.output?.pad ?? '0x0f0d0a';
const timeline = JSON.parse(readFileSync(`${OUT}/timeline.json`, 'utf8'));
// The clips as voiced now: a line edited after the recording has a new length (VOICE_ONLY re-voicing).
let durations = {};
try { durations = JSON.parse(readFileSync(`${OUT}/durations.json`, 'utf8')); } catch { /* the recorded lengths */ }
const says = new Map(CHAPTERS.flatMap((c) => c.scenes.map((x, i) => [`${c.id}-${i}`, x.say])));
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
  // Each scene is its own cut of the recording: from its start (the chapter's lead-in for the first) to the next
  // scene's start. When its clip is now longer than that cut (an edited line), the cut's last frame is held.
  const cuts = ch.scenes.map((s, k) => {
    const from = k === 0 ? first : s.start;
    const to = k + 1 < ch.scenes.length ? ch.scenes[k + 1].start : s.end;
    const dur = durations[`${ch.id}-${s.i}`] ?? s.dur;
    const lead = k === 0 ? s.start - first : 0;
    const need = lead + dur + 0.6;
    return { s, from, to, dur, lead, span: Math.max(to - from, need), hold: Math.max(0, need - (to - from)) };
  });
  // One seeked input per cut (not one input split into many trims): ffmpeg then never buffers the whole chapter's frames
  // for the later cuts, which got a long chapter killed for memory.
  const n = cuts.length, inputs = [], filters = [];
  cuts.forEach((c) => inputs.push('-ss', c.from.toFixed(3), '-to', c.to.toFixed(3), '-i', `${OUT}/raw/${ch.id}.webm`));
  cuts.forEach((c, k) => {
    filters.push(`[${k}:v]setpts=PTS-STARTPTS${c.hold ? `,tpad=stop_mode=clone:stop_duration=${c.hold.toFixed(3)}` : ''},`
      + `fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${PAD},setsar=1,format=yuv420p[v${k}]`);
    inputs.push('-i', `${OUT}/audio/${ch.id}-${c.s.i}.wav`);
    const delay = c.lead ? `adelay=${Math.round(c.lead * 1000)}:all=1,` : '';
    filters.push(`[${n + k}:a]aresample=48000,${delay}apad,atrim=0:${c.span.toFixed(3)},asetpts=N/SR/TB[a${k}]`);
  });
  filters.push(`${cuts.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${cuts.length}:v=1:a=1[v][a]`);
  const mp4 = `${TMP}/${ch.id}.mp4`;
  ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', WALKTHROUGH.output?.preset ?? 'medium',
    '-crf', String(WALKTHROUGH.output?.crf ?? 27), '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', mp4]);
  parts.push(mp4);
  const segments = [];
  let at = offset;
  for (const c of cuts) {
    const say = says.get(`${ch.id}-${c.s.i}`) ?? c.s.say;
    const ss = sentences(say);
    segments.push({ start: r1(at), title: ss[0].replace(/[.!?]+$/, '').slice(0, 90) });
    const total = ss.reduce((n, x) => n + x.length, 0);
    let t = at + c.lead;
    for (const x of ss) { const d = (c.dur * x.length) / total; cues.push(`${vttTime(t)} --> ${vttTime(t + d)}\n${x}`); t += d; }
    at += c.span;
  }
  const length = at - offset;
  chapters.push({ id: ch.id, title: ch.title, start: r1(offset), duration: r1(length), segments });
  offset += length;
}

writeFileSync(`${TMP}/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', `${TMP}/list.txt`, '-c', 'copy', '-movflags', '+faststart', `${PUB}/walkthrough.mp4`]);
ff(['-ss', '3', '-i', `${PUB}/walkthrough.mp4`, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-q:v', '4', `${PUB}/poster.jpg`]);
// Smaller download copies (the walkthrough's `downloads`, e.g. [720] → walkthrough-720.mp4 at 1280×720)
const downloads = [{ file: 'walkthrough.mp4', label: `${H}p`, height: H, bytes: statSync(`${PUB}/walkthrough.mp4`).size }];
for (const h of WALKTHROUGH.downloads ?? []) {
  if (h >= H) continue;
  const w = Math.round((W * h) / H / 2) * 2;
  const file = `walkthrough-${h}.mp4`;
  ff(['-i', `${PUB}/walkthrough.mp4`, '-vf', `scale=${w}:${h}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-c:a', 'copy', '-movflags', '+faststart', `${PUB}/${file}`]);
  downloads.push({ file, label: `${h}p`, height: h, bytes: statSync(`${PUB}/${file}`).size });
}
// script.json: every scene's words as written and as voiced now, for AmberX's voice editor (walkthrough-voice@1 edits)
writeFileSync(`${PUB}/script.json`, JSON.stringify({
  $axf: 'walkthrough-script@1', id: WALKTHROUGH.id, voice: BASE_META.voice, speed: BASE_META.speed ?? 1, edits: overrides,
  chapters: BASE.map((c) => ({ id: c.id, title: c.title, scenes: c.scenes.map((x, i) => ({ key: `${c.id}-${i}`, say: x.say })) })),
}));
writeFileSync(`${PUB}/walkthrough.vtt`, `WEBVTT\n\n${cues.join('\n\n')}\n`);
const index = {
  $axf: WALKTHROUGH.$axf, id: WALKTHROUGH.id, title: WALKTHROUGH.title, app: WALKTHROUGH.app,
  recordedAt: new Date().toISOString(), duration: r1(offset), width: W, height: H,
  bytes: statSync(`${PUB}/walkthrough.mp4`).size,
  video: 'walkthrough.mp4', captions: 'walkthrough.vtt', poster: 'poster.jpg', downloads, chapters,
};
writeFileSync(`${PUB}/chapters.json`, JSON.stringify(index, null, 1));
console.log(`walkthrough: ${(offset / 60).toFixed(1)} min, ${chapters.length} chapters, ${cues.length} captions, ${(index.bytes / 1e6).toFixed(1)} MB`);

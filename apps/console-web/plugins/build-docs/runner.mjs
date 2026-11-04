#!/usr/bin/env node
/**
 * Build docs — records an approved walkthrough video on the VPS host. The console can't run docker, so it sends one
 * veto call through axHub (vps.run) that starts this in a heavy slot:
 *
 *   node framework/cli/agent-slots.mjs heavy -- node apps/console-web/plugins/build-docs/runner.mjs <job>
 *
 * It hands the job's script to the walkthrough recorder (apps/amberx-droid/walkthrough/rebuild.sh: Playwright on the
 * live apps with every write answered in the browser, Piper voice, ffmpeg) as a walkthrough written as data, follows its
 * output for progress, stops it when the job's cancel file appears, and copies the MP4, captions, poster and transcript
 * into the job's out/ folder. Progress and the result go to the job (jobs.mjs), which the console shows live.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './core.mjs';
import * as jobs from './jobs.mjs';
import { lookFor } from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
const RECORDER = process.env.AXF_BUILD_DOCS_RECORDER || join(ROOT, 'apps/amberx-droid/walkthrough/rebuild.sh');

/** What a recorder output line means for progress: [state, percent, message] or null. */
export function progressOf(line, chapters = 1, seen = { chapters: 0 }) {
  const l = line.replace(/\x1b\[[0-9;]*m/g, '').trim(); // rebuild.sh colours its own lines
  if (/^\[walkthrough\] checking the script/.test(l)) return ['recording', 34, 'Checking the script'];
  if (/^\[walkthrough\] demo data/.test(l)) return ['recording', 36, 'Seeding demo data'];
  if (/^\[walkthrough\] building the recorder image/.test(l)) return ['recording', 38, 'Building the recorder image (first time only)'];
  if (/^\[walkthrough\] downloading/.test(l)) return ['recording', 40, 'Downloading the voice'];
  if (/^\[walkthrough\] (recording|re-voicing)/.test(l)) return ['recording', 42, 'Voicing the narration'];
  if (/^tts: /.test(l)) return ['recording', 48, `Voiced: ${l.slice(5)}`];
  if (/^## [a-z0-9-]+/.test(l)) { seen.chapters += 1; return ['recording', Math.min(84, 48 + Math.round((36 * seen.chapters) / Math.max(1, chapters))), `Recorded part ${seen.chapters} of ${chapters}`]; }
  if (/^demo hub: /.test(l)) return ['rendering', 86, 'Cutting the video'];
  if (/^walkthrough: /.test(l)) return ['rendering', 92, `Rendered: ${l.slice(13)}`];
  if (/^\[walkthrough\] secrets scan/.test(l)) return ['rendering', 94, 'Secrets scan of every frame'];
  return null;
}

export async function record(id) {
  const job = jobs.getJob(id);
  if (!job) throw new Error(`no job ${id}`);
  if (job.kind !== 'video') throw new Error('not a video job');
  if (job.state !== 'queued') throw new Error(`job is ${job.state}, not approved and queued`);
  if (jobs.cancelAsked(id)) { jobs.update(id, { state: 'cancelled', message: 'Cancelled before recording', say: 'Cancelled before recording' }); return 2; }
  const script = jobs.readScript(id);
  const errors = core.scriptErrors(script);
  if (errors.length) { jobs.update(id, { state: 'failed', message: errors.slice(0, 3).join('; ') }); return 1; }
  const dir = jobs.jobDir(id);
  const wt = `build-${id}`; // rebuild.sh: [a-z0-9-] only
  const base = join(dir, 'work');
  const work = join(base, wt); // rebuild.sh WORK = $AMBERX_WALKTHROUGH_WORK/$WALKTHROUGH
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'script.input.json'), JSON.stringify({ ...script, id: wt }));
  // the voice model is ~60 MB: take it from the walkthrough recorder's own cache when it has it
  const voiceDir = join(work, 'voice');
  mkdirSync(voiceDir, { recursive: true });
  for (const ext of ['onnx', 'onnx.json']) {
    const from = join(process.env.AMBERX_WALKTHROUGH_VOICES || '/opt/amberx-walkthrough-rec/voice', `${script.voice}.${ext}`);
    if (!existsSync(join(voiceDir, `${script.voice}.${ext}`)) && existsSync(from)) copyFileSync(from, join(voiceDir, `${script.voice}.${ext}`));
  }
  const look = lookFor(job.options);
  jobs.update(id, { state: 'recording', progress: 33, message: 'Recording started', say: `Recording on ${process.env.HOSTNAME || 'the VPS'}${look ? ` under ${look.id}` : ''}` });

  const env = { ...process.env, WALKTHROUGH: wt, AMBERX_WALKTHROUGH_WORK: base, NO_PUBLISH: '1', LOOK_B64: look ? Buffer.from(JSON.stringify(look)).toString('base64') : '' };
  const child = spawn('bash', [RECORDER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const seen = { chapters: 0 };
  let last = 0; let tail = [];
  const onLine = (line) => {
    process.stdout.write(`${line}\n`);
    tail = [...tail, line].slice(-12);
    const p = progressOf(line, script.chapters.length, seen);
    if (p) { last = Math.max(last, p[1]); try { jobs.update(id, { state: p[0], progress: last, message: p[2] }); } catch { /* cancelled meanwhile */ } }
  };
  let buf = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop() ?? ''; parts.forEach(onLine); });
  let cancelled = false;
  const watch = setInterval(() => {
    if (!cancelled && jobs.cancelAsked(id)) {
      cancelled = true;
      spawnSync('docker', ['kill', `amberx-walkthrough-rec-${wt}`], { stdio: 'ignore' });
      child.kill('SIGTERM');
    }
  }, 2000);
  const code = await new Promise((res) => child.on('close', res));
  clearInterval(watch);
  if (cancelled) { jobs.update(id, { state: 'cancelled', message: 'Cancelled while recording', say: 'Recorder stopped' }); return 2; }
  const pub = join(work, 'publish');
  if (code !== 0 || !existsSync(join(pub, 'walkthrough.mp4'))) {
    jobs.update(id, { state: 'failed', message: `The recorder stopped (exit ${code}): ${tail.filter((l) => l.trim()).slice(-2).join(' · ').slice(0, 400)}`, say: 'Recording failed; see run.log' });
    return 1;
  }
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  for (const f of ['walkthrough.mp4', 'walkthrough.vtt', 'poster.jpg']) if (existsSync(join(pub, f))) copyFileSync(join(pub, f), join(out, f));
  writeFileSync(join(out, 'transcript.md'), core.transcript(script));
  let duration = 0;
  try { duration = Math.round(JSON.parse(readFileSync(join(pub, 'chapters.json'), 'utf8')).duration); } catch { /* unknown */ }
  jobs.update(id, { state: 'done', message: `Video ready${duration ? ` (${core.fmtLength(duration)})` : ''}`, say: 'Video recorded',
    outputs: { video: 'out/walkthrough.mp4', captions: 'out/walkthrough.vtt', poster: 'out/poster.jpg', transcript: 'out/transcript.md', duration } });
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  record(process.argv[2]).then((c) => { process.exitCode = c; }).catch((e) => {
    console.error(e.message);
    try { jobs.update(process.argv[2], { state: 'failed', message: e.message.slice(0, 400) }); } catch { /* bad id */ }
    process.exitCode = 1;
  });
}

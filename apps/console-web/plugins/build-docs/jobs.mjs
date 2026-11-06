/**
 * Build docs — the jobs store. One folder per job on the VPS data volume (never the repo):
 *
 *   <dir>/jobs/<id>/job.json         build-docs-job@1 (core.normJob)
 *                   source-<n>.json  what each target was gathered as
 *                   script.json      a video's click-path script (walkthrough-video@1, data form)
 *                   docs/<build>.md  the docs written for each build
 *                   work/            the recorder's working folder (rebuild.sh WORK)
 *                   out/             walkthrough.mp4, walkthrough.vtt, poster.jpg, transcript.md
 *                   cancel           present = stop at the next check
 *                   run.log          the host runner's output
 *
 * <dir> = AXF_BUILD_DOCS_DIR, else the hub's projects volume (/projects/amberx-axf/_data/build-docs, mounted in the
 * console container and on the VPS host alike), else the plugin's data folder in this checkout.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
const HUB = '/projects/amberx-axf/_data/build-docs';

export function dataDir() {
  if (process.env.AXF_BUILD_DOCS_DIR) return resolve(process.env.AXF_BUILD_DOCS_DIR);
  if (existsSync('/projects/amberx-axf')) return HUB;
  return join(ROOT, '.axf-console/plugins/build-docs');
}
export const jobDir = (id) => { if (!core.JOB_ID_RE.test(id ?? '')) throw new Error(`bad job id "${id}"`); return join(dataDir(), 'jobs', id); };

const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
export function writeJson(p, v) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 1));
  renameSync(tmp, p);
}

export function getJob(id) {
  const j = readJson(join(jobDir(id), 'job.json'));
  if (!j) return null;
  const job = core.normJob(j);
  if (existsSync(join(jobDir(id), 'cancel'))) job.cancel = true;
  return job;
}
export function saveJob(job) { const j = core.normJob(job); writeJson(join(jobDir(j.id), 'job.json'), j); return j; }

/** Apply a patch (core.advance) and save. Returns the new job. */
export function update(id, patch) {
  const j = getJob(id);
  if (!j) throw new Error(`no job ${id}`);
  return saveJob(core.advance(j, patch));
}

export function listJobs(limit = 200) {
  const d = join(dataDir(), 'jobs');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((x) => core.JOB_ID_RE.test(x)).sort().reverse().slice(0, limit).map(getJob).filter(Boolean);
}

export function createJob(spec) { const j = core.createJob(spec); mkdirSync(jobDir(j.id), { recursive: true }); return saveJob(j); }

export function readScript(id) { return readJson(join(jobDir(id), 'script.json')); }
export function writeScript(id, script) { writeJson(join(jobDir(id), 'script.json'), script); }
export function writeSource(id, n, src) { writeJson(join(jobDir(id), `source-${n}.json`), src); }
export function readSources(id) {
  const d = jobDir(id);
  return readdirSync(d).filter((f) => /^source-\d+\.json$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map((f) => readJson(join(d, f))).filter(Boolean);
}
export function writeDoc(id, build, text) { const p = join(jobDir(id), 'docs', `${build}.md`); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; }
export function readDoc(id, build) { try { return readFileSync(join(jobDir(id), 'docs', `${build}.md`), 'utf8'); } catch { return ''; } }

/** Ask a job to stop. One that isn't running anywhere yet (or waits for approval) is cancelled at once. */
export function cancel(id, by = '') {
  const j = getJob(id);
  if (!j) throw new Error(`no job ${id}`);
  if (core.FINAL.includes(j.state)) return j;
  writeFileSync(join(jobDir(id), 'cancel'), `${new Date().toISOString()} ${by}\n`);
  const running = ['recording', 'rendering'].includes(j.state);
  return update(id, running ? { cancel: true, say: `Cancel asked${by ? ` by ${by}` : ''}; stopping the recorder` } : { cancel: true, state: 'cancelled', message: 'Cancelled', say: `Cancelled${by ? ` by ${by}` : ''}` });
}
export const cancelAsked = (id) => existsSync(join(jobDir(id), 'cancel'));

/** A file a job made, if it is one of its outputs (no path tricks): { path, size, type }. */
const TYPES = { mp4: 'video/mp4', vtt: 'text/vtt', jpg: 'image/jpeg', md: 'text/markdown; charset=utf-8', json: 'application/json', log: 'text/plain; charset=utf-8' };
export function outputFile(id, name) {
  if (!/^(out\/(walkthrough\.mp4|walkthrough\.vtt|poster\.jpg|transcript\.md)|script\.json|run\.log|docs\/[a-z0-9][a-z0-9._-]{0,90}\.md)$/i.test(name ?? '')) throw new Error('not a job file');
  const p = join(jobDir(id), name);
  if (!existsSync(p)) return null;
  return { path: p, size: statSync(p).size, type: TYPES[name.split('.').pop()] ?? 'application/octet-stream' };
}

/** Drop a job and its files (Trash on the Jobs page). */
export function removeJob(id) { rmSync(jobDir(id), { recursive: true, force: true }); return { ok: true, removed: id }; }

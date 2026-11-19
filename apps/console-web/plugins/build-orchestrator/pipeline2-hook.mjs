/**
 * build-hook@1 listener (plugin.json "buildHooks"): the store change event, the second trigger of the Pipeline 2.0
 * flow (pipeline-2@1, framework/spec/PIPELINE-2.md). Every builds store write lands here right away; when a Pipeline
 * 2.0 build is sent, changes status (split, ready, build-complete, landed: the next build may become active) or a step
 * finishes, one `pipeline2.mjs advance` runs at once, detached, under the dispatcher's lock (flock), so ready never waits
 * for the cron tick. Only on the host that runs the dispatcher (its launcher and the Claude logins are here);
 * AXF_P2_HOOK=off turns it off. Idempotent: a pass with nothing to do changes nothing.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { P2_ONLY } from '../../../../framework/core/pipeline-status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
/** Statuses that should move the flow on at once. */
export const WAKE = new Set([...P2_ONLY, 'pending', 'landed']);

/** Does this batch of events need a pass? (pure) */
export function wants(events) {
  return (Array.isArray(events) ? events : []).some((e) => (e?.event === 'status' && WAKE.has(e.to)) || (e?.event === 'created' && e.to === 'pending') || e?.event === 'step-done');
}
/** Is this the dispatcher's host? */
export const onHost = (env = process.env) => env.AXF_P2_HOOK !== 'off' && existsSync(join(ROOT, 'deploy', 'claude-headless.sh')) && existsSync(env.AXF_CLAUDE_ACCOUNTS || join(homedir(), '.claude-accounts'));

export function onBuildEvents(events, { env = process.env, run = (args) => spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: 'ignore', env }).unref() } = {}) {
  if (!wants(events) || !onHost(env)) return { woke: false };
  run([join(HERE, 'pipeline2.mjs'), 'advance', '--by', 'hook']);
  return { woke: true };
}
export default onBuildEvents;

/**
 * build-hook@1 listener (plugin.json "buildHooks"): the store change event, the second trigger of the Pipeline 2.0
 * flow (pipeline-2@1, framework/spec/PIPELINE-2.md). Every builds store write lands here right away; when a Pipeline
 * 2.0 build is sent, changes status (split, ready, build-complete, landed: the next build may become active) or a step
 * finishes, one `pipeline2.mjs advance` runs at once, detached, under the dispatcher's lock (flock), so ready never waits
 * for the cron tick. Only on the host that runs the dispatcher (its launcher and the Claude logins are here);
 * AXF_P2_HOOK=off turns it off. Idempotent: a pass with nothing to do changes nothing.
 * The pass always runs the live checkout's dispatcher (AXF_DISPATCHER_ROOT, else AXF_CONSOLE_ROOT, else /opt/axf, when
 * it has this plugin), never the copy in the checkout that wrote the store: a build step's session writes from a
 * worktree cut from an older main, and its hook used to start that old dispatcher and launcher (Nov 20 2026: a step
 * that had given up was relaunched by pre-fix code after the fix was live).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
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
const SELF_REL = relative(ROOT, join(HERE, 'pipeline2.mjs'));
/** The checkout whose dispatcher a hook pass runs: the live one when it has this flow, else this checkout. */
export function dispatcherRoot(env = process.env) {
  const live = env.AXF_DISPATCHER_ROOT || (env.AXF_CONSOLE_ROOT && env.AXF_CONSOLE_ROOT !== 'off' ? env.AXF_CONSOLE_ROOT : '/opt/axf');
  return live && existsSync(join(live, SELF_REL)) ? live : ROOT;
}
export const onHost = (env = process.env) => env.AXF_P2_HOOK !== 'off' && existsSync(join(ROOT, 'deploy', 'claude-headless.sh')) && existsSync(env.AXF_CLAUDE_ACCOUNTS || join(homedir(), '.claude-accounts'));

export function onBuildEvents(events, { env = process.env, run = (args, cwd) => spawn(process.execPath, args, { cwd, detached: true, stdio: 'ignore', env }).unref() } = {}) {
  if (!wants(events) || !onHost(env)) return { woke: false };
  const root = dispatcherRoot(env);
  run([join(root, SELF_REL), 'advance', '--by', 'hook'], root);
  return { woke: true, root };
}
export default onBuildEvents;

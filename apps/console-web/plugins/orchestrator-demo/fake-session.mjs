/**
 * Orchestrator demo — the controller for fake-runner.sh (the fake headless runner). A demo build's "session" is that
 * script, never Claude: start / kill / stop / alive / probe. The probe answers in build-watchdog@1 terms (pid, tmux,
 * lastSeenAt, exit) so the real watchdog decision table judges a demo crash exactly as it would a real one.
 *
 * `fakeSessions({ dir })` spawns real processes; `memorySessions()` is the same contract without processes (tests).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDemoId } from '../../../../framework/core/demo-build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPT = join(HERE, 'fake-runner.sh');

const guard = (id) => { if (!isDemoId(id)) throw Object.assign(new Error(`fake runner refused: ${id} is not a demo build`), { code: 'not-demo-build' }); };
const read = (f) => { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function fakeSessions({ dir, maxSeconds = 900 } = {}) {
  mkdirSync(dir, { recursive: true });
  const procs = new Map();
  const pidOf = (id) => procs.get(id)?.pid || Number(read(join(dir, `${id}.pid`))) || 0;
  const api = {
    async start(id) {
      guard(id);
      if (api.alive(id)) return { session: `demo-fake-${id}`, pid: pidOf(id) };
      const child = spawn('bash', [SCRIPT, id, dir, String(maxSeconds)], { stdio: 'ignore', detached: true });
      child.unref();
      procs.set(id, child);
      for (let i = 0; i < 40 && !existsSync(join(dir, `${id}.beat`)); i += 1) await wait(50);
      return { session: `demo-fake-${id}`, pid: child.pid };
    },
    /** SIGTERM the session (the deliberate crash); resolves with its exit code (143). */
    async kill(id) {
      guard(id);
      const pid = pidOf(id);
      if (!pidAlive(pid)) return { exit: Number(read(join(dir, `${id}.exit`))) || null, wasAlive: false };
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 60 && !read(join(dir, `${id}.exit`)); i += 1) await wait(50);
      procs.delete(id);
      return { exit: Number(read(join(dir, `${id}.exit`))) || 143, wasAlive: true };
    },
    /** A clean end (exit 0). */
    async stop(id) {
      guard(id);
      writeFileSync(join(dir, `${id}.stop`), '1');
      for (let i = 0; i < 60 && api.alive(id); i += 1) await wait(50);
      procs.delete(id);
    },
    alive: (id) => pidAlive(pidOf(id)) && !read(join(dir, `${id}.exit`)),
    /** build-watchdog@1 probe for the demo build. */
    probe(id, at = new Date().toISOString()) {
      const alive = api.alive(id); const exit = read(join(dir, `${id}.exit`));
      return { pid: alive, tmux: alive, lastSeenAt: read(join(dir, `${id}.beat`)), exit: exit === '' ? null : Number(exit), exitKind: exit && exit !== '0' ? 'crash' : '', limit: '', at };
    },
    /** Kill every fake session and forget its files (the run's cleanup). */
    async cleanup(ids = null) {
      const all = ids ?? [...new Set([...procs.keys()])];
      for (const id of all) { if (api.alive(id)) await api.kill(id); for (const ext of ['pid', 'beat', 'exit', 'stop']) rmSync(join(dir, `${id}.${ext}`), { force: true }); }
      return all;
    },
    list: () => [...procs.keys()],
  };
  return api;
}

/** The same contract in memory (no processes): tests. */
export function memorySessions() {
  const s = new Map();
  const api = {
    async start(id) { guard(id); s.set(id, { alive: true, exit: null, beat: new Date().toISOString() }); return { session: `demo-fake-${id}`, pid: 0 }; },
    async kill(id) { guard(id); const x = s.get(id); if (!x?.alive) return { exit: x?.exit ?? null, wasAlive: false }; x.alive = false; x.exit = 143; return { exit: 143, wasAlive: true }; },
    async stop(id) { const x = s.get(id); if (x) { x.alive = false; x.exit = 0; } },
    alive: (id) => !!s.get(id)?.alive,
    probe(id, at = new Date().toISOString()) { const x = s.get(id); return { pid: !!x?.alive, tmux: !!x?.alive, lastSeenAt: x?.beat ?? '', exit: x?.exit ?? null, exitKind: x?.exit ? 'crash' : '', limit: '', at }; },
    async cleanup(ids = null) { const all = ids ?? [...s.keys()]; for (const id of all) s.delete(id); return all; },
    list: () => [...s.keys()],
  };
  return api;
}

/**
 * Dependency check: the demo shows the console's real-time grids and the break alert + dialog, which come from the
 * live build status build (`live-build-status-real-time-grids-15`, build-live@1, framework/spec/BUILD-LIVE.md). Without
 * them half the acts would show nothing, so the demo refuses to start and the overlay lists what is missing, in plain
 * words, with where it comes from.
 *
 * Each requirement is a file or a declaration in the checkout the console runs from (the console image carries the
 * repo), so the check is cheap and works with the console down. `AXF_DEMO_GAP_MS_TEST` (the test-only clock of the dry
 * run) skips it and says so in the answer; nothing else does.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SOURCE_BUILD = 'live-build-status-real-time-grids-15';
const PLUGINS = 'apps/console-web/plugins';

/** What the demo needs: id, plain name, what it is used for, and how to tell it is there. */
export const REQUIREMENTS = [
  { id: 'live-engine', what: 'Real-time grids: the build-live@1 engine', for: 'rows that change on their own while you watch (steps crossed off, running, crashed)', file: 'framework/core/engines/build-live.mjs' },
  { id: 'live-grids', what: 'Real-time grids in the console', for: 'the Build manager grids following build-live events without a reload', file: 'framework/react/liveBuilds.ts' },
  { id: 'live-routes', what: 'Live build state on the server (GET /api/plugins/build-orchestrator/live)', for: 'the VPS liveness pass reaching the console', file: `${PLUGINS}/build-orchestrator/server/routes_live.py` },  // axf-plugin:build-orchestrator
  { id: 'break-alert', what: 'The break alert (notify type build-live.broke)', for: 'the red "broke" pop-up when a demo build dies for good', notifyType: 'build-live.broke' },
  { id: 'broke-dialog', what: 'The "what happened" dialog of a broken build', for: 'showing what failed after the break alert', webDialog: 'build-live' },
];

const read = (root, rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return ''; } };
const dirs = (root, rel) => { try { return readdirSync(join(root, rel), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

/** Is one requirement met in the checkout at `root`? */
export function met(req, root = REPO) {
  if (req.file) return existsSync(join(root, req.file));
  if (req.notifyType) {
    return dirs(root, PLUGINS).some((d) => {
      const doc = read(root, `${PLUGINS}/${d}/notify.json`);
      if (!doc) return false;
      try { return (JSON.parse(doc).types ?? []).some((t) => t?.id === req.notifyType); } catch { return false; }
    });
  }
  if (req.webDialog) {
    const re = new RegExp(`['"\`]${req.webDialog.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\s*:\\s*\\{`);
    return dirs(root, PLUGINS).some((d) => {
      let files = [];
      try { files = readdirSync(join(root, PLUGINS, d, 'web')).filter((f) => /\.tsx?$/.test(f)); } catch { return false; }
      return files.some((f) => re.test(read(root, `${PLUGINS}/${d}/web/${f}`)));
    });
  }
  return false;
}

/**
 * { ok, missing: [{ id, what, for }], reason, skipped }. `reason` is one plain line for the overlay and the refusal.
 */
export function checkDeps({ root = REPO, env = process.env, requirements = REQUIREMENTS } = {}) {
  if (Number(env.AXF_DEMO_GAP_MS_TEST) > 0) return { ok: true, missing: [], reason: '', skipped: 'test clock (AXF_DEMO_GAP_MS_TEST): dependency check skipped', source: SOURCE_BUILD };
  const missing = requirements.filter((r) => !met(r, root)).map(({ id, what, for: why }) => ({ id, what, for: why }));
  const reason = missing.length
    ? `The demo can't start yet: ${missing.length} part${missing.length === 1 ? '' : 's'} of the live build status build (${SOURCE_BUILD}) ${missing.length === 1 ? 'is' : 'are'} not in this console: ${missing.map((m) => m.what).join('; ')}. It starts once that build has landed.`
    : '';
  return { ok: !missing.length, missing, reason, skipped: '', source: SOURCE_BUILD };
}

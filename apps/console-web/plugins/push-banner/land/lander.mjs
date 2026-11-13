#!/usr/bin/env node
/**
 * lander.mjs: the CLI of the push banner's server lander (server/lander.py). Every merge goes through the console
 * server, so a CLI merge is alerted and retried exactly like a click in the console, an MCP call or a Claude session.
 *
 *   node apps/console-web/plugins/push-banner/land/lander.mjs list [--json]
 *   node apps/console-web/plugins/push-banner/land/lander.mjs merge <owner/repo>#<n>
 *   node apps/console-web/plugins/push-banner/land/lander.mjs retry <owner/repo>#<n>     ladder again, fresh counts
 *   node apps/console-web/plugins/push-banner/land/lander.mjs forget <owner/repo>#<n>
 *   node apps/console-web/plugins/push-banner/land/lander.mjs round                     one ladder pass now
 *
 * Talks to the console API inside its container (land.mjs makeConsole: docker exec + curl, the token never leaves it).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settings, makeConsole } from './land.mjs';

const BASE = '/api/plugins/push-banner';
const PR_RE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d{1,7})$/;

/** "owner/repo#12" → {repo, number}; null when it isn't one. */
export function parsePr(s) {
  const m = PR_RE.exec(String(s || ''));
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** The request one command makes: {method, path, body} (null = unknown command or a bad PR). */
export function requestFor(cmd, arg) {
  if (cmd === 'list') return { method: 'GET', path: `${BASE}/lander` };
  if (cmd === 'round') return { method: 'POST', path: `${BASE}/lander/round` };
  const pr = parsePr(arg);
  if (!pr) return null;
  if (cmd === 'merge') return { method: 'POST', path: `${BASE}/merge`, body: { ...pr, confirm: `${pr.repo}#${pr.number}`, via: 'cli' } };
  if (cmd === 'retry' || cmd === 'forget') return { method: 'POST', path: `${BASE}/lander/${cmd}`, body: pr };
  return null;
}

/** One line per PR on the lander, phone-readable. */
export function lines(state) {
  const items = Array.isArray(state?.items) ? state.items : [];
  if (!items.length) return ['No failed merges on the lander.'];
  return items.map((it) => {
    const tries = Object.entries(it.tries || {}).map(([r, n]) => `${r} x${n}`).join(', ');
    const tail = it.state === 'stuck' || it.state === 'blocked' ? `missing: ${(it.missing || []).join('; ')}` : it.next || it.why || '';
    return `${it.repo}#${it.number} ${it.state}${tries ? ` (${tries})` : ''}: ${tail}`;
  });
}

async function main(argv) {
  const [cmd = 'list', arg] = argv.filter((a) => !a.startsWith('--'));
  const json = argv.includes('--json');
  const req = requestFor(cmd, arg);
  if (!req) {
    console.error('usage: lander.mjs list | round | merge|retry|forget <owner/repo>#<n>  [--json]');
    return 2;
  }
  const api = makeConsole(settings());
  const out = await api(req.method, req.path, req.body);
  if (out == null) {
    console.error('the console did not answer (is the axf-console container running?)');
    return 1;
  }
  if (json) console.log(JSON.stringify(out, null, 2));
  else if (cmd === 'list' || cmd === 'round') console.log(lines(out).join('\n'));
  else console.log(out.detail ? `refused: ${typeof out.detail === 'string' ? out.detail : JSON.stringify(out.detail)}` : JSON.stringify(out));
  return out.detail ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}

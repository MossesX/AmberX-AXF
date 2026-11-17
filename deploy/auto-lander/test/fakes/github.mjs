/**
 * A fake GitHub for the auto-lander loop test: the few REST reads the lander makes (pulls, check runs, Actions jobs,
 * annotations, issues), served from an in-memory world the test changes between ticks. Same call shape as the landing
 * line's client: gh(method, path, body) → data, throws { status } on a miss.
 */
export function fakeGitHub() {
  const world = { prs: {}, ci: {}, issues: [], calls: [] };
  const err = (status, m) => Object.assign(new Error(`GitHub ${status}: ${m}`), { status });
  const gh = async (method, path) => {
    world.calls.push(`${method} ${path}`);
    let m;
    if (path === '/rate_limit') return { resources: {} };
    if ((m = path.match(/\/pulls\/(\d+)$/))) { const p = world.prs[m[1]]; if (!p) throw err(404, 'no PR'); return structuredClone(p); }
    if (/\/pulls\?state=open/.test(path)) return Object.values(world.prs).filter((p) => p.state === 'open').map((p) => structuredClone(p));
    if ((m = path.match(/\/commits\/([^/]+)\/check-runs/))) {
      const c = world.ci[m[1]];
      if (!c) return { check_runs: [] };
      return { check_runs: [{ id: 1, name: 'Web Dev Console', status: c === 'running' ? 'in_progress' : 'completed', conclusion: c === 'running' ? null : c, html_url: 'u' }] };
    }
    if (/\/actions\/jobs\/1$/.test(path)) return { steps: [{ name: 'Python route tests', conclusion: 'failure' }] };
    if (/\/check-runs\/1\/annotations/.test(path)) return [{ annotation_level: 'failure', path: 'x.py', start_line: 3, message: 'AssertionError: boom' }];
    if (/\/issues\?state=open/.test(path)) return world.issues;
    throw err(404, path);
  };
  gh.calls = 0; gh.save = () => {};
  /** A PR in the world (open, clean, head sha). */
  world.pr = (n, ref, head, extra = {}) => { world.prs[n] = { number: n, state: 'open', draft: false, merged_at: null, mergeable: true, mergeable_state: 'clean', title: ref, head: { sha: head, ref, repo: { full_name: 'o/r' } }, base: { ref: 'main' }, ...extra }; return world.prs[n]; };
  /** The branch moves to a new head (a push), with CI on it. */
  world.push = (n, head, ci = 'running') => { world.prs[n].head.sha = head; world.prs[n].mergeable = true; world.prs[n].mergeable_state = 'clean'; world.ci[head] = ci; };
  world.merge = (n, at) => { world.prs[n].merged_at = at; world.prs[n].merged = true; world.prs[n].state = 'closed'; };
  return { gh, world };
}

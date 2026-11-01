/**
 * Build manager — "Start build now": the plan, pure and IO-free (the server part runs it through node; test.mjs on fixtures).
 *
 *   planStart({ row, rows, features, queue, pending, running, now }) →
 *     { ok, refuse?, wait?, reasons[], deps[], order?, model, branch, areas[], brief, verify[], dontTouch[] }
 *
 * 1. Dependency closure: the build's dependsOn (plan epics/features, the pending item's planId → its plan entry, queue
 *    StepRecord.deps) followed transitively; unbuilt ones must build first. When the build is a queue step, the queue is
 *    reordered (build-queue-core `reorder` order) so the unbuilt deps come right before it, in dependency order.
 * 2. Never twice: refused when a running entry already has this buildRef, or a running entry is on its branch.
 * 3. Never step on toes: "wait" when its areas (declared files + plan files/modules + the default folder for its kind)
 *    overlap any running entry's areas (prefix match), naming who is in the way. An unbuilt dependency that is itself
 *    running → wait for it.
 * 4. Model: the item's own (Fable items stay Fable); a queue step takes the strongest of its features (stepModel).
 * 5. Brief: item detail + steps + rules + deps + "don't touch" list + the reporting commands + the verify checks.
 */

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const norm = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const TIER = { fable: 3, opus: 2, sonnet: 1 };
const isBuilt = (f) => f?.status === 'built' || f?.status === 'dropped';

/** The plan entry a row is about (queue/plan id, or the pending item's planId). */
function planOf(row, byId) { return byId.get(row.planId ?? '') ?? byId.get(row.id) ?? null; }

/** Transitive unbuilt dependencies, deepest first (a topological order); cycles are broken and reported. */
export function dependencyClosure(rootIds, byId, extraDeps = {}) {
  const order = [], seen = new Set(), stack = new Set(), cycles = [];
  const deps = (id) => [...new Set([...(byId.get(id)?.dependsOn ?? []), ...(extraDeps[id] ?? [])])];
  const visit = (id) => {
    if (seen.has(id)) return;
    if (stack.has(id)) { cycles.push(id); return; }
    stack.add(id);
    for (const d of deps(id)) if (byId.has(d) && !isBuilt(byId.get(d))) visit(d);
    stack.delete(id); seen.add(id); order.push(id);
  };
  for (const id of rootIds) visit(id);
  return { order: order.filter((id) => !rootIds.includes(id)), cycles };
}

/** Folders a build will touch: its own areas, plan files + modules, and the obvious folder for a plugin/pending id. */
export function areasFor(row, byId) {
  const out = new Set(row.areas ?? []);
  const f = planOf(row, byId);
  for (const p of f?.files ?? []) out.add(str(p).replace(/\/+$/, ''));
  for (const m of f?.modules ?? []) out.add(`framework/android/${m}`);
  for (const t of [row.id, row.planId]) {
    const m = /^(?:plugin:)?([a-z0-9-]+)$/.exec(str(t));
    if (m && row.source === 'pending' && /plugin|manager|assistant|browser|designer/.test(m[1])) out.add(`apps/console-web/plugins/${m[1].replace(/-plugin$/, '')}`);
  }
  return [...out].filter(Boolean).slice(0, 40);
}

/** Do two path lists overlap? (one is a prefix of the other on a / boundary; `*` matches anything after it) */
export function overlaps(a = [], b = []) {
  const hits = [];
  const clean = (p) => str(p).replace(/\*.*$/, '').replace(/\/+$/, '');
  for (const x of a) for (const y of b) {
    const p = clean(x), q = clean(y);
    if (!p || !q) continue;
    if (p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`)) hits.push(p.length >= q.length ? p : q);
  }
  return [...new Set(hits)];
}

export function pickModel(row, byId) {
  const own = str(row.model).toLowerCase();
  const f = planOf(row, byId);
  let m = own || str(f?.model).toLowerCase() || 'opus';
  if (row.source === 'queue') for (const x of row.features ?? []) { const ff = byId.get(x.id); if (ff && !isBuilt(ff) && (TIER[ff.model] ?? 2) > (TIER[m] ?? 2)) m = ff.model; }
  return m.startsWith('fable') ? 'fable' : m.startsWith('sonnet') ? 'sonnet' : 'opus';
}

export function branchFor(row, model) {
  const id = norm(row.id).slice(0, 60) || 'build';
  return model === 'fable' ? `fable/${id}` : `build/${id}`;
}

/** Checks to run after the build, from the areas it touched (CLAUDE.md "Build, run, test" + CI). */
export function verifyChecks(areas) {
  const has = (p) => areas.some((a) => a === p || a.startsWith(`${p}/`) || p.startsWith(`${a}/`));
  const out = [];
  const plugins = [...new Set(areas.map((a) => (/^apps\/console-web\/plugins\/([a-z0-9-]+)/.exec(a) ?? [])[1]).filter(Boolean))];
  for (const p of plugins) {
    out.push({ name: `${p} self-test (py)`, cmd: `test -f apps/console-web/plugins/${p}/test.py && python3 apps/console-web/plugins/${p}/test.py || true` });
    out.push({ name: `${p} self-test (node)`, cmd: `test -f apps/console-web/plugins/${p}/test.mjs && node apps/console-web/plugins/${p}/test.mjs || true` });
    out.push({ name: `${p} lifecycle`, cmd: `node framework/cli/plugin-lifecycle.mjs check ${p}` });
  }
  if (plugins.length || has('apps/console-web') || has('framework/core') || has('framework/react') || has('framework/ui') || has('framework/schemas')) {
    out.push({ name: 'theme check', cmd: 'node framework/cli/check-theme.mjs' });
    out.push({ name: 'console build (tsc + vite)', cmd: "cd apps/console-web && rm -rf src/axf && mkdir -p src/axf && for d in core react ui schemas plan libs; do [ -d ../../framework/$d ] && cp -r ../../framework/$d src/axf/; done && npm ci --silent && npx tsc --noEmit && npx vite build" });
    out.push({ name: 'menu reach', cmd: 'npx -y tsx apps/console-web/scripts/menu-reach.mts' });
  }
  if (has('framework/core') || has('framework/schemas') || has('framework/assets')) {
    out.push({ name: 'framework assets', cmd: 'node framework/cli/axf.mjs validate --framework' });
    out.push({ name: 'tracker in sync', cmd: 'node framework/cli/tracker.mjs --check' });
  }
  if (has('framework/plan')) out.push({ name: 'build steps', cmd: 'node framework/spec/check-build-steps.mjs' });
  if (has('framework/python')) out.push({ name: 'axf_server', cmd: 'python3 framework/python/axf_server/test.py' });
  out.push({ name: 'project manifests', cmd: 'node framework/cli/project.mjs validate --all' });
  return out;
}

/** Is this live entry "running" for overlap purposes (stale = no word for 10 min still blocks, to be safe). */
const active = (e) => ['running', 'queued', 'stale'].includes(e.activityState ?? e.state);

export function planStart({ row, rows = [], features = [], queue = null, running = [], rules = [], reportCmd = 'node <changes.mjs (axf.changes@1 cli)>' }) {
  const reasons = [];
  if (!row) return { ok: false, refuse: 'no such build', reasons };
  const byId = new Map(features.map((f) => [f.id, f]));
  const model = pickModel(row, byId);
  const branch = branchFor(row, model);
  const areas = areasFor(row, byId);
  const live = running.filter(active);

  // 2. never twice
  const same = live.find((e) => (e.via && (e.via === `${row.source}:${row.id}` || e.via.endsWith(`:${row.id}`) || (row.planId && e.via.endsWith(`:${row.planId}`)))) || e.row?.key === row.key || (e.branch && e.branch === branch));
  if (same) return { ok: false, refuse: `Already being built: “${same.title}” (${same.source || 'a session'}${same.host ? ` on ${same.host}` : ''}).`, reasons, model, branch, areas };

  // 1. dependencies
  const root = planOf(row, byId);
  const extra = {};
  for (const [id, rec] of Object.entries(queue?.steps ?? {})) if (Array.isArray(rec?.deps)) extra[id] = rec.deps;
  const { order: depIds, cycles } = root ? dependencyClosure([root.id], byId, extra) : { order: [], cycles: [] };
  const deps = depIds.map((id) => {
    const f = byId.get(id);
    const r = rows.find((x) => x.id === id || x.planId === id);
    return { id, title: f?.title ?? id, model: pickModel({ model: f?.model, id, source: 'plan' }, byId), key: r?.key ?? '', running: live.some((e) => e.via?.endsWith(`:${id}`) || e.row?.id === id) };
  });
  if (cycles.length) reasons.push(`Dependency cycle broken at ${cycles.join(', ')}.`);
  const busyDep = deps.find((d) => d.running);
  if (busyDep) return { ok: false, wait: `Its dependency “${busyDep.title}” is being built right now: start this after it finishes.`, reasons, deps, model, branch, areas };

  // 3. overlap with running work
  const clashes = [];
  for (const e of live) {
    const hit = overlaps(areas, e.areas ?? []);
    if (hit.length) clashes.push({ title: e.title, who: `${e.source || 'a session'}${e.host ? ` on ${e.host}` : ''}`, paths: hit, changeId: e.changeId ?? '' });
  }
  if (clashes.length) return { ok: false, wait: `It would touch what's being built now: ${clashes.map((c) => `${c.paths.join(', ')} (“${c.title}”, ${c.who})`).join('; ')}. Wait for it to finish.`, reasons, clashes, deps, model, branch, areas };

  // queue reorder: unbuilt deps right before this step (only queue steps live in the queue order)
  let order = null;
  if (queue && root && byId.get(root.id)?.kind === 'epic') {
    const current = [...(queue.order ?? [])];
    const depsInQueue = depIds.filter((id) => byId.get(id)?.kind === 'epic');
    const wanted = [...depsInQueue, root.id];
    const rest = current.filter((id) => !wanted.includes(id));
    const firstUndone = rest.findIndex((id) => !isBuilt(byId.get(id)));
    const at = firstUndone < 0 ? rest.length : firstUndone;
    const next = [...rest.slice(0, at), ...wanted, ...rest.slice(at)];
    if (next.join() !== current.join()) order = next;
  }

  const dontTouch = [...new Set(live.flatMap((e) => e.areas ?? []))];
  const verify = verifyChecks(areas);
  const brief = briefFor({ row, model, branch, areas, deps, dontTouch, live, verify, rules, reportCmd });
  return { ok: true, reasons, deps, order, model, branch, areas, dontTouch, verify, brief };
}

export function briefFor({ row, model, branch, areas, deps, dontTouch, live, verify, rules, reportCmd }) {
  const steps = (row.steps ?? []).map((s, i) => `${i + 1}. ${s.done ? '[done] ' : ''}${s.text}${s.estimateText ? ` (~${s.estimateText})` : ''}`);
  const ref = `${row.source}:${row.id}`;
  const minutes = row.left ?? row.total ?? '';
  return [
    `# Build: ${row.title}`,
    '',
    `Started from the Build manager ("Start build now"). Model: ${model}. Work on branch \`${branch}\` (create it from origin/main), commit there, push it and open a PR. Never merge it.`,
    '',
    '## What to build',
    row.detail || '(no detail recorded: read the pending item / plan entry)',
    steps.length ? `\n## Steps (≤ 30 min each)\n${steps.join('\n')}` : '',
    deps.length ? `\n## Dependencies (built first, in this order)\n${deps.map((d) => `- ${d.id}: ${d.title} (${d.model})`).join('\n')}\nIf any of these is not built when you start, build it first on this branch as its own commits, or stop and report why.` : '',
    '\n## Do not touch (being built by other sessions right now)',
    dontTouch.length ? dontTouch.map((p) => `- ${p}`).join('\n') : '- nothing else is running',
    live.length ? `Running now: ${live.map((e) => `“${e.title}” (${e.source}${e.branch ? `, ${e.branch}` : ''})`).join('; ')}.` : '',
    `\nExpected to touch: ${areas.length ? areas.join(', ') : 'see the item'}.`,
    '\n## Rules',
    '- Follow CLAUDE.md and _claude/rules/RULES.md + _claude/shared/rules/RULES.md (plugin rules, theme tokens only, no secrets, small steps, Android on hold).',
    ...rules.map((r) => `- ${r}`),
    '- Watch live: whenever you start on a screen or element, run `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "<what you are changing>"` so Brett\'s live preview scrolls to and outlines it.',
    '\n## Report to the Build manager (axHub) as you go',
    'The console already opened your Codebase changes entry (the hook adopts it through AXF_ADOPT_CHANGE and prints its id; `last` points at it). Record estimates first, then steps, then the result:',
    `  ${reportCmd} update last --ref ${ref} --model ${model} --estimate-min ${minutes || '<minutes>'} ${areas.length ? `--areas "${areas.join(',')}" ` : ''}--branch ${branch}`,
    `  ${reportCmd} step last "<step>" --state running   (then done)`,
    `  ${reportCmd} result last --state done --summary "<what changed>" --branch ${branch} --commit <sha> --link pr=<PR url>`,
    '\n## When done, check nothing broke (run each; report failures in the result)',
    ...verify.map((v) => `- ${v.name}: \`${v.cmd}\``),
  ].filter((l) => l != null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Shell-safe single-quoted string. */
export const sq = (s) => `'${str(s).replace(/'/g, `'\\''`)}'`;

/**
 * The one command axHub's vps.run gets (Brett sees all of it on the approval page): a fresh worktree of the console's
 * clone on the build's branch, the brief in a file, headless Claude Code with the model, reporting env set. The brief
 * is passed base64 so no quoting can break out. Never pushes to main and never merges.
 */
/** Headless Claude Code in a tmux session the console's Terminal opens and brings to the front (Oct 26 2026); the old
 * nohup launch when the console's checkout doesn't have the helper yet. */
export function headless(name, log, args, repoDir = '/opt/axf') {
  const helper = `${repoDir}/deploy/claude-headless.sh`;
  const n = String(name).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 48);
  return `set -- ${args}; if [ -f ${sq(helper)} ]; then bash ${sq(helper)} --name ${sq(n)} --brief .axf-brief.md --log ${log} -- "$@"; `
    + `else nohup claude -p "$@" "$(cat .axf-brief.md)" > ${log} 2>&1 & echo "started pid $! in $(pwd)"; fi`;
}

export function launchCommand({ brief, branch, model, changeId, repoDir = '/opt/axf', workRoot = '/root/axf-builds' }) {
  const safeBranch = /^[A-Za-z0-9._/-]{1,120}$/.test(branch) && !branch.includes('..') ? branch : 'build/unnamed';
  const dir = `${workRoot}/${safeBranch.replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const b64 = Buffer.from(brief, 'utf8').toString('base64');
  const m = ['fable', 'opus', 'sonnet'].includes(model) ? model : 'opus';
  const id = /^chg-\d{8}-[0-9a-f]{6,16}$/.test(changeId) ? changeId : '';
  return [
    'set -e',
    `mkdir -p ${sq(workRoot)}`,
    `git -C ${sq(repoDir)} fetch -q origin`,
    `if [ ! -d ${sq(dir)} ]; then git -C ${sq(repoDir)} worktree add -q -B ${sq(safeBranch)} ${sq(dir)} origin/main; fi`,
    `cd ${sq(dir)}`,
    `echo ${sq(b64)} | base64 -d > .axf-brief.md`,
    `export AXF_SURFACE=console-launch AXF_MODEL=${m}${id ? ` AXF_ADOPT_CHANGE=${id}` : ''} AXF_CLAUDE_AUTH=\${AXF_CLAUDE_AUTH:-plan}`,
    headless(`build-${safeBranch}`, '.axf-build.log', `--model ${m} --permission-mode acceptEdits`, repoDir),
  ].join('; ');
}

/**
 * Planner targets of control@1 (planner.plans, planner.builds).
 *
 * planner.plans  plan@1 plans through the plans@1 provider's module (Plan Studio's plans.mjs: the same store, history
 *                and rules as its page, its CLI and claude.ai sessions). `add` files a plan as parked unless a status
 *                is given (the "put it in a plan for later" rule); `build` turns one into an orchestrator build.
 * planner.builds builds@1 records through the orchestrator@1 provider (orchestrator.mjs act/load: the one builds store,
 *                every write journalled; Pending, the queue and the Build manager follow). `select.profile` /
 *                AXF_BUILD_PROFILE picks the profile view; removing a build goes through the orchestrator's own
 *                `remove`.
 */
import { CONTROL_TARGETS } from '../../../../../framework/core/engines/control-rules.mjs';
import { ControlError } from './common.mjs';
import { provider } from './providers.mjs';

const wrap = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof ControlError) throw e; throw new ControlError(/^no (plan|build)\b/i.test(e.message) ? 'not_found' : 'validation', e.message); } };

/** Run fn with AXF_BUILD_PROFILE set for one call (the orchestrator reads the active profile from it). */
async function inProfile(profile, fn) {
  if (!profile) return fn();
  const was = process.env.AXF_BUILD_PROFILE;
  process.env.AXF_BUILD_PROFILE = profile;
  try { return await fn(); } finally { if (was === undefined) delete process.env.AXF_BUILD_PROFILE; else process.env.AXF_BUILD_PROFILE = was; }
}

export function runPlanner(c) {
  return c.target === 'planner.plans' ? runPlans(c) : runBuilds(c);
}

const planRow = (p) => ({ id: p.id, title: p.title, status: p.status, priority: p.priority, category: p.category, tags: p.tags, project: p.project, profile: p.profile, summary: p.summary, steps: (p.steps ?? []).length, stepsDone: (p.steps ?? []).filter((s) => s.done).length, build: p.build ?? null, updatedAt: p.updatedAt });

async function runPlans(c) {
  const ps = await provider('plans@1');
  const need = () => { const p = ps.getPlan(c.path); if (!p) throw new ControlError('not_found', `no plan ${c.path}`); return p; };
  switch (c.op) {
    case 'list': {
      const f = c.select ?? {};
      const words = String(f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      let rows = ps.loadPlans();
      if (f.status) rows = rows.filter((p) => p.status === f.status);
      if (f.priority) rows = rows.filter((p) => p.priority === f.priority);
      if (f.category) rows = rows.filter((p) => (p.category ?? '').toLowerCase().startsWith(String(f.category).toLowerCase()));
      if (f.tag) rows = rows.filter((p) => (p.tags ?? []).includes(f.tag));
      if (f.project) rows = rows.filter((p) => p.project === f.project);
      if (words.length) rows = rows.filter((p) => words.every((w) => `${p.title} ${p.summary} ${p.goal ?? ''} ${(p.tags ?? []).join(' ')} ${p.category ?? ''}`.toLowerCase().includes(w)));
      const total = rows.length;
      return { items: rows.slice(0, Math.max(1, Math.min(Number(f.limit) || 200, 500))).map(planRow), total };
    }
    case 'get': return { item: need(), history: ps.history(c.path)?.versions?.length ?? undefined };
    case 'add': {
      const r = await wrap(() => ps.savePlan({ status: 'parked', ...c.value }, { by: c.by ?? 'token-control', kind: 'save', note: c.reason ?? 'Added through Token control', force: true }));
      return { changed: true, item: r.plan, created: r.created !== false };
    }
    case 'set': {
      const p = need();
      const r = await wrap(() => ps.savePlan({ ...p, ...c.value, id: p.id }, { by: c.by ?? 'token-control', kind: 'save', note: c.reason ?? 'Changed through Token control', force: true }));
      return { changed: !r.unchanged, item: r.plan };
    }
    case 'remove': { need(); await wrap(() => ps.deletePlan(c.path)); return { removed: 1, note: 'the plan\'s history stays: act restore brings it back' }; }
    case 'act': {
      const p = need();
      const input = c.input ?? {};
      const by = c.by ?? 'token-control';
      switch (c.action) {
        case 'park': { const r = await wrap(() => ps.savePlan({ ...p, status: 'parked' }, { by, kind: 'save', note: c.reason ?? 'Parked', force: true })); return { changed: !r.unchanged, item: r.plan }; }
        case 'build': { const r = await wrap(() => ps.turnIntoBuild(p.id, { profile: input.profile || undefined, buildId: input.buildId || undefined, by })); return { changed: true, item: r.plan, build: r.build }; }
        case 'restore': { const r = await wrap(() => ps.restore(p.id, Number(input.version), by)); return { changed: true, item: r.plan ?? ps.getPlan(p.id) }; }
        case 'export': return { changed: false, text: ps.exportPlans([p.id], input.format === 'md' ? 'md' : 'json'), format: input.format === 'md' ? 'md' : 'json' };
        case 'step': {
          const steps = p.steps ?? [];
          const st = steps.find((s) => s.id === input.step) ?? steps.find((s) => s.text === input.step) ?? steps[Number(input.step) - 1];
          if (!st) throw new ControlError('not_found', `plan ${p.id} has no step ${input.step}`);
          const r = await wrap(() => ps.savePlan({ ...p, steps: steps.map((s) => (s === st ? { ...s, done: !!input.done } : s)) }, { by, kind: 'save', note: `Step ${st.id ?? st.text} ${input.done ? 'done' : 'not done'}`, force: true }));
          return { changed: !r.unchanged, item: r.plan };
        }
        case 'comment': {
          const text = String(input.text ?? '').trim();
          if (!text) throw new ControlError('validation', 'a comment needs text');
          const r = await wrap(() => ps.savePlan({ ...p, comments: [...(p.comments ?? []), { text, by, at: new Date().toISOString() }] }, { by, kind: 'save', note: 'Comment', force: true }));
          return { changed: true, item: r.plan };
        }
        default: throw new ControlError('invalid', `planner.plans has no action ${c.action}`);
      }
    }
    default: throw new ControlError('invalid', `planner.plans does not take ${c.op}`);
  }
}

const buildRow = (b) => {
  const steps = b.steps ?? [];
  return { id: b.id, title: b.title, status: b.status, category: b.category, hidden: !!b.hidden, branch: b.branch, pr: b.pr, steps: steps.length, stepsDone: steps.filter((s) => s.done).length, next: steps.find((s) => !s.done && !s.skip)?.id ?? null, updatedAt: b.updatedAt };
};

async function runBuilds(c) {
  const orch = await provider('orchestrator@1');
  const profile = c.select?.profile || c.input?.profile || (c.value && typeof c.value.profile === 'string' ? c.value.profile : '') || '';
  const by = c.by ?? 'token-control';
  return inProfile(profile, async () => {
    const state = () => orch.load();
    const need = () => { const b = state().builds.find((x) => x.id === c.path); if (!b) throw new ControlError('not_found', `no build ${c.path}${profile ? ` in profile ${profile}` : ''}`); return b; };
    const act = (change) => wrap(() => orch.act(change, by));
    switch (c.op) {
      case 'list': {
        const f = c.select ?? {};
        const words = String(f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        let rows = state().builds;
        if (!f.includeHidden) rows = rows.filter((b) => !b.hidden && b.status !== 'archived');
        if (f.status) rows = rows.filter((b) => b.status === f.status);
        if (f.category) rows = rows.filter((b) => (b.category ?? '') === f.category);
        if (words.length) rows = rows.filter((b) => words.every((w) => `${b.id} ${b.title} ${b.detail ?? ''}`.toLowerCase().includes(w)));
        return { items: rows.slice(0, Math.max(1, Math.min(Number(f.limit) || 200, 500))).map(buildRow), total: rows.length, profile: profile || undefined };
      }
      case 'get': return { item: need() };
      case 'add': {
        const { profile: _p, ...v } = c.value;
        const r = await act({ action: 'add', ...v });
        return { changed: true, item: r.build, log: r.log };
      }
      case 'set': {
        need();
        const { status, hidden, title, ...rest } = c.value;
        const logs = [];
        if (Object.keys(rest).length) logs.push(...(await act({ action: 'update', id: c.path, ...rest })).log);
        if (typeof title === 'string') logs.push(...(await act({ action: 'rename', id: c.path, title })).log);
        if (typeof status === 'string') logs.push(...(await act({ action: 'status', id: c.path, status })).log);
        if (typeof hidden === 'boolean') logs.push(...(await act({ action: hidden ? 'hide' : 'unhide', id: c.path })).log);
        return { changed: logs.length > 0, item: need(), log: logs };
      }
      case 'remove': { need(); const r = await act({ action: 'remove', id: c.path }); return { removed: 1, log: r.log }; }
      case 'act': {
        need();
        const i = c.input ?? {};
        const map = {
          step: { step: i.step, done: i.done !== false, ...(typeof i.note === 'string' ? { note: i.note } : {}) },
          approve: { phase: Number(i.phase) },
          status: { status: i.status },
          note: { text: i.text },
          rename: { title: i.title },
          'rename-step': { step: i.step, title: i.title },
          'add-step': { stepData: { text: i.text, model: i.model, estimate: i.estimate }, ...(i.after ? { at: Math.max(0, need().steps.findIndex((s) => s.id === i.after) + 1) } : {}) },
          'edit-step': { step: i.step, stepData: i.patch },
          'skip-step': { step: i.step, skip: true, ...(i.why ? { note: i.why } : {}) },
          'remove-step': { step: i.step },
          'move-step': {},
          archive: {}, hide: {}, unhide: {},
          // build-todo-sync@1: names and the Planned & fixes checklist
          name: { ...(typeof i.displayName === 'string' ? { displayName: i.displayName } : {}), ...(typeof i.category === 'string' ? { category: i.category } : {}), ...(typeof i.area === 'string' ? { area: i.area } : {}) },
          'fix-add': { text: i.text, kind: i.kind, note: i.note, link: i.link },
          'fix-set': { fix: i.fix, ...(typeof i.done === 'boolean' ? { done: i.done } : {}), ...(typeof i.text === 'string' ? { text: i.text } : {}), ...(typeof i.note === 'string' ? { note: i.note } : {}), ...(typeof i.link === 'string' ? { link: i.link } : {}), ...(typeof i.kind === 'string' ? { kind: i.kind } : {}) },
          'fix-remove': { fix: i.fix },
        };
        if (!(c.action in map) || !(c.action in (CONTROL_TARGETS['planner.builds'].acts ?? {}))) throw new ControlError('invalid', `planner.builds has no action ${c.action}`);
        if (c.action === 'move-step') { // the orchestrator moves one place at a time: walk to the index asked for
          const at = () => need().steps.findIndex((s) => s.id === i.step);
          if (at() < 0) throw new ControlError('not_found', `${c.path} has no step ${i.step}`);
          const to = Math.max(0, Math.min(Number(i.to), need().steps.length - 1));
          const log = [];
          for (let n = 0; at() !== to && n < 500; n++) log.push(...(await act({ action: 'move-step', id: c.path, step: i.step, dir: to < at() ? 'up' : 'down' })).log);
          return { changed: log.length > 0, item: need(), log };
        }
        const r = await act({ action: c.action, id: c.path, ...map[c.action] });
        return { changed: true, item: r.build ?? need(), log: r.log };
      }
      default: throw new ControlError('invalid', `planner.builds does not take ${c.op}`);
    }
  });
}

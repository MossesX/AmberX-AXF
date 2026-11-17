/**
 * Drag commands for the console (drag-move@1, framework/spec/DRAG-MOVE.md): every draggable host on the page
 * (rt.drag.hosts, framework/react/dragHost.ts) read and moved without a pointer. The same request runs from the action
 * bus (menus, Ctrl+K, console_action, `axf console action`), from REST / MCP / the CLI over the console-commands relay
 * (`control` op with a `drag.*` verb, see isDragRequest) and from voice.
 *
 *   drag.list[:<kind>[:<container>]]          hosts on the page (kind, container, label, items in order)
 *   drag.zones:<kind>:<container>:<item>       where that item may land (each target a ready drag-move@1 target)
 *   drag.move:<json>                           run a drag-move@1 move (also drag.add / drag.remove)
 *   drag.preview:<json>                        plan it and highlight the item and its landing spot, change nothing
 *   drag.voice:<phrase>                        "move the clock widget to the left of the banner" (names → ids via drag.list)
 *
 * Every answer is an envelope: `drag-list@1` / `drag-zones@1` for the reads, `drag-move-result@1` for the writes.
 */
import type { AxfRuntime } from '../axf/core';
import { dragVoiceIntent, dragVoiceScore, type DragVoiceIntent } from '../axf/core/engines/drag-voice.mjs';
import { DRAG_MOVE_CONTRACT, dragKind, dragKinds, dragMoveFailure, type DragHostSnapshot, type DragMoveResult, type DragTarget } from '../axf/core/engines/drag-move';

export const DRAG_LIST_FRAME = 'drag-list@1';
export const DRAG_ZONES_FRAME = 'drag-zones@1';
export const DRAG_VERBS = ['drag.list', 'drag.zones', 'drag.move', 'drag.add', 'drag.remove', 'drag.preview', 'drag.voice'] as const;
export type DragVerb = (typeof DRAG_VERBS)[number];
/** Most landing spots drag.zones answers (a long list is cut; `more` says so). */
export const DRAG_ZONES_MAX = 120;

export const DRAG_ACTIONS: Record<DragVerb, { label: string; effect: 'read' | 'write' | 'navigate' }> = {
  'drag.list': { label: 'Drag: list every draggable host on the page and its items in order', effect: 'read' },
  'drag.zones': { label: 'Drag: where an item may be dropped (kind:container:item)', effect: 'read' },
  'drag.move': { label: 'Drag: move an item (drag-move@1 JSON)', effect: 'write' },
  'drag.add': { label: 'Drag: add an item to a host (drag-move@1 JSON)', effect: 'write' },
  'drag.remove': { label: 'Drag: remove an item from a host (drag-move@1 JSON)', effect: 'write' },
  'drag.preview': { label: 'Drag: show where a move would land, without moving (drag-move@1 JSON)', effect: 'navigate' },
  'drag.voice': { label: 'Drag by voice: "move the clock widget to the left of the banner", "drag the Logs tab first", "remove the CPU widget"', effect: 'write' },
};

export interface DragRequest {
  verb: DragVerb;
  kind?: string;
  container?: string;
  id?: string;
  /** drag.voice: the phrase */
  text?: string;
  /** the drag-move@1 command for move / add / remove / preview */
  command?: Record<string, unknown>;
  by?: string;
}

export type DragListAnswer = { $axf: typeof DRAG_LIST_FRAME; ok: true; view: string; kinds: { kind: string; label: string; add: boolean; remove: boolean; crossContainer: boolean; zones: readonly string[] }[]; hosts: DragHostSnapshot[] };
export type DragZonesAnswer = { $axf: typeof DRAG_ZONES_FRAME; ok: true; kind: string; container: string; id: string; targets: DragTarget[]; more: boolean } | { $axf: typeof DRAG_ZONES_FRAME; ok: false; code: string; message: string; nearest?: string[] };
export type DragVoiceAnswer = DragMoveResult & { heard: string; intent: DragVoiceIntent | null; command?: Record<string, unknown>; say: string };
export type DragAnswer = DragListAnswer | DragZonesAnswer | DragMoveResult | DragVoiceAnswer;

/** A relayed console-control command that is really a drag request (`verb` starts with `drag.`). */
export function isDragRequest(raw: unknown): raw is DragRequest {
  return !!raw && typeof raw === 'object' && (DRAG_VERBS as readonly string[]).includes(String((raw as { verb?: unknown }).verb));
}

/** Action arguments → a request: reads take `kind:container:item`, writes a JSON command (or `{verb, command}`). */
export function dragActionRequest(verb: DragVerb, args: string[]): DragRequest | null {
  const text = args.join(':').trim();
  if (text.startsWith('{') && verb !== 'drag.voice') {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (verb === 'drag.list' || verb === 'drag.zones') return { verb, ...(j as Omit<DragRequest, 'verb'>) };
      return { verb, command: (j.command && typeof j.command === 'object' ? j.command : j) as Record<string, unknown> };
    } catch { return null; }
  }
  if (verb === 'drag.voice') return text ? { verb, text } : null;
  if (verb === 'drag.list') { const [kind, container] = args; return { verb, ...(kind ? { kind } : {}), ...(container ? { container } : {}) }; }
  if (verb === 'drag.zones') { const [kind, container, ...id] = args; return kind && container && id.length ? { verb, kind, container, id: id.join(':') } : null; }
  return null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The hosts on the page (optionally one kind / one container). */
export function dragList(rt: AxfRuntime, kind?: string, container?: string): DragListAnswer {
  const hosts = rt.drag.hosts.snapshots(kind || undefined).filter((h) => !container || same(h.container, container));
  const kinds = dragKinds().map((k) => ({ kind: k.kind, label: k.label, add: k.add, remove: k.remove, crossContainer: k.crossContainer, zones: k.zones }));
  return { $axf: DRAG_LIST_FRAME, ok: true, view: rt.getState().view, kinds, hosts };
}

/**
 * Every place `id` (in `container`) may land: before / after each other item of its own and every host that takes it,
 * `into` at the end, and each side of a sided host. Each candidate is checked by planning it, so what comes back always
 * runs (anything the engine refuses, `no_change` included, is left out).
 */
export function dragZones(rt: AxfRuntime, kind: string, container: string, id: string): DragZonesAnswer {
  const spec = dragKind(kind);
  if (!spec) return { $axf: DRAG_ZONES_FRAME, ok: false, code: 'unknown_kind', message: `no draggable kind ${kind} (${dragKinds().map((k) => k.kind).join(', ')})` };
  const src = rt.drag.hosts.snapshot(kind, container);
  if (!src) return { $axf: DRAG_ZONES_FRAME, ok: false, code: 'unknown_container', message: `no ${kind} host ${container} on this page`, nearest: rt.drag.hosts.containers(kind).map((c) => c.container) };
  const item = src.items.find((i) => same(i.id, id));
  if (!item) return { $axf: DRAG_ZONES_FRAME, ok: false, code: 'unknown_item', message: `${container} has no ${id}`, nearest: src.items.slice(0, 8).map((i) => i.id) };
  const hosts = spec.crossContainer ? rt.drag.hosts.snapshots(kind) : [src];
  const candidates: DragTarget[] = [];
  for (const h of hosts) {
    const sides = h.sides ?? (spec.sides && spec.zones.includes('side') ? [...spec.sides] : null);
    for (const other of h.items) {
      if (same(other.id, item.id)) continue;
      if (spec.zones.includes('before')) candidates.push({ container: h.container, zone: 'before', ref: other.id });
      if (spec.zones.includes('after')) candidates.push({ container: h.container, zone: 'after', ref: other.id });
      if (sides && spec.zones.includes('side') && !h.sides) for (const side of sides) candidates.push({ container: h.container, zone: 'side', side, ref: other.id });
    }
    if (spec.zones.includes('into')) candidates.push({ container: h.container, zone: 'into' });
    if (sides && spec.zones.includes('side')) for (const side of sides) candidates.push({ container: h.container, zone: 'side', side });
  }
  const targets: DragTarget[] = [];
  let more = false;
  for (const t of candidates) {
    try { rt.drag.hosts.plan({ $axf: DRAG_MOVE_CONTRACT, op: 'move', kind, source: { container: src.container, id: item.id }, target: t }); } catch { continue; }
    if (targets.length >= DRAG_ZONES_MAX) { more = true; break; }
    targets.push(t);
  }
  return { $axf: DRAG_ZONES_FRAME, ok: true, kind, container: src.container, id: item.id, targets, more };
}

/** Hooks a preview / a highlight can attach to (s16 / s17 fill them): what a dry run or a deep link shows. */
export const dragPreviewHooks: { show: ((rt: AxfRuntime, cmd: Record<string, unknown>, answer: DragMoveResult) => void) | null } = { show: null };

/** Run one request. Never throws: a failure is the envelope. */
export async function executeDrag(rt: AxfRuntime, req: DragRequest): Promise<DragAnswer> {
  try {
    switch (req.verb) {
      case 'drag.list': return dragList(rt, req.kind, req.container);
      case 'drag.zones': return dragZones(rt, String(req.kind ?? ''), String(req.container ?? ''), String(req.id ?? ''));
      case 'drag.voice': return await runDragVoice(rt, String(req.text ?? ''));
      case 'drag.preview': {
        const cmd = { ...(req.command ?? {}), by: req.by ?? (req.command?.by as string | undefined) ?? 'api' };
        let answer: DragMoveResult;
        try { const plan = rt.drag.hosts.plan(cmd); answer = { $axf: 'drag-move-result@1', ok: true, op: plan.op, kind: plan.kind, item: plan.item, from: plan.from, to: plan.to, order: plan.order, by: String(cmd.by) }; } catch (e) { answer = dragMoveFailure(e); }
        if (answer.ok) dragPreviewHooks.show?.(rt, cmd, answer);
        return answer;
      }
      default: {
        const op = req.verb.slice('drag.'.length);
        const cmd = { ...(req.command ?? {}), op, ...(req.by && !req.command?.by ? { by: req.by } : {}) };
        return await rt.drag.hosts.run(cmd);
      }
    }
  } catch (e) {
    return dragMoveFailure(e);
  }
}

type Found = { host: DragHostSnapshot; item: { id: string; label?: string; side?: string }; score: number };

/** The best item for the words across the hosts (narrowed to a kind when the phrase named one); ties go to the first host. */
function findItem(hosts: readonly DragHostSnapshot[], words: string, kind: string | null): Found | null {
  let best: Found | null = null;
  for (const host of hosts) {
    if (kind && host.kind !== kind) continue;
    for (const item of host.items) { const score = dragVoiceScore(words, item); if (score && (!best || score > best.score)) best = { host, item, score }; }
  }
  return best;
}

const nameOf = (i: { id: string; label?: string }) => i.label || i.id;

/**
 * A spoken drag phrase, run: the intent (core/engines/drag-voice.mjs), the names resolved to ids through drag.list (the
 * same snapshot the API reads), then drag.move / drag.add / drag.remove. The answer carries `say` for the voice.
 */
export async function runDragVoice(rt: AxfRuntime, text: string): Promise<DragVoiceAnswer> {
  const heard = String(text ?? '').trim();
  const intent = dragVoiceIntent(heard);
  const fail = (code: 'invalid' | 'unknown_item' | 'unknown_ref' | 'unknown_container', say: string): DragVoiceAnswer => ({ $axf: 'drag-move-result@1', ok: false, code, message: say, heard, intent, say });
  if (!intent) return fail('invalid', "That isn't a drag command I know.");
  const hosts = dragList(rt).hosts;
  let cmd: Record<string, unknown>;
  let label = intent.what;
  if (intent.op === 'add') {
    // what can be added is not on its host yet: a banner widget the person hid (the banner widget engine knows them all)
    const hidden = rt.bannerWidgets().filter((w) => w.attached && !w.shown).map((w) => ({ id: w.key, label: w.label }));
    const hit = hidden.map((w) => ({ w, score: Math.max(dragVoiceScore(intent.what, w), ...rt.bannerWidgets().filter((x) => x.key === w.id).flatMap((x) => x.aliases.map((a) => dragVoiceScore(intent.what, { id: a })))) })).filter((x) => x.score).sort((a, b) => b.score - a.score)[0];
    if (!hit) return fail('unknown_item', `There's no hidden widget called ${intent.what} to add.`);
    label = hit.w.label;
    const banner = hosts.find((h) => h.kind === 'banner-widget');
    if (!banner) return fail('unknown_container', 'The banner is not on this screen.');
    cmd = { op: 'add', kind: 'banner-widget', source: { id: hit.w.id }, target: whereTarget(banner, intent, null) };
  } else {
    const found = findItem(hosts, intent.what, intent.kind);
    if (!found) return fail('unknown_item', `I couldn't find ${intent.what}${intent.kind ? ` (${intent.kind.replace(/-/g, ' ')})` : ''} on this screen.`);
    label = nameOf(found.item);
    if (intent.op === 'remove') cmd = { op: 'remove', kind: found.host.kind, source: { container: found.host.container, id: found.item.id } };
    else {
      let ref: string | null = null;
      if (intent.where && (intent.where.at === 'before' || intent.where.at === 'after')) {
        const r = findItem([found.host], intent.where.ref, null);
        if (!r) return fail('unknown_ref', `I couldn't find ${intent.where.ref} next to ${label}.`);
        ref = r.item.id;
      }
      cmd = { op: 'move', kind: found.host.kind, source: { container: found.host.container, id: found.item.id }, target: whereTarget(found.host, intent, ref, found.item.side) };
    }
  }
  const answer = await rt.drag.hosts.run({ ...cmd, by: 'voice', reason: heard });
  const say = answer.ok ? `${answer.op === 'remove' ? 'Removed' : answer.op === 'add' ? 'Added' : 'Moved'} ${label}${answer.to ? ` to ${answer.to.side ? `the ${answer.to.side} of ` : ''}${answer.to.container.replace(/[._-]+/g, ' ')}, place ${answer.to.index + 1}` : ''}.` : answer.code === 'no_change' ? `${label} is already there.` : `I couldn't: ${answer.message}`;
  return { ...answer, heard, intent, command: cmd, say };
}

/** The drop target an intent's `where` names on a host (sides on a sided host, before / after a resolved ref, first / last). */
function whereTarget(host: DragHostSnapshot, intent: DragVoiceIntent, ref: string | null, side?: string): Record<string, unknown> {
  const w = intent.where ?? { at: 'last' as const };
  const c = host.container;
  if (w.at === 'side') return host.sides?.includes(w.side) ? { container: c, zone: 'side', side: w.side } : { container: c, zone: 'into', ...(w.side === 'left' || w.side === 'start' || w.side === 'top' ? { index: 0 } : {}) };
  if ((w.at === 'before' || w.at === 'after') && ref) return { container: c, zone: w.at, ref };
  const onSide = side ?? host.sides?.[0];
  if (host.sides?.length && onSide) return { container: c, zone: 'side', side: onSide, ...(w.at === 'first' ? { index: 0 } : {}) };
  return { container: c, zone: 'into', ...(w.at === 'first' ? { index: 0 } : {}) };
}

/** One line for a toast or a spoken answer. */
export function describeDrag(a: DragAnswer): string {
  if ('say' in a) return a.say;
  if (a.$axf === DRAG_LIST_FRAME) return `${a.hosts.length} draggable host${a.hosts.length === 1 ? '' : 's'} on ${a.view}`;
  if (a.$axf === DRAG_ZONES_FRAME) return a.ok ? `${a.targets.length}${a.more ? '+' : ''} places ${a.id} can go` : `${a.code}: ${a.message}`;
  if (!a.ok) return `${a.code}: ${a.message}`;
  if (!a.to) return `removed ${a.item.id} from ${a.from?.container ?? ''}`;
  return `${a.op === 'add' ? 'added' : 'moved'} ${a.item.id} to ${a.to.container}${a.to.side ? ` ${a.to.side}` : ''} place ${a.to.index + 1}`;
}

/** The drag.* actions on the action bus (full-API action registry: label, params, module, effect). */
export function installDragActions(rt: AxfRuntime): () => void {
  const offs = DRAG_VERBS.map((verb) => rt.actions.register(verb, (args) => {
    const req = dragActionRequest(verb, args);
    if (!req) { rt.toast(`${verb} needs ${verb === 'drag.zones' ? 'kind:container:item' : verb === 'drag.list' ? 'nothing, or kind[:container]' : 'a drag-move@1 JSON command'}`, 'warning', 'Drag'); return false; }
    void executeDrag(rt, { ...req, by: req.by ?? 'action' }).then((a) => {
      const line = describeDrag(a);
      rt.terminal.log('drag', `${verb}: ${line}`, a.ok ? 'info' : 'warn');
      if (verb !== 'drag.list' && verb !== 'drag.zones') rt.toast(line, a.ok ? 'info' : 'warning', 'Drag');
    });
    return true;
  }, { label: DRAG_ACTIONS[verb].label, params: true, module: 'console.drag', effect: DRAG_ACTIONS[verb].effect }));
  return () => offs.forEach((off) => off());
}

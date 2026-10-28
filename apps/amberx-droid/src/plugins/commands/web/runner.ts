/**
 * Runs a command (action, chain or wizard) against an environment: the real app (index.tsx) or a fake one (test.mjs).
 * No DOM here. While a wizard asks, the person can say:
 *   cancel / stop / never mind → stop     back / go back → ask the previous question again
 *   repeat / say again / what  → repeat   skip / none / no (on an optional question) → leave it empty
 * A step whose arguments use a slot that was skipped is skipped too, so "tag it with {tag}" never runs with no tag.
 */
import { fillDeep, norm, type CommandHit, type Effective, type SlotKind, type Step } from './core';

export interface OpOutcome { ok: boolean; say: string; changed?: boolean; open?: string; copy?: string }

export interface RunEnv {
  /** a runtime action spec */
  action(spec: string): Promise<void> | void;
  /** a notes intent (notes core); returns what to say */
  intent(intent: Record<string, unknown>): Promise<OpOutcome> | OpOutcome;
  op(name: string, args: Record<string, string>): Promise<OpOutcome> | OpOutcome;
  say(text: string): Promise<void> | void;
  /** say the question, return the answer ('' = nothing heard) */
  listen(question: string, kind: SlotKind, choices?: string[]): Promise<string>;
  ai(prompt: string): Promise<string | null>;
  molly(task: string): Promise<string | null>;
  command(id: string): Effective | undefined;
  /** the AI connection is on and answering */
  aiReady(): boolean;
  /** Molly (the console's agent) is reachable; developer commands need her (default: aiReady) */
  mollyReady?(): boolean;
}

export interface RunResult { ok: boolean; did: string; stoppedAt?: number; slots: Record<string, string>; said: string[] }

const CANCEL = /^(cancel|stop|never ?mind|forget it|quit|abort|exit)$/;
const BACK = /^(back|go back|previous|undo that)$/;
const REPEAT = /^(repeat|say (that )?again|what|pardon|sorry|come again)$/;
const SKIP = /^(skip|none|no|nothing|no thanks|pass|nope)$/;
const YES = /^(yes|yeah|yep|sure|ok|okay|do it|go|go ahead|please|confirm|correct|right|affirmative)\b/;
const MAX_DEPTH = 4;
const MAX_TRIES = 3;

export function isYes(answer: string): boolean { return YES.test(norm(answer)); }

/** Slots a step reads (`{slot}` anywhere in it). */
export function slotsIn(step: Step): string[] {
  return [...JSON.stringify(step).matchAll(/\{([a-z][a-z0-9_]*)\}/gi)].map((m) => m[1]!);
}

/** How a spoken answer is kept for its slot kind. */
export function readAnswer(kind: SlotKind, answer: string, choices?: string[]): string | null {
  const a = answer.trim();
  if (!a) return null;
  if (kind === 'yesno') return isYes(a) ? 'yes' : 'no';
  if (kind === 'number') {
    const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
    const n = norm(a).split(' ').map((w) => words[w] ?? w).find((w) => /^\d+$/.test(w));
    return n ?? null;
  }
  if (kind === 'choice' && choices?.length) {
    const n = norm(a);
    const hit = choices.find((c) => n === norm(c)) ?? choices.find((c) => n.includes(norm(c)) || norm(c).includes(n));
    return hit ?? null;
  }
  if (kind === 'tag') return norm(a).replace(/^(hashtag|tag) /, '');
  return a;
}

export async function runCommand(hit: Pick<CommandHit, 'command' | 'slots'>, env: RunEnv, depth = 0): Promise<RunResult> {
  const cmd = hit.command;
  const slots: Record<string, string> = { ...hit.slots };
  const said: string[] = [];
  const skipped = new Set<string>();
  const speak = async (t: string) => { if (t) { said.push(t); await env.say(t); } };
  const stop = (did: string, ok: boolean, i?: number): RunResult => ({ ok, did, stoppedAt: i, slots, said });

  if (depth > MAX_DEPTH) return stop('Too many commands inside commands.', false);
  const ready = cmd.developer ? (env.mollyReady?.() ?? env.aiReady()) : !cmd.needsAi || env.aiReady();
  if (!ready) {
    await speak(cmd.developer ? 'Molly isn\'t connected, so developer commands are off. Open AI snippets to set her up.' : 'The AI isn\'t connected. Open AI snippets to set it up.');
    return stop('AI not connected.', false);
  }
  if (cmd.settings?.confirm && depth === 0) {
    const a = await env.listen(`${cmd.label}${Object.values(slots).filter(Boolean).length ? `: ${Object.values(slots).filter(Boolean).join(', ')}` : ''}. Go ahead?`, 'yesno');
    if (!isYes(a)) { await speak('Okay, not doing it.'); return stop('Cancelled.', false, 0); }
  }

  const steps = cmd.steps;
  const asks = steps.map((s, i) => (s.do === 'ask' ? i : -1)).filter((i) => i >= 0);
  let last = '';
  for (let i = 0; i < steps.length; i++) {
    const raw = steps[i]!;
    if (raw.do !== 'ask' && slotsIn(raw).some((s) => skipped.has(s))) continue;
    const step = raw.do === 'ask' ? raw : fillDeep(raw, slots);
    switch (step.do) {
      case 'ask': {
        let tries = 0;
        let got: string | null = null;
        for (;;) {
          const heard = await env.listen(fillDeep(step.question, slots), step.kind ?? 'text', step.choices);
          const n = norm(heard);
          if (CANCEL.test(n)) { await speak('Stopped.'); return stop('Cancelled.', false, i); }
          if (BACK.test(n)) {
            const prev = asks.filter((a) => a < i).pop();
            if (prev !== undefined) { i = prev - 1; got = '__back'; break; }
            await speak('That was the first question.');
            continue;
          }
          if (REPEAT.test(n)) continue;
          if (step.optional && SKIP.test(n)) { got = ''; break; }
          got = readAnswer(step.kind ?? 'text', heard, step.choices);
          if (got !== null) break;
          if (++tries >= MAX_TRIES) { await speak('I didn\'t get that, so I stopped.'); return stop('No answer.', false, i); }
          await speak(step.choices?.length ? `Say one of: ${step.choices.join(', ')}.` : 'Sorry, say that again?');
        }
        if (got === '__back') continue;
        slots[step.slot] = got ?? '';
        if (!got) skipped.add(step.slot); else skipped.delete(step.slot);
        break;
      }
      case 'confirm': {
        const a = await env.listen(step.question, 'yesno');
        if (!isYes(a)) { await speak('Okay, stopping there.'); return stop('Stopped at a question.', false, i); }
        break;
      }
      case 'say': await speak(step.text); break;
      case 'wait': await new Promise((r) => setTimeout(r, Math.min(10_000, Math.max(0, step.ms)))); break;
      case 'action': await env.action(step.action); break;
      case 'intent':
      case 'op': {
        const r = step.do === 'op' ? await env.op(step.op, step.args ?? {}) : await env.intent(step.intent);
        last = r.say;
        if (!r.ok) { await speak(r.say); return stop(r.say, false, i); }
        if (r.open) await env.action(r.open);
        if (cmd.kind !== 'action' || cmd.settings?.speak !== false) await speak(r.say);
        break;
      }
      case 'ai':
      case 'molly': {
        const answer = step.do === 'ai' ? await env.ai(step.prompt) : await env.molly(step.task);
        if (answer === null) { await speak(step.do === 'ai' ? 'The AI didn\'t answer.' : 'Molly didn\'t answer.'); return stop('No answer from the AI.', false, i); }
        slots[step.do === 'ai' && step.into ? step.into : 'answer'] = answer;
        if (!(step.do === 'ai' && step.into)) await speak(answer);
        last = answer;
        break;
      }
      case 'run': {
        const sub = env.command(step.command);
        if (!sub) { await speak(`I can't find the command ${step.command}.`); return stop('Missing command.', false, i); }
        const r = await runCommand({ command: sub, slots }, env, depth + 1);
        said.push(...r.said);
        if (!r.ok) return stop(r.did, false, i);
        last = r.did;
        break;
      }
    }
  }
  const reply = cmd.settings?.reply ? fillDeep(cmd.settings.reply, slots) : '';
  if (reply) await speak(reply);
  return stop(reply || last || `${cmd.label} done.`, true);
}

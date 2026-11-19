/**
 * The voice wizard that records or edits a chain (Brett: "when recording a custom chain or editing a preexisting one run
 * a voice wizard that asks questions and tells me what to do"). Pure: it talks through `ask` / `say` and returns the
 * chain; the command center saves it. Tested by test.mjs with scripted answers.
 *
 * Recording: name → the phrase that starts it, said twice (the two must match) → which tab → steps, each said the way
 * you'd say the command ("add task buy milk", "what's due today", "say good morning", "wait 5 seconds") until "done"
 * ("undo" drops the last step, "read back" reads them) → ask before running? → saved.
 * Editing: reads the steps, then "add …", "remove step 3", "move step 2 up", "read back", "done".
 */
import { CATEGORIES, describeStep, fillDeep, findCommand, mineId, norm, recordingsMatch, phraseTaken, type CategoryId, type Command, type Effective, type Step } from './core';
import { isYes } from './runner';

export interface WizardIO {
  /** says the question, returns what was heard ('' = nothing) */
  ask(question: string): Promise<string>;
  say(text: string): Promise<void> | void;
}

const CANCEL = /^(cancel|stop|never ?mind|forget it|quit)$/;
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, last: -1 };
const numberIn = (s: string) => { for (const w of norm(s).split(' ')) { if (/^\d+$/.test(w)) return Number(w); if (w in NUMBERS) return NUMBERS[w]!; } return 0; };
const MAX_TRIES = 3;

class Cancelled extends Error {}

async function heard(io: WizardIO, q: string): Promise<string> {
  const a = (await io.ask(q)).trim();
  if (CANCEL.test(norm(a))) throw new Cancelled();
  return a;
}

/** One spoken step → steps (a known command is copied in with what was said filled in). */
export function stepsFromSpeech(text: string, commands: readonly Effective[], category: CategoryId | null): { steps: Step[]; label: string } | null {
  const n = norm(text);
  const sayM = /^(say|tell me|announce) (.+)$/.exec(n);
  if (sayM) return { steps: [{ do: 'say', text: text.trim().replace(/^(say|tell me|announce)\s+/i, '') }], label: `say “${sayM[2]}”` };
  const waitM = /^wait (\d+|one|two|three|five|ten) (seconds?|minutes?)$/.exec(n);
  if (waitM) {
    const k = /^\d+$/.test(waitM[1]!) ? Number(waitM[1]) : NUMBERS[waitM[1]!] ?? 1;
    return { steps: [{ do: 'wait', ms: Math.min(10_000, k * (waitM[2]!.startsWith('minute') ? 60_000 : 1000)) }], label: `wait ${waitM[1]} ${waitM[2]}` };
  }
  const askM = /^ask (me )?(.+)$/.exec(n);
  if (askM) return { steps: [{ do: 'ask', slot: `answer${Date.now() % 1000}`, question: text.trim().replace(/^ask (me )?/i, '') }], label: `ask “${askM[2]}”` };
  const hit = findCommand(text, commands.filter((c) => c.on && !c.id.startsWith('mine.')), { onPage: category });
  if (!hit) return null;
  if (hit.command.kind !== 'action') return { steps: [{ do: 'run', command: hit.command.id }], label: hit.command.label };
  return { steps: fillDeep(hit.command.steps, hit.slots), label: `${hit.command.label}${Object.values(hit.slots).length ? ` (${Object.values(hit.slots).join(', ')})` : ''}` };
}

async function collectSteps(io: WizardIO, commands: readonly Effective[], category: CategoryId, start: Step[]): Promise<Step[]> {
  const steps = [...start];
  let misses = 0;
  for (;;) {
    if (steps.length >= 30) { await io.say('That is the most steps a chain can hold.'); return steps; }
    const a = await heard(io, steps.length ? `Step ${steps.length + 1}? Say done when you're finished.` : 'Say the first step, the way you would say the command.');
    const n = norm(a);
    if (!n) { if (++misses >= MAX_TRIES) return steps; await io.say('I didn\'t hear anything.'); continue; }
    misses = 0;
    if (/^(done|finished|that is it|thats it|save|save it)$/.test(n)) return steps;
    if (/^(undo|remove last|remove the last step|scratch that)$/.test(n)) { const s = steps.pop(); await io.say(s ? `Removed ${describeStep(s)}.` : 'There are no steps yet.'); continue; }
    if (/^(read back|read them|read it back|read the steps)$/.test(n)) { await io.say(steps.length ? steps.map((s, i) => `${i + 1}: ${describeStep(s)}`).join('. ') : 'No steps yet.'); continue; }
    const r = stepsFromSpeech(a, commands, category);
    if (!r) { await io.say('I don\'t know that command. Say it another way, or say "say" and the words for me to speak.'); continue; }
    steps.push(...r.steps);
    await io.say(`Added: ${r.label}.`);
  }
}

async function recordPhrase(io: WizardIO, commands: readonly Effective[], except: string): Promise<string | null> {
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const a = await heard(io, 'Say the phrase that should start it.');
    if (!norm(a)) { await io.say('I didn\'t hear anything.'); continue; }
    const b = await heard(io, 'Say it once more, the same way.');
    if (!recordingsMatch(a, b)) { await io.say(`Those didn't match: “${a}” and “${b}”. Let's try again.`); continue; }
    const taken = phraseTaken(a, commands, except);
    if (taken) { await io.say(`“${a}” already runs ${taken.label}. Pick another phrase.`); continue; }
    return a.trim();
  }
  return null;
}

export type WizardResult = { ok: true; command: Command; said: string } | { ok: false; said: string };

/** Records a new chain by voice. */
export async function recordChain(io: WizardIO, commands: readonly Effective[], opts: { category?: CategoryId } = {}): Promise<WizardResult> {
  try {
    await io.say('Let\'s make a chain. Say cancel at any time to stop.');
    const name = await heard(io, 'What should I call it?');
    if (!norm(name)) return { ok: false, said: 'No name, so I stopped.' };
    const phrase = await recordPhrase(io, commands, '');
    if (!phrase) return { ok: false, said: 'I couldn\'t get a phrase that matched, so I stopped.' };
    let category = opts.category ?? null;
    if (!category) {
      const t = norm(await heard(io, 'Which tab: notes, tasks, developer, or AI snippets?'));
      category = CATEGORIES.find((c) => t.includes(c.id) || c.triggers.some((w) => t.includes(w)) || t.includes(norm(c.label)))?.id ?? 'notes';
    }
    const steps = await collectSteps(io, commands, category, []);
    if (steps.length < 1) return { ok: false, said: 'A chain needs at least one step, so I stopped.' };
    const confirm = isYes(await heard(io, 'Should I ask you before it runs? Yes or no.'));
    const id = mineId(name, (x) => commands.some((c) => c.id === x));
    const command: Command = {
      id, category, kind: steps.some((s) => s.do === 'ask') ? 'wizard' : 'chain', group: 'Yours', label: name.trim().slice(0, 80),
      description: `Made by voice: ${steps.length} step${steps.length === 1 ? '' : 's'}.`, phrases: [phrase], steps, settings: { confirm },
    };
    const said = `Saved ${command.label}. Say “${phrase}” to run it.`;
    await io.say(said);
    return { ok: true, command, said };
  } catch (e) {
    if (e instanceof Cancelled) { await io.say('Stopped, nothing saved.'); return { ok: false, said: 'Cancelled.' }; }
    throw e;
  }
}

/** Edits a chain's steps by voice; returns the new steps (or null when cancelled). */
export async function editChain(io: WizardIO, cmd: Effective, commands: readonly Effective[]): Promise<{ steps: Step[]; said: string } | null> {
  const steps = [...cmd.steps];
  try {
    await io.say(`${cmd.label} has ${steps.length} step${steps.length === 1 ? '' : 's'}: ${steps.map((s, i) => `${i + 1}, ${describeStep(s)}`).join('. ')}.`);
    let misses = 0;
    for (;;) {
      const a = await heard(io, 'Say add and a command, remove step and a number, move step and a number up or down, read back, or done.');
      const n = norm(a);
      if (!n) { if (++misses >= MAX_TRIES) break; continue; }
      misses = 0;
      if (/^(done|finished|save|save it|thats it)$/.test(n)) break;
      if (/^(read back|read them|read it back|read the steps)$/.test(n)) { await io.say(steps.map((s, i) => `${i + 1}: ${describeStep(s)}`).join('. ') || 'No steps.'); continue; }
      const rm = /^(remove|delete|drop) (step )?(.+)$/.exec(n);
      if (rm) {
        const k = numberIn(rm[3]!); const i = k === -1 ? steps.length - 1 : k - 1;
        if (i < 0 || i >= steps.length) { await io.say('There is no step with that number.'); continue; }
        const [gone] = steps.splice(i, 1); await io.say(`Removed step ${i + 1}, ${describeStep(gone!)}.`); continue;
      }
      const mv = /^move (step )?(.+?) (up|down)$/.exec(n);
      if (mv) {
        const k = numberIn(mv[2]!); const i = k === -1 ? steps.length - 1 : k - 1; const j = mv[3] === 'up' ? i - 1 : i + 1;
        if (i < 0 || i >= steps.length || j < 0 || j >= steps.length) { await io.say('It can\'t move that way.'); continue; }
        [steps[i], steps[j]] = [steps[j]!, steps[i]!]; await io.say(`Moved it to step ${j + 1}.`); continue;
      }
      const add = /^(add|then|also) (.+)$/.exec(n);
      const r = stepsFromSpeech(add ? a.trim().replace(/^(add|then|also)\s+/i, '') : a, commands, cmd.category);
      if (!r) { await io.say('I don\'t know that command. Say add, then the command the way you would say it.'); continue; }
      steps.push(...r.steps); await io.say(`Added: ${r.label}.`);
    }
    if (!steps.length) { await io.say('A chain needs at least one step, so I kept the old one.'); return null; }
    const said = `Saved ${cmd.label} with ${steps.length} step${steps.length === 1 ? '' : 's'}.`;
    await io.say(said);
    return { steps, said };
  } catch (e) {
    if (e instanceof Cancelled) { await io.say('Stopped, nothing changed.'); return null; }
    throw e;
  }
}

/**
 * Voice control rules, pure (no DOM, no runtime): what a phrase means and which command it picks. Tested by
 * `apps/amberx-droid/test.mjs`.
 *
 * A command maps trigger phrases to an action id the runtime already knows (`nav:home`, `axhub.check`, …) and, when it
 * should answer, a reply. A reply may hold `{waiting}` (approvals waiting now). Plugins add commands with
 * `registerVoiceCommands`; the user adds their own in Settings → Plugins → Voice control as `phrase = action` lines.
 */
export interface VoiceCommand {
  id: string;
  /** what the user may say; any of these, found anywhere in what was heard (whole words, case and punctuation ignored) */
  phrases: string[];
  /** action spec to dispatch (runtime vocabulary); empty = reply only */
  action: string;
  /** what AmberX says back; `{waiting}` = approvals waiting */
  reply?: string;
  /** who added it (a plugin id, or `user`) */
  module?: string;
}

export const MAX_COMMANDS = 200;
export const MAX_PHRASE = 80;

/** Lower case, letters/digits/spaces only, single spaces. */
export function normalize(text: unknown): string {
  return typeof text === 'string'
    ? text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

/** True when `phrase` appears in `heard` as whole words. */
export function contains(heard: string, phrase: string): boolean {
  const h = ` ${normalize(heard)} `;
  const p = normalize(phrase);
  return p.length > 0 && h.includes(` ${p} `);
}

export interface Match { command: VoiceCommand; phrase: string }

/** The command whose longest matching phrase is longest (the most specific one); ties go to the earlier command. */
export function pickCommand(heard: string, commands: readonly VoiceCommand[]): Match | null {
  let best: Match | null = null;
  for (const command of commands) {
    for (const phrase of command.phrases) {
      if (!contains(heard, phrase)) continue;
      if (!best || normalize(phrase).length > normalize(best.phrase).length) best = { command, phrase };
    }
  }
  return best;
}

/** Strips a wake phrase from the front of what was heard ("hey amberx open apps" → "open apps"). */
export function afterWake(heard: string, wakePhrases: readonly string[]): string {
  const h = normalize(heard);
  for (const w of [...wakePhrases].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length)) {
    const i = ` ${h} `.indexOf(` ${w} `);
    if (i >= 0) return h.slice(i + w.length).trim();
  }
  return h;
}

/** Phrases from a settings value: comma or new-line separated, trimmed, capped. */
export function phraseList(raw: unknown, max = 20): string[] {
  const out: string[] = [];
  for (const p of String(raw ?? '').split(/[,\n]+/)) {
    const t = normalize(p).slice(0, MAX_PHRASE);
    if (t && !out.includes(t) && out.length < max) out.push(t);
  }
  return out;
}

const ACTION = /^[a-z][a-z0-9._-]*(:[A-Za-z0-9._:-]+)?$/;

/** The user's own commands: `phrase[, phrase…] = action [| reply]`, one per line. Bad lines are listed, never used. */
export function parseUserCommands(raw: unknown): { commands: VoiceCommand[]; errors: string[] } {
  const commands: VoiceCommand[] = [];
  const errors: string[] = [];
  String(raw ?? '').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq < 0) { errors.push(`Line ${i + 1}: needs "phrase = action".`); return; }
    const phrases = phraseList(t.slice(0, eq), 10);
    const [action = '', reply] = t.slice(eq + 1).split('|').map((s) => s.trim());
    if (!phrases.length) { errors.push(`Line ${i + 1}: no phrase.`); return; }
    if (action && !ACTION.test(action)) { errors.push(`Line ${i + 1}: "${action}" isn't an action id.`); return; }
    if (!action && !reply) { errors.push(`Line ${i + 1}: needs an action or a reply.`); return; }
    if (commands.length < MAX_COMMANDS) commands.push({ id: `user.${i + 1}`, phrases, action, reply: reply?.slice(0, 300), module: 'user' });
  });
  return { commands, errors };
}

/** Fills `{waiting}` in a reply. */
export function fillReply(reply: string, ctx: { waiting: number }): string {
  const n = ctx.waiting;
  return reply.replace(/\{waiting\}/g, n === 0 ? 'nothing' : n === 1 ? 'one approval' : `${n} approvals`);
}

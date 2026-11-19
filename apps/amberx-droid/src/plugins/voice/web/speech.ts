/**
 * Speech text rules, pure (Oct 28 2026, Brett: "misses what I say, filters swears"). The same rules as the Android
 * side's `SpeechTuning.java`; both are held to `speech-cases.json` (test.mjs + SpeechTuningTest).
 *
 * - `wakeHit`: the wake phrase in what was heard, loosely (spaces and punctuation don't count; "amber x", "amber ex",
 *   "ambrex", "ember x", "amber acts" all mean "amberx"; "ok" = "okay").
 * - `unmask`: puts back swear words a recognizer starred out ("f*** this" → "fuck this").
 */
export const compact = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]+/g, '') : '');

const AMBERX: [string, string][] = [
  ['amberacts', 'amberx'], ['amberex', 'amberx'], ['ambrex', 'amberx'], ['emberx', 'amberx'],
  ['emberex', 'amberx'], ['amberax', 'amberx'], ['amberix', 'amberx'], ['okayamberx', 'okamberx'],
];
export function loosen(compacted: string): string {
  let s = compacted;
  for (const [a, b] of AMBERX) s = s.split(a).join(b);
  return s;
}

export function wakeHit(heard: string, phrases: readonly string[]): string | null {
  const h = loosen(compact(heard));
  if (!h) return null;
  let best: string | null = null;
  for (const p of phrases) {
    const c = loosen(compact(p));
    if (c && h.includes(c) && (best === null || c.length > loosen(compact(best)).length)) best = p;
  }
  return best;
}

const MASKED: Record<string, string> = {
  'f******': 'fucking', 'f*****': 'fucked', 'f****r': 'fucker', 'f***': 'fuck', 'm***********': 'motherfucker',
  's***': 'shit', 'b****': 'bitch', 'a******': 'asshole', 'a**': 'ass', 'd***': 'damn', 'c***': 'cunt',
  'p****': 'pussy', 'b*******': 'bullshit', 'h***': 'hell',
};

export function unmask(text: string): string {
  if (!text.includes('*')) return text;
  return text.replace(/\b([A-Za-z])(\*+)([A-Za-z]*)/g, (all, first: string, stars: string, rest: string) => {
    const word = MASKED[(first + stars + rest).toLowerCase()];
    if (!word) return all;
    return first === first.toUpperCase() ? word[0]!.toUpperCase() + word.slice(1) : word;
  });
}

/** Beep handling on Android: silence the tone on the notification + system streams (default), also media, or leave it. */
export type BeepMode = 'silence' | 'silence-all' | 'on';
export const BEEP_MODES: BeepMode[] = ['silence', 'silence-all', 'on'];
export const beepMode = (v: unknown): BeepMode => (BEEP_MODES.includes(v as BeepMode) ? (v as BeepMode) : 'silence');

/**
 * Finds a wake phrase in what was heard, loosely, and returns where it is in words: `rest` = what was said after it
 * ("Hey Amber X, open approvals" → "open approvals"). `null` = no wake phrase.
 */
export function splitWake(heard: string, phrases: readonly string[]): { phrase: string; rest: string } | null {
  const words = heard.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const wants = [...phrases].map((p) => ({ p, c: loosen(compact(p)) })).filter((x) => x.c).sort((a, b) => b.c.length - a.c.length);
  for (const { p, c } of wants) {
    for (let i = 0; i < words.length; i++) {
      let joined = '';
      for (let j = i; j < Math.min(words.length, i + 6); j++) {
        joined += words[j];
        if (loosen(joined) === c) return { phrase: p, rest: words.slice(j + 1).join(' ') };
        if (loosen(joined).length > c.length + 4) break;
      }
    }
  }
  return null;
}

/**
 * Help engine — help@1 and Help mode (Brett, Nov 1 2026): a switch that makes every app teach its own controls with
 * tooltips, short screen intros and a "What is this?" panel; off means none of it is drawn. The rules live in
 * help-rules.mjs, shared with the build engine and the coverage CLI; this file is the typed face the runtime and the
 * React Help layer (react/components/Help.tsx) use.
 *
 * Where help comes from (all in force at once, later wins, a written entry beats a draft):
 *   1. help@1 assets the app ships (framework/assets/help/*.json is baked in; apps add src/assets/help/*.json)
 *   2. packs added at run time with `rt.addHelp(id, data)` — a plugin's `help.json` (plugin@1 `help` field), libraries
 * Switch: setting `axf.help.mode` (device), action `help.mode[:on|off|toggle]`, F1 / Ctrl+Shift+H, the ? in the menu bar,
 * the Help menu, Settings → General → Help, and the spoken commands in HELP_VOICE.
 */
export {
  HELP_ACTIONS, HELP_CONTROL_SELECTOR, HELP_FRAME, HELP_INTROS_KEY, HELP_KINDS, HELP_LIMITS, HELP_MODE_KEY, HELP_SEEN_KEY, HELP_SHORTCUTS, HELP_VOICE,
  buildHelpIndex, helpCoverage, helpErrors, helpIdFor, helpTarget, introFor, introToShow, introToWalkthrough, markSeen, normalizeHelpEntry,
  normalizeHelpIntro, normalizeHelpPack, parseSeen, ratchetErrors, resolveHelp, slugLabel,
  type HelpControl, type HelpCoverage, type HelpDescriptor, type HelpEntry, type HelpIndex, type HelpIntro, type HelpIntroStep, type HelpKind,
  type HelpLink, type HelpPack, type HelpPackData,
} from './help-rules.mjs';

import { HELP_VOICE } from './help-rules.mjs';

export type HelpData = import('./help-rules.mjs').HelpPackData;

/** What a spoken phrase asks of Help mode (after lower-casing and dropping punctuation), or null. */
export function helpVoiceCommand(heard: string): 'on' | 'off' | null {
  const n = String(heard ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (HELP_VOICE.off.some((p) => n === p || n.endsWith(` ${p}`))) return 'off';
  if (HELP_VOICE.on.some((p) => n === p || n.endsWith(` ${p}`))) return 'on';
  return null;
}

/**
 * console-control@1 voice intents (spec/CONSOLE-CONTROL.md → Transports → Voice; build full-api-and-voice-control,
 * Nov 13 2026). One spoken phrase → one console-control command, or a command whose target is still words
 * (`find`: resolved by a search, best hit first). Pure, so the console (src/actions/voice-control.ts), the console server
 * (server/console_control.py `voice_intent`, the Python twin) and AmberX map a phrase the same way.
 * Fixture: spec/fixtures/console-control-voice.json. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 *
 *   "scroll down" · "scroll up a bit" · "page down" · "go to the top" / "scroll to the bottom"
 *   "open plugins settings" · "open the pipeline tab" · "go to plan studio" · "show me <x>"
 *   "find <words>" · "search for <words>"
 *   "show step 3 of <build>" · "step three of <build>"
 *   "disable plugin <y>" · "turn off the <y> plugin" · "turn the <y> plugin off" · "enable <y> plugin"
 *   "press <button>" · "click <button>" · "tap <button>"
 *   "set <setting> to <value>" · "turn <setting> on|off"
 */

export const VOICE_FRAME = 'console-control-voice@1';

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const AMOUNTS = { 'a bit': 0.25, 'a little': 0.25, 'a little bit': 0.25, 'a lot': 2, 'a page': 1, 'one page': 1, 'half a page': 0.5 };

/** Lower case, no punctuation, no politeness, single spaces. */
export function cleanPhrase(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ') // a dot, except a decimal point
    .replace(/[“”"'’,!?;:]+/g, ' ')
    .replace(/^\s*(hey |ok |okay )?(amber|amberx)\b[\s,]*/, ' ')
    .replace(/\b(please|can you|could you|would you|for me|now)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const strip = (s) => s.replace(/^(the|a|an|my)\s+/, '').replace(/\s+(screen|page|view)$/, '').trim();
/** A glyph name from spoken words: "check circle" → check-circle. */
const slug = (s) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUMBERS[w] ?? null);

/**
 * A phrase → an intent, or null when it is not a console command.
 * Intent: { verb, address?, find?: { q, kinds }, step?: number, value?, scroll?, query? }. `find` = resolve the address
 * by searching these words (kinds narrow it); `step` = then append `/step:s<n>` (a build's step).
 */
export function voiceIntent(text) {
  const p = cleanPhrase(text);
  if (!p) return null;
  let m;

  // scrolling
  if ((m = /^(?:scroll|go|jump)(?: all the way)?(?: to)?(?: the)? (top|bottom|start|end)(?: of(?: the)? (?:page|list|screen))?$/.exec(p))) {
    return { verb: 'scroll', scroll: { dir: m[1] === 'top' || m[1] === 'start' ? 'top' : 'bottom' } };
  }
  if ((m = /^page (up|down)$/.exec(p))) return { verb: 'scroll', scroll: { dir: `page-${m[1]}` } };
  if ((m = /^scroll (up|down)(?: (a bit|a little bit|a little|a lot|a page|one page|half a page|(\d+|\w+) pages?))?$/.exec(p))) {
    const amount = m[2] ? AMOUNTS[m[2]] ?? (m[3] ? num(m[3]) : null) : null;
    return { verb: 'scroll', scroll: { dir: m[1], ...(amount ? { amount } : {}) } };
  }

  // search
  if ((m = /^(?:find|search for|search|look for|look up)\s+(.+)$/.exec(p))) return { verb: 'search', query: { q: strip(m[1]) } };

  // a build's step
  if ((m = /^(?:show (?:me )?|open |go to |focus (?:on )?)?(?:the )?(?:step (\w+)|(\w+) step) of (?:the )?(?:build )?(.+?)(?: build)?$/.exec(p))) {
    const n = num(m[1] ?? m[2] ?? '');
    if (n !== null) return { verb: 'focus', find: { q: strip(m[3]), kinds: ['row'] }, step: n, options: { expand: true } };
  }

  // plugins on / off
  if ((m = /^(enable|disable|turn on|turn off|switch on|switch off)(?: the)? (?:plugin (.+)|(.+?) plugin)$/.exec(p))) {
    const on = /enable|on/.test(m[1]);
    return { verb: on ? 'plugin.enable' : 'plugin.disable', find: { q: strip(m[2] ?? m[3]), kinds: ['plugin'] } };
  }
  if ((m = /^(?:turn|switch)(?: the)? (.+?) plugin (on|off)$/.exec(p))) return { verb: m[2] === 'on' ? 'plugin.enable' : 'plugin.disable', find: { q: strip(m[1]), kinds: ['plugin'] } };

  // icon packs (icon-map@1, the Icon map plugin's actions; before the generic set / switch-to rules): "switch to the
  // duotone icon pack" · "use the filled icons" · "set the icon pack to amberx outline" · "back to the default icon pack" ·
  // "change the save icon to check circle"
  // "restore the previous icon pack" · "restore the icons from axhub" · "download the icon pack template"
  if ((m = /^(?:restore|undo|bring back)(?: the)? (?:previous |last |old )?(?:icon pack|icons|icon set)(?: change)?(?: from (?:axhub|the hub))?$/.exec(p))) return { verb: 'press', address: 'function:icon-map.pack.restore', value: /from (?:axhub|the hub)$/.test(p) ? 'hub' : 'previous' };
  // "share the phosphor duotone icon pack" · "export the lucide icon pack" (on axHub / as a file)
  if ((m = /^(?:share|publish)(?: the)? (.+?) (?:icon pack|icons|icon set)(?: on (?:axhub|the hub))?$/.exec(p))) return { verb: 'press', address: 'function:icon-map.pack.share', value: slug(m[1]) };
  if ((m = /^(?:export|download|save)(?: the)? (.+?) (?:icon pack|icon set)$/.exec(p)) && !/template$/.test(m[1])) return { verb: 'press', address: 'function:icon-map.pack.export', value: slug(m[1]) };
  if (/^(?:download|get|make|give me)(?: the| an| a)? icon (?:pack )?template$/.test(p)) return { verb: 'press', address: 'function:icon-map.template' };
  if (/^(?:(?:switch|go|change|set) )?(?:back )?(?:to |use )?(?:the )?(?:default|original|normal|branding|standard|framework) (?:icon pack|icons|icon set)$/.test(p) || /^(?:reset|clear|drop) (?:the )?(?:icon pack|icons|icon set)$/.test(p)) {
    return { verb: 'press', address: 'function:icon-map.pack.clear' };
  }
  if ((m = /^(?:switch to|use|apply|turn on|put on|go to|change to|set)(?: the)? (.+?) (?:icon pack|icons|icon set)$/.exec(p)) || (m = /^set (?:the )?icon pack (?:to|at) (.+)$/.exec(p)) || (m = /^(?:switch|change) (?:the )?icon pack to (.+)$/.exec(p))) {
    return { verb: 'press', address: 'function:icon-map.pack.use', value: strip(m[1]) };
  }
  if ((m = /^(?:change|set|make|switch) (?:the )?(.+?) icon (?:to|into|draw) (?:the |a |an )?(.+?)(?: icon| glyph)?$/.exec(p))) return { verb: 'press', address: 'function:icon-map.slot.set', value: `${strip(m[1])}:${slug(m[2])}` };

  // settings
  if ((m = /^set (?:the )?(.+?) (?:to|at) (.+)$/.exec(p))) return { verb: 'set', find: { q: strip(m[1]), kinds: ['setting'] }, value: m[2].trim() };
  if ((m = /^(?:turn|switch) (?:the )?(.+?) (on|off)$/.exec(p))) return { verb: 'set', find: { q: strip(m[1]), kinds: ['setting'] }, value: m[2] === 'on' };

  // buttons and actions
  if ((m = /^(?:press|click|tap|hit|push)(?: on)?(?: the)? (.+?)(?: button)?$/.exec(p))) return { verb: 'press', find: { q: strip(m[1]), kinds: ['button', 'function'] } };

  // screens, tabs, settings tabs
  if ((m = /^(?:open|go to|show(?: me)?|take me to|switch to)(?: the)? (.+?) settings?$/.exec(p))) return { verb: 'open', find: { q: strip(m[1]), kinds: ['tab', 'subtab'] }, within: 'view:settings' };
  if ((m = /^(?:open|go to|show(?: me)?|take me to|switch to)(?: the)? (.+?) tab$/.exec(p))) return { verb: 'open', find: { q: strip(m[1]), kinds: ['tab', 'subtab'] } };
  if (/^(?:open |go to |show(?: me)? |take me to )?(?:the )?settings$/.test(p)) return { verb: 'open', address: 'view:settings' };
  if ((m = /^(?:open|go to|show(?: me)?|take me to|switch to|bring up)(?: the)? (.+)$/.exec(p))) return { verb: 'open', find: { q: strip(m[1]), kinds: ['view', 'tab', 'subtab', 'plugin'] } };

  return null;
}

/** The address an intent ends at, once its words resolved to `hit` (a search hit's address), with the step appended. */
export function intentAddress(intent, hit) {
  const base = intent.address ?? hit ?? '';
  if (!base) return '';
  if (intent.step === undefined || intent.step === null) return base;
  return `${base}/step:s${intent.step}`;
}

/** The command an intent is, given the address its words resolved to (null for a search / scroll: none needed). */
export function intentCommand(intent, hit = null) {
  const cmd = { verb: intent.verb };
  if (intent.verb === 'search') cmd.query = intent.query;
  else if (intent.verb === 'scroll') cmd.scroll = intent.scroll;
  else cmd.address = intentAddress(intent, hit);
  if (intent.value !== undefined) cmd.value = intent.value;
  if (intent.options) cmd.options = intent.options;
  return cmd;
}

/** What to say back after the command ran (short, plain). */
export function voiceReply(intent, answer, label = '') {
  if (!answer || answer.ok === false) {
    const why = String(answer?.message ?? 'that did not work');
    if (answer?.code === 'confirmation_required') return `That deletes something. Say it again with confirm, or do it on screen.`;
    if (answer?.code === 'unavailable' && answer?.openUrl) return `No console is open. Open it and ask again.`;
    return `Couldn't: ${why}`;
  }
  const what = label || answer.address || '';
  switch (intent.verb) {
    case 'scroll': { const s = answer.scroll ?? answer.state?.scroll; return s ? (s.atBottom ? 'At the bottom.' : s.atTop ? 'At the top.' : `Scrolled, ${Math.round((s.fraction ?? 0) * 100)} percent down.`) : 'Scrolled.'; }
    case 'search': { const n = answer.hits?.length ?? 0; return n ? `${n} result${n === 1 ? '' : 's'}. Top: ${answer.hits[0].label}.` : 'Nothing found.'; }
    case 'open': return `Opened ${what}.`;
    case 'focus': return `Showing ${what}.`;
    case 'press': return `Pressed ${what}.`;
    case 'set': return `Set ${what} to ${typeof answer.value === 'boolean' ? (answer.value ? 'on' : 'off') : String(answer.value ?? intent.value)}.`;
    case 'plugin.enable': return `${what} is on.`;
    case 'plugin.disable': return `${what} is off.${answer.effects?.loses?.length ? ` ${answer.effects.loses.map((d) => d.name).join(', ')} lose${answer.effects.loses.length === 1 ? 's' : ''} a feature.` : ''}`;
    default: return 'Done.';
  }
}

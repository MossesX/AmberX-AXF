/**
 * Widget icons by voice (widget-icons@1, spec/WIDGET-ICONS.md → API, MCP, CLI, voice). A phrase picks a widget's icon,
 * how it is drawn, or puts it back:
 *
 *   "use the rocket icon for the project widget" · "set the project widget icon to rocket"
 *   "show the usage widget as text" · "show the project widget as an icon" · "… as icon and text" · "… as automatic"
 *   "reset the project widget icon" · "reset all widget icons"
 *
 * Widget words resolve against every widget the console knows (its name, then its id). The console's voice runs these
 * before the console-control grammar (src/actions/voice-control.ts), the server's POST /api/console-control/voice runs
 * the Python twin (server/widget_icons.py voice_intent), and the console actions `widget.icon.set:<phrase>` /
 * `widget.icon.reset:<phrase>` take the same phrase (or `<widget id>:<icon>`), so AmberX, MCP and the CLI reach them.
 */
import type { AxfRuntime } from '../axf/core';
import { parseWidgetIconId } from '../axf/core/engines/widget-icons';
import { resetWidgetIcon, setWidgetIcon, setWidgetMode, widgetIconsSeen } from '../axf/react';

export interface WidgetVoiceIntent { op: 'icon' | 'mode' | 'reset'; widget: string; value?: string }

const clean = (t: string) => t.toLowerCase().replace(/[.!?,]/g, ' ').replace(/^(please|hey amber|amber)\s+/, '').replace(/\s+(please)$/, '').replace(/\s+/g, ' ').trim();
const SUFFIX = /(?:\s+(?:widget|tab|setting|chip|badge))?$/;
const MODE_WORDS: Record<string, string> = { 'icon only': 'icon', 'an icon': 'icon', icon: 'icon', 'just an icon': 'icon', 'icon and text': 'icon+text', 'icon plus text': 'icon+text', 'icon with text': 'icon+text', 'text only': 'text', text: 'text', 'just text': 'text', automatic: 'auto', auto: 'auto' };
const glyphOf = (w: string) => w.trim().replace(/^(?:the|a|an)\s+/, '').replace(/\s+icon$/, '').replace(/\s+/g, '-');
const target = (w: string) => w.trim().replace(/^(?:the|my)\s+/, '').replace(SUFFIX, '').trim();

/** A phrase → a widget-icon intent (widget still words), or null. Same rules as voice_intent in server/widget_icons.py. */
export function widgetVoiceIntent(text: string): WidgetVoiceIntent | null {
  const p = clean(text);
  let m: RegExpMatchArray | null;
  if (/^(?:reset|restore) (?:all|every)(?: the)? widget icons?$/.test(p)) return { op: 'reset', widget: '*' };
  if ((m = p.match(/^(?:reset|restore)(?: the)? (.+?)(?:'s)? icon(?: to (?:its )?default)?$/))) return { op: 'reset', widget: target(m[1]!) };
  if ((m = p.match(/^(?:use|give|put)(?: the| a| an)? (.+?) icon (?:for|on|to)(?: the)? (.+)$/))) return { op: 'icon', widget: target(m[2]!), value: glyphOf(m[1]!) };
  if ((m = p.match(/^(?:set|change|make)(?: the)? (.+?)(?:'s)? icon (?:to|into)(?: the| a| an)? (.+)$/))) return { op: 'icon', widget: target(m[1]!), value: glyphOf(m[2]!) };
  if ((m = p.match(/^show(?: the)? (.+?) as (.+)$/)) && MODE_WORDS[m[2]!]) return { op: 'mode', widget: target(m[1]!), value: MODE_WORDS[m[2]!] };
  return null;
}

/** Widget words → a widget id: an id as is, else the best name match among every widget the console knows. */
export function findWidget(rt: AxfRuntime, words: string): { id: string; label: string } | null {
  if (parseWidgetIconId(words)) return { id: words, label: words };
  const all = widgetIconsSeen(rt);
  const w = words.toLowerCase();
  const name = (x: { label: string }) => x.label.toLowerCase();
  const hit = all.find((x) => name(x) === w) ?? all.find((x) => x.id.split(':')[2]!.toLowerCase() === w.replace(/\s+/g, '-'))
    ?? all.find((x) => name(x).startsWith(w)) ?? all.find((x) => name(x).includes(w)) ?? all.find((x) => x.id.toLowerCase().includes(w.replace(/\s+/g, '-')));
  return hit ? { id: hit.id, label: hit.label } : null;
}

/** Run a widget-icon phrase. null = not a widget-icon phrase (the console-control grammar takes it). */
export function runWidgetVoice(rt: AxfRuntime, text: string): { ok: boolean; say: string } | null {
  const intent = widgetVoiceIntent(text);
  if (!intent) return null;
  if (intent.op === 'reset' && intent.widget === '*') { for (const w of widgetIconsSeen(rt)) resetWidgetIcon(rt, w.id); return { ok: true, say: 'Every widget icon is back to its default.' }; }
  const w = findWidget(rt, intent.widget);
  if (!w) return { ok: false, say: `I couldn't find a widget called ${intent.widget}.` };
  if (intent.op === 'reset') { resetWidgetIcon(rt, w.id); return { ok: true, say: `${w.label} is back to its default icon.` }; }
  const err = intent.op === 'icon' ? setWidgetIcon(rt, w.id, intent.value!) : setWidgetMode(rt, w.id, intent.value!);
  if (err) return { ok: false, say: err };
  return { ok: true, say: intent.op === 'icon' ? `${w.label} now uses the ${intent.value} icon.` : `${w.label} now shows as ${intent.value === 'icon+text' ? 'icon and text' : intent.value}.` };
}

/** `widget.icon.set:<phrase | widget id:icon>` and `widget.icon.reset:<phrase | widget id>`, for voice and remote callers. */
export function installWidgetIconVoice(rt: AxfRuntime): () => void {
  const say = (r: { ok: boolean; say: string } | null, heard: string) => { const out = r ?? { ok: false, say: `"${heard}" isn't a widget icon command.` }; rt.toast(out.say, out.ok ? 'info' : 'warning', 'Widget icon'); return out.ok; };
  const offSet = rt.actions.register('widget.icon.set', (args) => {
    const [a = '', b = '', c = '', ...rest] = args;
    if (parseWidgetIconId(`${a}:${b}:${c}`) && rest.length) { const err = setWidgetIcon(rt, `${a}:${b}:${c}`, rest.join(':')); return say({ ok: !err, say: err ?? 'Icon saved.' }, args.join(':')); }
    const heard = args.join(':');
    return say(runWidgetVoice(rt, heard), heard);
  }, { label: 'Widget icon by voice: "use the rocket icon for the project widget", "show the usage widget as text" (widget.icon.set:<phrase> or <widget id>:<icon>)', params: true, module: 'console.control', effect: 'write' });
  const offReset = rt.actions.register('widget.icon.reset', (args) => {
    const heard = args.join(':');
    if (!heard) { for (const w of widgetIconsSeen(rt)) resetWidgetIcon(rt, w.id); return say({ ok: true, say: 'Every widget icon is back to its default.' }, heard); }
    if (parseWidgetIconId(heard)) { resetWidgetIcon(rt, heard); return say({ ok: true, say: 'Back to its default icon.' }, heard); }
    return say(runWidgetVoice(rt, /icon/.test(heard) ? heard : `reset the ${heard} icon`), heard);
  }, { label: 'Put a widget icon back by voice: "reset the project widget icon" (widget.icon.reset[:<phrase | widget id>]; nothing = every widget)', params: true, module: 'console.control', effect: 'write' });
  return () => { offSet(); offReset(); };
}

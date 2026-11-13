#!/usr/bin/env node
/**
 * UI Manager CLI: the same operations as the floating window, the server routes and the MCP tools (lib/core.mjs).
 *
 *   node apps/console-web/plugins/ui-manager/ui-manager.mjs elements [--q words] [--category id] [--visible a,b]
 *   … tree [--visible a,b]                            the collapsible categories; On screen now = shortcuts to the visible ids
 *   … props <element>                                 the expanding row: every property and token, value, base, source
 *   … choices <element> <prop>                        the predetermined values (never free text)
 *   … set <element> <prop> <value> [--by who] [--reason why]
 *   … reset [<element> [<prop>]] [--by who]           one property, one element, or everything
 *   … preview [--pending file.json]                   CSS + swaps + patches for a live preview, and the exit summary
 *   … apply --pending file.json [--by who]            save a whole pending document (one change-log entry)
 *   … changes [--limit n] | undo <change id>
 *   … catalog                                         what the choices come from
 *   add --json for one JSON result (the server drives it this way); exit 1 on an error with { error, code }.
 */
import * as core from './lib/core.mjs';

const argv = process.argv.slice(2);
const flags = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; }
  else words.push(a);
}
const json = !!flags.json;
const out = (v) => { console.log(json ? JSON.stringify(v) : JSON.stringify(v, null, 2)); };
const by = typeof flags.by === 'string' ? flags.by : process.env.AXF_OWNER || 'brett';
const visible = typeof flags.visible === 'string' ? flags.visible.split(',').filter(Boolean) : [];
const parseValue = (s) => { if (s === 'true') return true; if (s === 'false') return false; if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); return s; };

try {
  const [cmd, a, b, c] = words;
  switch (cmd) {
    case 'elements': out(core.listElements({ q: typeof flags.q === 'string' ? flags.q : '', category: typeof flags.category === 'string' ? flags.category : '', visible })); break;
    case 'tree': out(core.tree({ visible })); break;
    case 'props': if (!a) throw new core.UiManagerError('invalid', 'props <element>'); out(core.rows(a)); break;
    case 'choices': if (!a || !b) throw new core.UiManagerError('invalid', 'choices <element> <prop>'); out(core.choices(a, b)); break;
    case 'set': if (!a || !b || c === undefined) throw new core.UiManagerError('invalid', 'set <element> <prop> <value>'); out(core.set(a, b, parseValue(c), { by, reason: typeof flags.reason === 'string' ? flags.reason : '' })); break;
    case 'reset': out(core.reset(a ?? '', b ?? '', { by, reason: typeof flags.reason === 'string' ? flags.reason : '' })); break;
    case 'preview': out(core.preview(typeof flags.pending === 'string' ? core.targetsFromFile(flags.pending) : null)); break;
    case 'apply': if (typeof flags.pending !== 'string') throw new core.UiManagerError('invalid', 'apply --pending file.json'); out(core.apply(core.targetsFromFile(flags.pending), { by, reason: typeof flags.reason === 'string' ? flags.reason : '' })); break;
    case 'changes': out(core.changes({ limit: Number(flags.limit) || 50 })); break;
    case 'undo': if (!a) throw new core.UiManagerError('invalid', 'undo <change id>'); out(core.undo(a, { by })); break;
    case 'catalog': out(core.catalogInfo()); break;
    case 'overrides': out(core.overrides()); break;
    default: throw new core.UiManagerError('invalid', 'commands: elements | tree | props | choices | set | reset | preview | apply | changes | undo | catalog | overrides');
  }
} catch (e) {
  const code = e instanceof core.UiManagerError ? e.code : 'unexpected';
  console.log(JSON.stringify({ error: e.message, code }));
  process.exit(1);
}

/**
 * MD Studio model: pure helpers with no React and no DOM, so test.mts runs them as they are.
 *   - edit transforms for the Markdown toolbar (wrap, line prefixes, blocks) on {text, start, end}
 *   - find / replace (plain text, optional case), outline (headings), token estimate
 *   - the four views, snippets and the Claude-file wizards (data)
 */

export interface Sel { text: string; start: number; end: number }

/* ------------------------------------------------------------------ edits */

/** Wrap the selection in `before` / `after` (or remove them when it's already wrapped); empty selection = placeholder. */
export function wrap(s: Sel, before: string, after = before, placeholder = 'text'): Sel {
  const { text, start, end } = s;
  const inner = text.slice(start, end);
  if (text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after) {
    return { text: text.slice(0, start - before.length) + inner + text.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  const body = inner || placeholder;
  return { text: text.slice(0, start) + before + body + after + text.slice(end), start: start + before.length, end: start + before.length + body.length };
}

const lineStart = (t: string, i: number) => t.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (t: string, i: number) => { const n = t.indexOf('\n', i); return n < 0 ? t.length : n; };

/** Apply `fn(line, index)` to every line the selection touches; the selection grows to cover the changed lines. */
export function mapLines(s: Sel, fn: (line: string, i: number) => string): Sel {
  const a = lineStart(s.text, s.start);
  const b = lineEnd(s.text, Math.max(s.start, s.end - (s.end > s.start && s.text[s.end - 1] === '\n' ? 1 : 0)));
  const out = s.text.slice(a, b).split('\n').map(fn).join('\n');
  return { text: s.text.slice(0, a) + out + s.text.slice(b), start: a, end: a + out.length };
}

const PREFIX_RE = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

/** Heading level 1-6 on every touched line (the same level again = plain line). */
export function heading(s: Sel, level: number): Sel {
  const mark = `${'#'.repeat(Math.max(1, Math.min(6, level)))} `;
  return mapLines(s, (l) => { const m = /^(#{1,6})\s+/.exec(l); const rest = l.replace(/^#{1,6}\s+/, ''); return m && m[1]!.length === level ? rest : mark + rest; });
}

/** A list or quote prefix on every touched line: bullet, number, check or quote; toggles off when all lines have it. */
export function linePrefix(s: Sel, kind: 'bullet' | 'number' | 'check' | 'quote'): Sel {
  const has = { bullet: /^\s*[-*+]\s+(?!\[[ xX]\])/, number: /^\s*\d+[.)]\s+/, check: /^\s*[-*+]\s+\[[ xX]\]\s+/, quote: /^\s*>\s?/ }[kind];
  const a = lineStart(s.text, s.start), b = lineEnd(s.text, s.end);
  const lines = s.text.slice(a, b).split('\n');
  const all = lines.every((l) => !l.trim() || has.test(l));
  return mapLines(s, (l, i) => {
    if (!l.trim() && lines.length > 1) return l;
    if (all) return l.replace(has, (m) => m.match(/^\s*/)![0]);
    const [, ind = ''] = /^(\s*)/.exec(l) ?? [];
    const bare = l.replace(PREFIX_RE, '');
    const p = kind === 'bullet' ? '- ' : kind === 'number' ? `${i + 1}. ` : kind === 'check' ? '- [ ] ' : '> ';
    return ind + p + bare.trimStart();
  });
}

/** Tick or untick the checklist item on line `line` (1-based) of `text`; other lines untouched. */
export function toggleCheck(text: string, line: number): string {
  const lines = text.split('\n');
  const l = lines[line - 1];
  if (l === undefined) return text;
  lines[line - 1] = l.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_m, a: string, x: string, b: string) => `${a}${x === ' ' ? 'x' : ' '}${b}`);
  return lines.join('\n');
}

/** Insert `block` on its own lines at the cursor (blank line before and after); the selection lands on `select` inside it. */
export function insertBlock(s: Sel, block: string, select?: string): Sel {
  const before = s.text.slice(0, s.start), after = s.text.slice(s.end);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const text = before + pre + block + post + after;
  const at = before.length + pre.length;
  const i = select ? block.indexOf(select) : -1;
  return i >= 0 ? { text, start: at + i, end: at + i + select!.length } : { text, start: at + block.length, end: at + block.length };
}

/** Insert plain text at the cursor (replacing the selection). */
export const insertText = (s: Sel, t: string): Sel => ({ text: s.text.slice(0, s.start) + t + s.text.slice(s.end), start: s.start + t.length, end: s.start + t.length });

export function link(s: Sel): Sel {
  const label = s.text.slice(s.start, s.end) || 'link text';
  const t = `[${label}](url)`;
  const text = s.text.slice(0, s.start) + t + s.text.slice(s.end);
  const u = s.start + label.length + 3;
  return { text, start: u, end: u + 3 };
}

export function codeBlock(s: Sel): Sel {
  const inner = s.text.slice(s.start, s.end);
  return insertBlock({ ...s }, `\`\`\`\n${inner || 'code'}\n\`\`\``, inner ? undefined : 'code');
}

export function table(s: Sel, cols = 3, rows = 2): Sel {
  const head = `| ${Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`;
  const rule = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = Array.from({ length: rows }, () => `| ${Array.from({ length: cols }, () => '   ').join(' | ')} |`);
  return insertBlock(s, [head, rule, ...body].join('\n'), 'Column 1');
}

/** Every toolbar tool: id → edit. One list, so the toolbar, the shortcuts, the help and the tests agree. */
export const TOOLS: { id: string; label: string; icon: string; key?: string; run: (s: Sel) => Sel }[] = [
  { id: 'h1', label: 'Heading 1', icon: 'type', run: (s) => heading(s, 1) },
  { id: 'h2', label: 'Heading 2', icon: 'type', run: (s) => heading(s, 2) },
  { id: 'h3', label: 'Heading 3', icon: 'type', run: (s) => heading(s, 3) },
  { id: 'bold', label: 'Bold', icon: 'type', key: 'b', run: (s) => wrap(s, '**') },
  { id: 'italic', label: 'Italic', icon: 'edit', key: 'i', run: (s) => wrap(s, '*') },
  { id: 'strike', label: 'Strikethrough', icon: 'minus', run: (s) => wrap(s, '~~') },
  { id: 'code', label: 'Inline code', icon: 'code', key: 'e', run: (s) => wrap(s, '`', '`', 'code') },
  { id: 'bullet', label: 'Bullet list', icon: 'list', run: (s) => linePrefix(s, 'bullet') },
  { id: 'number', label: 'Numbered list', icon: 'list', run: (s) => linePrefix(s, 'number') },
  { id: 'check', label: 'Checklist', icon: 'check', run: (s) => linePrefix(s, 'check') },
  { id: 'quote', label: 'Quote', icon: 'chevron-right', run: (s) => linePrefix(s, 'quote') },
  { id: 'link', label: 'Link', icon: 'external', key: 'k', run: link },
  { id: 'codeblock', label: 'Code block', icon: 'terminal', run: codeBlock },
  { id: 'table', label: 'Table', icon: 'grid', run: (s) => table(s) },
  { id: 'rule', label: 'Divider', icon: 'minus', run: (s) => insertBlock(s, '---') },
];

/* ------------------------------------------------------------------ find / replace */

export interface FindOpts { caseSensitive?: boolean }

/** Every match of `q` in `text` as [start, end) pairs (plain text, not a pattern). */
export function findAll(text: string, q: string, o: FindOpts = {}): [number, number][] {
  if (!q) return [];
  const hay = o.caseSensitive ? text : text.toLowerCase(), needle = o.caseSensitive ? q : q.toLowerCase();
  const out: [number, number][] = [];
  for (let i = hay.indexOf(needle); i >= 0 && out.length < 5000; i = hay.indexOf(needle, i + needle.length)) out.push([i, i + needle.length]);
  return out;
}

/** The next match after `from` (wrapping round), or null. */
export function findNext(text: string, q: string, from: number, o: FindOpts = {}): [number, number] | null {
  const all = findAll(text, q, o);
  return all.find(([a]) => a >= from) ?? all[0] ?? null;
}

export function replaceAll(text: string, q: string, r: string, o: FindOpts = {}): { text: string; count: number } {
  const all = findAll(text, q, o);
  let out = '', at = 0;
  for (const [a, b] of all) { out += text.slice(at, a) + r; at = b; }
  return { text: out + text.slice(at), count: all.length };
}

/* ------------------------------------------------------------------ outline + tokens */

export interface Heading { level: number; text: string; line: number; slug: string }

/** Headings outside fenced code blocks, with their line (1-based) and a slug. */
export function outline(text: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, line: i + 1, slug: m[2]!.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') });
  });
  return out;
}

/** Character offset of the start of line `line` (1-based). */
export const offsetOfLine = (text: string, line: number) => { let at = 0; for (let i = 1; i < line; i++) { const n = text.indexOf('\n', at); if (n < 0) return text.length; at = n + 1; } return at; };

/** Rough token count (four characters a token), the same as the server's. */
export const tokens = (text: string) => Math.floor((text.length + 3) / 4);

/** Strip HTML comments (hidden plugin markers) before rendering. */
export const forPreview = (text: string) => text.replace(/<!--[\s\S]*?-->\n?/g, '');

/* ------------------------------------------------------------------ views */

export type ViewId = 'browse' | 'read' | 'write' | 'ide';
export type PaneMode = 'preview' | 'edit' | 'split';
/**
 * The four views (Brett: "3 views plus a 4th IDE-style view, each changing how everything renders"): what the column
 * shows, how a doc tab opens and whether the outline / references dock beside the docs.
 */
export const VIEWS: { id: ViewId; label: string; icon: string; column: 'wide' | 'narrow' | 'hidden' | 'tree'; mode: PaneMode; side: boolean; hint: string }[] = [
  { id: 'browse', label: 'Browse', icon: 'folder', column: 'wide', mode: 'preview', side: false, hint: 'Big file column with every scope; docs open rendered.' },
  { id: 'read', label: 'Read', icon: 'eye', column: 'narrow', mode: 'preview', side: false, hint: 'Slim column, docs rendered wide for reading.' },
  { id: 'write', label: 'Write', icon: 'edit', column: 'hidden', mode: 'split', side: false, hint: 'Column tucked away; editor and live preview side by side.' },
  { id: 'ide', label: 'IDE', icon: 'code', column: 'tree', mode: 'edit', side: true, hint: 'Dense tree, editor tabs, outline and references docked on the right.' },
];
export const viewOf = (id: string | null | undefined) => VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;

/* ------------------------------------------------------------------ ids */

export const scopeOfId = (id: string) => id.split(':', 1)[0] ?? '';
export const nameOfId = (id: string) => id.slice(id.lastIndexOf('/') + 1).replace(/^[a-z]+:/, '');
export const tabIdOf = (fileId: string, kind = 'md-doc') => `${kind}:${fileId}`;
/** A loose reference from voice or a link ("CLAUDE.md", "/projects/x/_claude/a.md", "notes/plans/x.md") → an id guess. */
export function idFromLoose(input: string): string {
  const s = input.trim();
  if (/^(repo|hub|notes):/.test(s)) return s;
  const hub = /\/projects\/([^/]+)\/_claude\/(.+\.md)$/.exec(s);
  if (hub) return hub[1] === '_shared' && hub[2]!.startsWith('notes/') ? `notes:${hub[2]!.slice(6)}` : `hub:${hub[1]}/${hub[2]}`;
  if (/^notes\//.test(s)) return `notes:${s.slice(6)}`;
  return `repo:${s.replace(/^\.?\//, '')}`;
}

/* ------------------------------------------------------------------ snippets */

export interface Snippet { id: string; label: string; category: string; body: string }
export const SNIPPETS: Snippet[] = [
  { id: 'rule', category: 'Claude rules', label: 'Dated rule', body: '- **Rule name (Nov 3 2026, Brett: "what he said"):** what to do, when, and how it is checked.' },
  { id: 'decision', category: 'Claude rules', label: 'Decision', body: '## Decision: title (date)\n\n- **Why:** …\n- **How to apply:** …\n' },
  { id: 'import', category: 'Claude rules', label: 'Import a file', body: '@_claude/rules/RULES.md' },
  { id: 'plugin-mark', category: 'Claude rules', label: 'Plugin marker', body: '<!-- axf-plugin:md-studio -->' },
  { id: 'thread', category: 'Threads', label: 'Thread row', body: '| Thread (profile `id`, model; Brett date) | queued | `claude/branch` | - | note | 2026-11-03 |' },
  { id: 'carry', category: 'Threads', label: 'To carry on', body: '### id (profile)\n- Asked in full: …\n- Model: Opus\n- Branch: `claude/…`\n- Steps left: …\n- Files to read: …\n- Checks: …\n- Waits on: …\n- First message: "…"\n' },
  { id: 'step', category: 'Builds', label: 'Build step', body: '- [ ] s1 (~20m) [Opus] what this step does' },
  { id: 'report', category: 'Builds', label: 'Report skeleton', body: '# Build report: id\n\n## What was asked\n\n## What was built\n\n## Tests\n\n## Known gaps\n' },
  { id: 'todo', category: 'Lists', label: 'Checklist', body: '- [ ] first\n- [ ] second\n- [ ] third' },
  { id: 'table', category: 'Lists', label: 'Two-column table', body: '| Name | Notes |\n| --- | --- |\n|  |  |' },
  { id: 'callout', category: 'Text', label: 'Note callout', body: '> **Note:** …' },
  { id: 'details', category: 'Text', label: 'Collapsible', body: '<details><summary>More</summary>\n\n…\n\n</details>' },
  { id: 'bash', category: 'Code', label: 'Shell block', body: '```bash\nnode framework/cli/axf.mjs validate --framework\n```' },
  { id: 'json', category: 'Code', label: 'JSON block', body: '```json\n{ "$axf": "asset@1" }\n```' },
];

/* ------------------------------------------------------------------ wizards */

export type WizardScope = 'project' | 'claude' | 'repo';
export interface WizardField { id: string; label: string; placeholder?: string; rows?: number }
export interface Wizard {
  id: string; label: string; icon: string;
  /** what it's for (the categories Brett asked for) */
  purpose: 'Instructions' | 'Rules' | 'Persona' | 'Tracking' | 'Skills' | 'Docs';
  scopes: WizardScope[];
  /** default path in each scope; {name} and {slug} are filled in */
  path: Partial<Record<WizardScope, string>>;
  fields: WizardField[];
  render: (v: Record<string, string>) => string;
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
const lines = (s: string | undefined) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const bullets = (s: string | undefined, empty = '- …') => lines(s).map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n') || empty;
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).replace(',', '');

export const WIZARDS: Wizard[] = [
  {
    id: 'claude-md', label: 'CLAUDE.md', icon: 'file', purpose: 'Instructions', scopes: ['repo', 'project'],
    path: { repo: 'CLAUDE.md', project: '{name}/CLAUDE.md' },
    fields: [{ id: 'name', label: 'Project name', placeholder: 'AmberX AXF' }, { id: 'about', label: 'What it is', rows: 3 }, { id: 'stack', label: 'Stack and layout', rows: 3 }, { id: 'commands', label: 'Build, run, test commands (one a line)', rows: 4 }],
    render: (v) => `# ${v.name || 'Project'}\n\n${v.about || '…'}\n\n**Brett's rules (always loaded):**\n\n@_claude/shared/rules/RULES.md\n@_claude/rules/RULES.md\n\n## Stack & layout\n\n${v.stack || '…'}\n\n## Build, run, test\n\n\`\`\`bash\n${lines(v.commands).join('\n') || '# …'}\n\`\`\`\n\n## Persona\n\n@_claude/persona.md\n`,
  },
  {
    id: 'rules', label: 'Rules file', icon: 'shield', purpose: 'Rules', scopes: ['claude', 'repo'],
    path: { claude: 'rules/{slug}.md', repo: '_claude/rules/{slug}.md' },
    fields: [{ id: 'name', label: 'Title', placeholder: 'Deploy rules' }, { id: 'rules', label: 'Rules (one a line)', rows: 6 }],
    render: (v) => `# ${v.name || 'Rules'}\n\n${lines(v.rules).map((r) => `- **${r.split(':')[0]} (${today()}, Brett):** ${r.includes(':') ? r.slice(r.indexOf(':') + 1).trim() : r}`).join('\n') || '- …'}\n`,
  },
  {
    id: 'persona', label: 'Persona', icon: 'user', purpose: 'Persona', scopes: ['claude', 'repo'],
    path: { claude: 'persona.md', repo: '_claude/persona.md' },
    fields: [{ id: 'name', label: 'Name', placeholder: 'Amber' }, { id: 'voice', label: 'How it talks', rows: 3 }, { id: 'limits', label: 'Never (one a line)', rows: 3 }],
    render: (v) => `# ${v.name || 'Persona'} (how Claude talks to Brett)\n\nAlways. Every session, every surface.\n\n- Your name is **${v.name || '…'}**.\n- ${v.voice || 'Talk …'}\n${lines(v.limits).map((l) => `- Never ${l.replace(/^never\s+/i, '')}`).join('\n')}\n- Code, code comments, commit messages and docs stay clean and professional.\n`,
  },
  {
    id: 'skill', label: 'Skill', icon: 'sparkles', purpose: 'Skills', scopes: ['repo', 'claude'],
    path: { repo: '.claude/skills/{slug}/SKILL.md', claude: 'skills/{slug}/SKILL.md' },
    fields: [{ id: 'name', label: 'Skill name', placeholder: 'deploy-console' }, { id: 'description', label: 'When to use it', rows: 2 }, { id: 'steps', label: 'Steps (one a line)', rows: 5 }],
    render: (v) => `---\nname: ${slug(v.name || 'skill')}\ndescription: ${(v.description || '…').replace(/\n/g, ' ')}\n---\n\n# ${v.name || 'Skill'}\n\n${lines(v.steps).map((s, i) => `${i + 1}. ${s}`).join('\n') || '1. …'}\n`,
  },
  {
    id: 'instructions', label: 'Instructions', icon: 'layers', purpose: 'Instructions', scopes: ['claude', 'repo'],
    path: { claude: 'instructions/{slug}.md', repo: '_claude/instructions/{slug}.md' },
    fields: [{ id: 'name', label: 'Title', placeholder: 'How to release' }, { id: 'body', label: 'Steps or notes', rows: 6 }],
    render: (v) => `# ${v.name || 'Instructions'}\n\n${bullets(v.body)}\n`,
  },
  {
    id: 'decision', label: 'Decision', icon: 'check', purpose: 'Tracking', scopes: ['claude', 'repo'],
    path: { claude: 'memory/decisions/{slug}.md', repo: '_claude/memory/decisions/{slug}.md' },
    fields: [{ id: 'name', label: 'Decision', placeholder: 'Notes live on the hub' }, { id: 'why', label: 'Why', rows: 2 }, { id: 'how', label: 'How to apply', rows: 2 }],
    render: (v) => `# Decision: ${v.name || '…'} (${today()})\n\n- **Why:** ${v.why || '…'}\n- **How to apply:** ${v.how || '…'}\n`,
  },
  {
    id: 'readme', label: 'README', icon: 'file', purpose: 'Docs', scopes: ['repo', 'project'],
    path: { repo: '{slug}/README.md', project: '{name}/README.md' },
    fields: [{ id: 'name', label: 'Folder or title', placeholder: 'framework/libs/hubstatus' }, { id: 'about', label: 'What it is', rows: 3 }, { id: 'usage', label: 'How to use it', rows: 3 }],
    render: (v) => `# ${v.name?.split('/').pop() || 'Title'}\n\n${v.about || '…'}\n\n## Usage\n\n${v.usage || '…'}\n`,
  },
];

export const WIZARD_PURPOSES = [...new Set(WIZARDS.map((w) => w.purpose))];

/** The file path a wizard writes in a scope (before the scope's id prefix). */
export function wizardPath(w: Wizard, scope: WizardScope, v: Record<string, string>): string {
  const t = w.path[scope] ?? w.path[w.scopes[0]!]!;
  return t.replace('{slug}', slug(v.name || w.id)).replace('{name}', (v.name || '').trim().replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^\/+|\/+$/g, '') || slug(w.id));
}

/** The id a wizard creates: repo files in the repo, Claude files on the hub project (default amberx-axf). */
export function wizardId(w: Wizard, scope: WizardScope, v: Record<string, string>, hubProject = 'amberx-axf'): string {
  const p = wizardPath(w, scope, v);
  if (scope === 'claude') return `hub:${hubProject}/${p}`;
  if (scope === 'project') return `repo:${p.startsWith('apps/') ? p : `apps/${p}`}`;
  return `repo:${p}`;
}

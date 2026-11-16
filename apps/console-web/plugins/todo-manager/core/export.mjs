/**
 * todo-tree@1 export: any subtree (or the whole tree) as a Markdown checklist or as JSON. Pure; the engine is
 * ./todo-tree.mjs. Contract: ../SPEC.md §8.
 */
import { FORMAT, childrenIndex, descendants, isCheckable, node, pathOf } from './todo-tree.mjs';

const MAX_HEADING = 3;

/** Safe filename stem from a title. */
export function exportFilename(doc, rootId = null, ext = 'md') {
  const title = rootId == null ? doc.project || 'todos' : node(doc, rootId).title;
  const stem = title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'todos';
  return `${stem}.${ext}`;
}

function meta(n) {
  const bits = [];
  if (n.due) bits.push(`due ${n.due.replace('T', ' ')}`);
  if (n.priority && n.priority !== 'normal' && n.priority !== 'none') bits.push(n.priority);
  if (n.status && n.status !== 'open' && n.status !== 'done') bits.push(n.status);
  const tags = (n.tags ?? []).map((t) => `#${t}`).join(' ');
  return `${bits.length ? ` _(${bits.join(', ')})_` : ''}${tags ? ` ${tags}` : ''}`;
}

function bullet(n) {
  if (isCheckable(n)) return `- [${n.done ? 'x' : ' '}] ${n.title}${meta(n)}`;
  if (n.kind === 'list') return `- **${n.title}**${meta(n)}`;
  return `- • ${n.title}${meta(n)}`;
}

function bodyLines(n, indent) {
  if (!n.body) return [];
  return n.body.split('\n').map((l) => `${indent}${l}`);
}

/**
 * toMarkdown(doc, rootId | null, { showDone }) → string. The root is the H1 (the project or "Todos" for the whole tree);
 * lists become headings down to ### then bold bullets; to-dos and tasks `- [ ]` / `- [x]` with due, priority, status and
 * tags; notes `•` bullets with their body indented beneath; children indent two spaces per level, to any depth.
 */
export function toMarkdown(doc, rootId = null, { showDone = true } = {}) {
  const index = childrenIndex(doc);
  const lines = [];
  const skip = (n) => !showDone && isCheckable(n) && n.done;

  const renderBullets = (parentId, depth) => {
    for (const n of index.get(parentId) ?? []) {
      if (skip(n)) continue;
      const indent = '  '.repeat(depth);
      lines.push(`${indent}${bullet(n)}`);
      lines.push(...bodyLines(n, `${indent}  `));
      renderBullets(n.id, depth + 1);
    }
  };

  const renderSection = (parentId, level) => {
    const kids = (index.get(parentId) ?? []).filter((n) => !skip(n));
    const asHeading = (n) => n.kind === 'list' && level <= MAX_HEADING;
    const plain = kids.filter((n) => !asHeading(n));
    if (plain.length) {
      for (const n of plain) {
        lines.push(bullet(n));
        lines.push(...bodyLines(n, '  '));
        renderBullets(n.id, 1);
      }
      lines.push('');
    }
    for (const n of kids.filter(asHeading)) {
      lines.push(`${'#'.repeat(level)} ${n.title}${meta(n)}`, '');
      if (n.body) lines.push(...bodyLines(n, ''), '');
      renderSection(n.id, level + 1);
    }
  };

  if (rootId == null) {
    lines.push(`# ${doc.project ? `Todos · ${doc.project}` : 'Todos'}`, '');
    renderSection('', 2);
  } else {
    const root = node(doc, rootId);
    lines.push(`# ${root.title}${meta(root)}`, '');
    const crumbs = pathOf(doc, root.id);
    if (crumbs !== root.title) lines.push(`_${crumbs}_`, '');
    if (root.body) lines.push(...bodyLines(root, ''), '');
    renderSection(root.id, 2);
  }
  while (lines.length && lines.at(-1) === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

/** toJSON(doc, rootId | null) → { $axf, export: true, exportedAt, rootId, path, nodes: [root, descendants…] } in display order. */
export function toJSON(doc, rootId = null, now = Date.now()) {
  const index = childrenIndex(doc);
  const ids = rootId == null ? descendants({ nodes: doc.nodes }, '', index) : [node(doc, rootId).id, ...descendants(doc, rootId, index)];
  return {
    $axf: FORMAT,
    export: true,
    exportedAt: now,
    rootId: rootId == null ? null : String(rootId),
    path: rootId == null ? '' : pathOf(doc, rootId),
    count: ids.length,
    nodes: ids.map((id) => ({ ...doc.nodes[id] })),
  };
}

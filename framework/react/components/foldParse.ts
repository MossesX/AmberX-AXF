/**
 * The pure half of FoldSections (no React, no DOM): split a note or document into collapsible sections at its
 * Markdown headings and, optionally, its ALL-CAPS header lines; count what each section holds. Tested by
 * framework/spec/check-fold-sections.mts.
 */
export interface FoldSection {
  /** stable within one text: slug of the title + its position among same-titled siblings */
  id: string;
  title: string;
  /** 1–6 for Markdown headings, 7 for an ALL-CAPS line (always the innermost) */
  level: number;
  /** the text under the header, up to the next header of the same or a higher level */
  body: string;
  /** list items directly under the header (bullets, numbered, tasks), else its paragraphs, else its sub-sections */
  items: number;
}
export interface FoldSplit { intro: string; sections: FoldSection[] }
export interface FoldOptions { capsHeadings?: boolean }

const FENCE = /^\s*(```|~~~)/;
const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;

/**
 * An ALL-CAPS header line: the part before any `(` or `:` has at least three letters and no lower-case letter, the
 * line is short and isn't a list item, a quote, a table row or code. `JUST MERGED (Nov 4 afternoon)` → yes;
 * `NOV 4 (EARLIER)` → yes; `- MERGE QUEUE` → no (a bullet); `OK` → no (too short).
 */
export function isCapsHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120 || LIST_ITEM.test(t) || /^[>|#`]/.test(t)) return false;
  const head = (t.split(/[(:]/, 1)[0] ?? '').trim();
  const letters = head.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && !/\p{Ll}/u.test(head) && /\p{Lu}/u.test(head);
}

/** What a header line is: its level and title, or null for ordinary text. */
function headerOf(line: string, prevBlank: boolean, caps: boolean): { level: number; title: string } | null {
  const m = MD_HEADING.exec(line);
  if (m) return { level: (m[1] ?? '#').length, title: (m[2] ?? '').trim() };
  if (caps && prevBlank && isCapsHeading(line)) return { level: 7, title: line.trim().replace(/:$/, '') };
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';

/** How many things a section holds: its top-level list items, else its paragraphs. */
export function countItems(body: string): number {
  const lines = body.split('\n');
  let inFence = false; let items = 0; let paras = 0; let inPara = false;
  let base: number | null = null;
  for (const l of lines) {
    if (FENCE.test(l)) { inFence = !inFence; if (!inPara) { paras++; inPara = true; } continue; }
    if (inFence) continue;
    if (!l.trim()) { inPara = false; continue; }
    if (LIST_ITEM.test(l)) {
      const ind = l.length - l.trimStart().length;
      if (base === null || ind < base) base = ind;
      if (ind === base) items++;
      inPara = true; continue;
    }
    if (!inPara) { paras++; inPara = true; }
  }
  return items || paras;
}

/**
 * Split a text at its outer headers (an outline: a header belongs to the open header above it only when its level is
 * deeper): the text before the first header is the intro, never holding a header; each section's body keeps its
 * deeper headers (split it again to fold those too). Fenced code is never split.
 */
export function splitSections(text: string, opts: FoldOptions = {}): FoldSplit {
  const caps = opts.capsHeadings !== false;
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const heads: { at: number; level: number; title: string }[] = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (FENCE.test(l)) { inFence = !inFence; return; }
    if (inFence) return;
    const h = headerOf(l, i === 0 || !(lines[i - 1] ?? '').trim(), caps);
    // a caps line needs something under it before the next blank line or header, else it's just a shouted sentence
    if (h && h.level === 7 && !(lines[i + 1] ?? '').trim()) return;
    if (h) heads.push({ at: i, ...h });
  });
  if (!heads.length) return { intro: lines.join('\n').trim(), sections: [] };
  // an outline: a header nests under the open outer header when its level is deeper, else it starts a new outer one
  const outer: typeof heads = [];
  for (const h of heads) if (!outer.length || h.level <= (outer[outer.length - 1]?.level ?? 0)) outer.push(h);
  const seen = new Map<string, number>();
  const sections = outer.map((h, k) => {
    const end = outer[k + 1]?.at ?? lines.length;
    const body = lines.slice(h.at + 1, end).join('\n').replace(/^\n+|\s+$/g, '');
    const base = slug(h.title); const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    // a section counts what's directly under it; one that only holds sub-sections counts those
    const inner = splitSections(body, opts);
    const items = countItems(inner.intro) || inner.sections.length;
    return { id: n ? `${base}-${n + 1}` : base, title: h.title, level: h.level, body, items };
  });
  return { intro: lines.slice(0, outer[0]?.at ?? 0).join('\n').trim(), sections };
}

/** How many fold headers a text has at every depth (the Notes grid's "Sections" column). */
export function sectionCount(text: string, opts: FoldOptions = {}): number {
  const { sections } = splitSections(text, opts);
  return sections.reduce((n, s) => n + 1 + sectionCount(s.body, opts), 0);
}

/** The words of a search that a text is checked for (lower case, two letters or more). */
export const searchWords = (q: string | undefined) => String(q ?? '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
export const holds = (text: string, words: string[]) => { const t = text.toLowerCase(); return words.some((w) => t.includes(w)); };


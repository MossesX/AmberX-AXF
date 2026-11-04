/**
 * FoldSections — a note or document body as collapsible sections (Brett, Nov 4 2026, build notes-views). Markdown
 * headings (#, ##, ###…) and, optionally, ALL-CAPS lines that open a paragraph (`JUST MERGED (Nov 4 afternoon)`)
 * become fold headers with a chevron and an item count; the text under each one renders through <Markdown>. Deeper
 * headings fold inside their parent (a `###` inside a `##`, a caps line inside any Markdown heading).
 *
 * Expand all / Collapse all sit in a small toolbar over the sections. The fold state can be kept per device
 * (`storageKey`: localStorage), and search words (`highlight`) open every section that holds them and mark the hits
 * with the CSS Custom Highlight API (`::highlight(axf-fold-hit)`), so the rendered Markdown is never rewritten.
 *
 * Reusable by any app or plugin (console Notes, Plan Studio, MD Studio). Theme tokens only (`.fx-fold` in
 * framework/ui/axf.css); keyboard and screen readers: every header is a button with aria-expanded / aria-controls.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Markdown } from './Markdown';

import { holds, searchWords, splitSections } from './foldParse';
export { splitSections, sectionCount, countItems, isCapsHeading, searchWords, type FoldSection, type FoldSplit, type FoldOptions } from './foldParse';

/* ── fold memory (per device) ─────────────────────────────────────────────────────────────────────────────────── */

const FOLD_PREFIX = 'axf.fold:';
type FoldMemory = Record<string, boolean>; // section path → open
function readFolds(key: string | undefined): FoldMemory {
  if (!key) return {};
  try { const v = JSON.parse(localStorage.getItem(FOLD_PREFIX + key) ?? '{}'); return v && typeof v === 'object' ? v as FoldMemory : {}; } catch { return {}; }
}
function writeFolds(key: string | undefined, m: FoldMemory) {
  if (!key) return;
  try { if (Object.keys(m).length) localStorage.setItem(FOLD_PREFIX + key, JSON.stringify(m)); else localStorage.removeItem(FOLD_PREFIX + key); } catch { /* storage full or off: folds just aren't kept */ }
}

/* ── search hits (CSS Custom Highlight API; a no-op where the browser lacks it) ─────────────────────────────── */

const HIT = 'axf-fold-hit';
const hitRanges = new Map<object, Range[]>();
type HighlightApi = { highlights?: Map<string, unknown> }; type HighlightCtor = new (...r: Range[]) => unknown;
function paintHits() {
  const api = (globalThis as { CSS?: HighlightApi }).CSS; const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!api?.highlights || !Ctor) return;
  const all = [...hitRanges.values()].flat();
  if (all.length) api.highlights.set(HIT, new Ctor(...all)); else api.highlights.delete(HIT);
}
function markHits(owner: object, root: HTMLElement | null, words: string[]) {
  const ranges: Range[] = [];
  if (root && words.length && typeof document !== 'undefined') {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.nodeValue ?? '').toLowerCase();
      for (const w of words) for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + w.length)) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); ranges.push(r);
      }
    }
  }
  if (ranges.length) hitRanges.set(owner, ranges); else hitRanges.delete(owner);
  paintHits();
}

/* ── the component ─────────────────────────────────────────────────────────────────────────────────────────────── */

export interface FoldSectionsProps {
  text: string;
  /** ALL-CAPS lines that open a paragraph are headers too (default on) */
  capsHeadings?: boolean;
  /** sections start closed (default: open) */
  startCollapsed?: boolean;
  /** keep the fold state on this device under this key (e.g. `notes:<note id>`) */
  storageKey?: string;
  /** search text: sections holding any of its words open and the words are marked */
  highlight?: string;
  /** show the Expand all / Collapse all toolbar (default: when there are sections) */
  tools?: boolean;
  /** extra controls at the end of the toolbar */
  toolsExtra?: ReactNode;
  /** a label for the toolbar (screen readers + the toolbar's settings id) */
  label?: string;
  compact?: boolean;
  className?: string;
}

interface Ctl { open: (path: string) => boolean; set: (path: string, v: boolean) => void; caps: boolean; words: string[]; compact?: boolean }

function Level({ text, path, ctl }: { text: string; path: string; ctl: Ctl }) {
  const split = useMemo(() => splitSections(text, { capsHeadings: ctl.caps }), [text, ctl.caps]);
  const base = useId();
  if (!split.sections.length) return split.intro ? <Markdown text={split.intro} compact={ctl.compact} /> : null;
  return (
    <>
      {split.intro && <Markdown text={split.intro} compact={ctl.compact} />}
      {split.sections.map((s) => {
        const p = `${path}/${s.id}`;
        const hit = ctl.words.length > 0 && holds(`${s.title}\n${s.body}`, ctl.words);
        const open = hit || ctl.open(p);
        const bodyId = `${base}-${s.id}`;
        return (
          <section key={s.id} className={`fx-fold${open ? ' is-open' : ''}${hit ? ' is-hit' : ''}`} data-level={s.level}>
            <button type="button" className="fx-fold__head" aria-expanded={open} aria-controls={bodyId} onClick={() => ctl.set(p, !open)}>
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              <span className="fx-fold__title">{s.title}</span>
              {s.items > 0 && <span className="fx-fold__count" aria-label={`${s.items} ${s.items === 1 ? 'item' : 'items'}`}>{s.items}</span>}
            </button>
            {open && <div id={bodyId} className="fx-fold__body" role="region" aria-label={s.title}><Level text={s.body} path={p} ctl={ctl} /></div>}
          </section>
        );
      })}
    </>
  );
}

/** Every section path in a text (for Expand all / Collapse all). */
function allPaths(text: string, caps: boolean, path = ''): string[] {
  return splitSections(text, { capsHeadings: caps }).sections.flatMap((s) => [`${path}/${s.id}`, ...allPaths(s.body, caps, `${path}/${s.id}`)]);
}

export function FoldSections({ text, capsHeadings = true, startCollapsed = false, storageKey, highlight, tools, toolsExtra, label = 'Sections', compact, className }: FoldSectionsProps) {
  const [mem, setMem] = useState<FoldMemory>(() => readFolds(storageKey));
  useEffect(() => { setMem(readFolds(storageKey)); }, [storageKey]);
  const words = useMemo(() => searchWords(highlight), [highlight]);
  const paths = useMemo(() => allPaths(text, capsHeadings), [text, capsHeadings]);
  const save = (m: FoldMemory) => { setMem(m); writeFolds(storageKey, m); };
  const ctl: Ctl = {
    open: (p) => mem[p] ?? !startCollapsed,
    set: (p, v) => save({ ...mem, [p]: v }),
    caps: capsHeadings, words, compact,
  };
  const root = useRef<HTMLDivElement>(null);
  const owner = useRef({});
  useEffect(() => { markHits(owner.current, root.current, words); });
  useEffect(() => () => { hitRanges.delete(owner.current); paintHits(); }, []);
  const showTools = tools ?? paths.length > 0;
  return (
    <div ref={root} className={`fx-folds ${className ?? ''}`}>
      {showTools && (
        <div className="fx-folds__tools" role="toolbar" aria-label={label}>
          <span className="fx-folds__summary">{paths.length} {paths.length === 1 ? 'section' : 'sections'}</span>
          <button type="button" className="fx-toolbtn" disabled={!paths.length} onClick={() => save(Object.fromEntries(paths.map((p) => [p, true])))}><Icon name="chevron-down" size={12} />Expand all</button>
          <button type="button" className="fx-toolbtn" disabled={!paths.length} onClick={() => save(Object.fromEntries(paths.map((p) => [p, false])))}><Icon name="chevron-right" size={12} />Collapse all</button>
          {toolsExtra}
        </div>
      )}
      <Level text={text} path="" ctl={ctl} />
    </div>
  );
}

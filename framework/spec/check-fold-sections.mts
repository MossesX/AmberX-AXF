/**
 * FoldSections (framework/react/components/foldParse.ts): Markdown + ALL-CAPS headers, nesting, fenced code, item
 * counts, stable ids, search words. Test case: Amber's "Features that landed: Nov 3-4 2026" note (build notes-views).
 * Run: npx -y tsx framework/spec/check-fold-sections.mts
 */
import assert from 'node:assert/strict';
import { countItems, isCapsHeading, searchWords, sectionCount, splitSections } from '../react/components/foldParse';

const NOTE = [
  'Features merged to main in the last two days (MossesX/AmberX-AXF). Housekeeping PRs left out.',
  '',
  'JUST MERGED (Nov 4 afternoon, going live with the console deploy)',
  '- #320 Merge queue: conflicting PRs go straight to their queue run',
  '- #332 Maintenance plugin',
  '- #330 Console speed fix',
  '',
  'NOV 4 (EARLIER)',
  '- #296 Gizmo companion',
  '- #307 Expenses app ported',
  '',
  'OVERNIGHT BATCH (Nov 3-4)',
  '- #282 What Brett said',
].join('\n');

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; void name; };

t('caps lines', () => {
  assert.ok(isCapsHeading('JUST MERGED (Nov 4 afternoon, going live with the console deploy)'));
  assert.ok(isCapsHeading('NOV 4 (EARLIER)'));
  assert.ok(isCapsHeading('OVERNIGHT BATCH (Nov 3-4)'));
  assert.ok(isCapsHeading('TODO:'));
  assert.ok(!isCapsHeading('- MERGE QUEUE NOW'), 'a bullet is never a header');
  assert.ok(!isCapsHeading('OK'), 'too short');
  assert.ok(!isCapsHeading('Features merged to main'), 'mixed case');
  assert.ok(!isCapsHeading('> QUOTED LINE'));
  assert.ok(!isCapsHeading('| A | B |'));
});

t('the test note: three caps sections with counts', () => {
  const s = splitSections(NOTE);
  assert.equal(s.intro, 'Features merged to main in the last two days (MossesX/AmberX-AXF). Housekeeping PRs left out.');
  assert.deepEqual(s.sections.map((x) => x.title), ['JUST MERGED (Nov 4 afternoon, going live with the console deploy)', 'NOV 4 (EARLIER)', 'OVERNIGHT BATCH (Nov 3-4)']);
  assert.deepEqual(s.sections.map((x) => x.items), [3, 2, 1]);
  assert.deepEqual(s.sections.map((x) => x.level), [7, 7, 7]);
  assert.equal(s.sections[0].id, 'just-merged-nov-4-afternoon-going-live-with-the-console-depl', 'ids are slugs capped at 60');
  assert.equal(sectionCount(NOTE), 3);
});

t('caps detection off', () => {
  const s = splitSections(NOTE, { capsHeadings: false });
  assert.equal(s.sections.length, 0);
  assert.equal(s.intro, NOTE);
});

t('markdown headings nest; caps lines fold inside them', () => {
  const md = '# Title\nintro\n\n## One\n- a\n- b\n  - nested\n\nTWO PARTS\n- c\n\n### Deep\ntext\n\n## One\nagain';
  const s = splitSections(md);
  assert.equal(s.sections.length, 1, 'deeper headers stay inside their parent');
  assert.equal(s.sections[0].title, 'Title');
  const inner = splitSections(s.sections[0].body);
  assert.equal(inner.intro, 'intro');
  assert.deepEqual(inner.sections.map((x) => x.id), ['one', 'one-2'], 'same titles get distinct ids');
  assert.equal(inner.sections[0].items, 2, 'top-level list items only');
  const deeper = splitSections(inner.sections[0].body);
  assert.deepEqual(deeper.sections.map((x) => [x.title, x.level]), [['TWO PARTS', 7], ['Deep', 3]], 'a ### after a caps line is its sibling, not inside it');
  assert.equal(deeper.intro, '- a\n- b\n  - nested', 'the intro never holds a header');
  assert.equal(sectionCount(md), 1 + 2 + 1 + 1, 'Title, One, One, Deep, TWO PARTS');
});

t('fenced code is never split', () => {
  const md = 'Before\n\n```\n# not a heading\n\nLOUD LINE\nx\n```\n\n## Real\nbody';
  const s = splitSections(md);
  assert.deepEqual(s.sections.map((x) => x.title), ['Real']);
  assert.ok(s.intro.includes('# not a heading'));
});

t('a lone caps sentence with nothing under it stays text', () => {
  assert.equal(splitSections('Hello\n\nDONE\n\nmore').sections.length, 0);
});

t('counts fall back to paragraphs', () => {
  assert.equal(countItems('one\ntwo\n\nthree'), 2);
  assert.equal(countItems(''), 0);
  assert.equal(countItems('1. a\n2. b\n3) c'), 3);
});

t('search words', () => {
  assert.deepEqual(searchWords('  Gizmo  a  EXPENSES '), ['gizmo', 'expenses']);
  assert.deepEqual(searchWords(undefined), []);
});

console.log(`✓ fold sections: ${n} checks passed`);

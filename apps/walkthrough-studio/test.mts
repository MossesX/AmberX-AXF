/**
 * Walkthrough Studio self-test: the pure model + compiler (no browser).  npx -y tsx test.mts
 */
import { seedProject } from './src/studio/seed';
import { addPiece, duplicateProject, estimateSec, findSection, fmtDur, moveItem, newPiece, normalizeProject, orderedPieces, parseDur, piecesUnder, restoreTrash, sectionOfPiece, totals, trashItem, updatePiece } from './src/studio/model';
import { at, compile, toEdl, toScript, toShotList, toSrt, toVtt, toClaudeBrief } from './src/studio/compiler';

let n = 0, bad = 0;
const ok = (c: unknown, what: string) => { n++; if (!c) { bad++; console.log(`✗ ${what}`); } };

const p = seedProject();
const ids = Object.keys(p.pieces);
ok(ids.length > 90, `seed has every area (${ids.length} pieces)`);
ok(p.root.children.length >= 12, 'seed has top-level chapters');
ok(orderedPieces(p).length === ids.length, 'every piece is in the outline once');
ok(new Set(piecesUnder(p.root)).size === ids.length, 'no piece listed twice');
ok(orderedPieces(p).every((x) => x.narration.length > 40), 'every seed piece has narration');

ok(parseDur('1:30') === 90 && parseDur('90') === 90 && parseDur('1m30s') === 90 && parseDur('2h') === 7200 && parseDur('') === 0 && parseDur('no limit') === 0, 'parseDur');
ok(fmtDur(3725) === '1:02:05' && fmtDur(65) === '1:05', 'fmtDur');

// move: a piece after another in a different section
const [a, b] = [orderedPieces(p)[0]!, orderedPieces(p)[10]!];
const m1 = moveItem(p, { kind: 'piece', id: a.id }, { kind: 'piece', id: b.id }, 'after');
const sec = sectionOfPiece(m1.root, b.id)!;
ok(sec.pieces.indexOf(a.id) === sec.pieces.indexOf(b.id) + 1, 'move piece after another');
ok(orderedPieces(m1).length === ids.length, 'move keeps every piece');
// a section can't move into itself
const top = p.root.children[1]!;
const sub = top.children[0] ?? top;
ok(moveItem(p, { kind: 'section', id: top.id }, { kind: 'section', id: sub.id }, 'inside') === p || sub === top, 'section never moves into itself');
// section into another
const m2 = moveItem(p, { kind: 'section', id: p.root.children[0]!.id }, { kind: 'section', id: p.root.children[2]!.id }, 'inside');
ok(findSection(m2.root, p.root.children[2]!.id)!.children.some((c) => c.id === p.root.children[0]!.id), 'section dropped inside another');

// trash + restore
const t1 = trashItem(p, { kind: 'piece', id: a.id });
ok(!t1.pieces[a.id] && t1.trash.length === 1, 'piece goes to the trash');
const r1 = restoreTrash(t1, 0);
ok(!!r1.pieces[a.id] && r1.trash.length === 0 && orderedPieces(r1)[0]!.id === a.id, 'restore puts it back where it was');
const t2 = trashItem(p, { kind: 'section', id: top.id });
ok(Object.keys(t2.pieces).length === ids.length - piecesUnder(top).length, 'a section takes its pieces to the trash');
ok(Object.keys(restoreTrash(t2, 0).pieces).length === ids.length, 'and brings them back');

// compile
const c1 = compile(p);
ok(c1.segments.filter((s) => s.kind === 'piece').length === ids.length, 'one segment per piece');
ok(c1.segments.filter((s) => s.kind === 'chapter').length === p.root.children.length, 'a chapter card per top-level section');
ok(c1.segments.every((s, i, l) => i === 0 || s.start >= l[i - 1]!.end - 1e-6), 'segments in order, no overlap');
ok(c1.rebuilt === ids.length && c1.reused === 0, 'first compile builds everything');
const c2 = compile(p, c1.hashes);
ok(c2.reused === ids.length && c2.rebuilt === 0, 'unchanged recompile reuses everything');
const edited = updatePiece(p, b.id, { narration: b.narration + ' One more sentence.' });
const c3 = compile(edited, c1.hashes);
ok(c3.rebuilt === 1, 'editing one piece rebuilds one segment');
const swapped = compile(m1, c1.hashes);
ok(swapped.rebuilt === 0, 'swapping pieces reuses every segment');
const seg = c1.segments.find((s) => s.pieceId === b.id)!;
ok(seg.lines.length > 0 && Math.abs(seg.lines[seg.lines.length - 1]!.end - (seg.start + seg.lines.reduce((x, l) => x + l.end - l.start, 0))) < 0.01, 'caption lines cover the narration');
ok(at(c1, seg.start + 0.1).seg?.id === seg.id, 'at() finds the playing segment');
const skip = updatePiece(p, a.id, { status: 'skipped' });
ok(compile(skip).skipped.some((x) => x.id === a.id), 'skipped pieces are left out');
const target = { ...p, settings: { ...p.settings, targetSec: 60 } };
ok(compile(target).warnings.some((w) => w.includes('over the')), 'over the target length warns');

// exports
ok(toSrt(c1).startsWith('1\n00:00:00,000 --> '), 'SRT');
ok(toVtt(c1).startsWith('WEBVTT'), 'WebVTT');
ok(toScript(c1, p).includes('## Engines'), 'script has chapters');
ok(toShotList(c1).split('\n').length === c1.segments.length + 1, 'shot list has a row per segment');
ok(toEdl(c1).startsWith('TITLE:'), 'EDL');
ok(JSON.parse(toClaudeBrief(c1, p).slice(toClaudeBrief(c1, p).indexOf('\n{') + 1)).segments.length === c1.segments.length, 'Claude brief carries every segment');

// lengths
const empty = newPiece();
ok(estimateSec(empty, p.settings) === p.settings.pieceTargetSec, 'an empty piece estimates its target');
ok(totals(p).est > 600, 'seed runs over ten minutes');
const withPiece = addPiece(p, top.id, empty);
ok(sectionOfPiece(withPiece.root, empty.id)?.id === top.id, 'add a piece to a section');

// round trip
const again = normalizeProject(JSON.parse(JSON.stringify(p)));
ok(orderedPieces(again).length === ids.length, 'project survives JSON');
const dup = duplicateProject(p);
ok(dup.id !== p.id && Object.keys(dup.pieces).length === ids.length, 'duplicate project');
let threw = false; try { normalizeProject({ nope: 1 }); } catch { threw = true; }
ok(threw, 'normalize refuses something that is not a project');

console.log(`${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);

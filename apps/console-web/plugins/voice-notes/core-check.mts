/** Pure-model checks for the Voice notes plugin (run by test.py through tsx). Prints one JSON line. */
import * as c from './web/core';

const s = c.normalizeSettings({});
const lists: c.NoteList[] = [
  { ...c.newList([], 'Groceries'), id: 'g', number: 1, aliases: ['shopping'], subcategories: [{ id: 'dairy', number: 1, name: 'Dairy', aliases: ['milk stuff'] }, { id: 'veg', number: 2, name: 'Vegetables', aliases: [] }], askSubcategory: true,
    questionSets: [{ id: 'a', label: 'Always', trigger: { kind: 'always' }, subcategory: '', questions: [{ id: 'q1', ask: 'Which store?', field: 'store' }] }, { id: 'b', label: 'Urgent', trigger: { kind: 'phrase', phrase: 'urgent' }, subcategory: 'veg', questions: [] }, { id: 'n', label: 'Three', trigger: { kind: 'number', number: 3 }, subcategory: '', questions: [] }] },
  { ...c.newList([], 'Work ideas'), id: 'w', number: 2 },
  { ...c.newList([], 'Dentist'), id: 'd', number: 12 },
];
const out = {
  defaults: s.startTriggers.length > 0 && s.stopTriggers.length > 0 && s.beep.on,
  clamps: (() => { const x = c.normalizeSettings({ beep: { hz: 99999, ms: -4, volume: 3 }, maxSeconds: 'x', language: 'bad lang!' }); return x.beep.hz === 4000 && x.beep.ms === 40 && x.beep.volume === 1 && x.maxSeconds === 120 && x.language === 'en-US'; })(),
  dedupe: c.phrases(['Stop note', 'stop  note!', '', 'end'], []).join('|'),
  strip: c.stripStopTrigger('Buy milk and eggs. Stop note', s.stopTriggers),
  stripMid: c.stripStopTrigger('remember the stop note thing end note', s.stopTriggers).text,
  stripNone: c.stripStopTrigger('no trigger here', s.stopTriggers).cut,
  numbers: ['3', 'three', 'number twelve', 'twenty one', 'the second one', 'list 7', 'nothing'].map(c.spokenNumber),
  pickNum: c.pickList('number two', lists)?.id,
  pickName: c.pickList('put it in shopping', lists)?.id,
  pickTwelve: c.pickList('twelve', lists)?.id,
  pickNone: c.pickList('the moon', lists),
  asks: c.asksForLists('ok give me the list of lists please', s),
  cancel: c.isCancel('never mind', s),
  sub: c.pickSubcategory('two', lists[0]!)?.id,
  subAlias: c.pickSubcategory('milk stuff', lists[0]!)?.id,
  setPhrase: c.pickQuestionSet('this is urgent', lists[0]!)?.id,
  setNumber: c.pickQuestionSet('three', lists[0]!)?.id,
  setAlways: c.pickQuestionSet('whatever', lists[0]!)?.id,
  read: c.readLists(s, lists),
  problemsOk: c.problems(s, lists),
  problemsBad: c.problems(c.normalizeSettings({ startTriggers: [], stopTriggers: ['cancel'] }), [...lists, { ...c.newList([], ''), id: 'x', number: 1 }]),
  newNumber: c.newList(lists).number,
  roundTrip: JSON.stringify(c.normalizeList(JSON.parse(JSON.stringify(lists[0])), 'g')) === JSON.stringify(lists[0]),
  badRow: c.normalizeList('nope'),
  preview: c.conversationPreview(s, lists).map((x) => x.text),
};
console.log(JSON.stringify(out));

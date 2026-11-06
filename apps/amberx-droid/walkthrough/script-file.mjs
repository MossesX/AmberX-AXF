// A walkthrough written as data (walkthrough-video@1, data form): what the console's Build docs plugin plans for a
// build's walkthrough video. Chapters → scenes { say, do: [{ op, … }] }; each op is one recorder helper (record.mjs)
// with plain arguments, so a script from a model or a hand edit can't run code here. Read from $OUT/script.input.json
// when WALKTHROUGH is not one of the scripts in load.mjs.
import { readFileSync } from 'node:fs';
import { walkthroughErrors as baseErrors } from './script.mjs';

/** op → the helper call (h = record.mjs helpers). Unknown ops are skipped, never run. */
const OPS = {
  open: (h, a) => h.open(a.url),
  // a page of the app: its runtime's navigate when it has one (the console's nav is a menu), else nav link / search
  view: async (h, a) => { if (!(await h.navigate?.(a.name))) await h.view(a.name, a.label); },
  hl: (h, a) => h.hl(a.sel, a.label),
  click: (h, a) => h.click(a.sel, a.label),
  scroll: (h, a) => h.scroll(Number(a.dy) || 0),
  wait: (h, a) => h.wait(Math.min(15000, Math.max(0, Number(a.ms) || 0))),
  go: (h, a) => h.go(a.title),
  calm: (h) => h.calm(),
  card: (h, a) => h.card?.(a.title, a.sub),
  settings: async (h, a) => { if (!(await h.dispatch?.(`settings.open:${a.sub || a.tab}`))) await h.settings(a.tab, a.sub); },
  menu: (h, a) => h.menu(a.top),
  dialog: (h, a) => h.dialog?.(a.id),
};
export const SCRIPT_OPS = Object.keys(OPS);

/** One scene's moves as the act function record.mjs runs; a card stays up only while the scene's moves are cards. */
export function actOf(moves) {
  const list = (Array.isArray(moves) ? moves : []).filter((m) => m && OPS[m.op]);
  return async (h) => {
    if (!list.length) { await h.uncard?.(); await h.wait(400); return; }
    for (const m of list) {
      if (m.op !== 'card' && m.op !== 'wait') await h.uncard?.();
      await OPS[m.op](h, m);
    }
  };
}

/** The script file → { WALKTHROUGH, CHAPTERS, walkthroughErrors } like script.mjs exports. */
export function fromData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const WALKTHROUGH = {
    $axf: 'walkthrough-video@1', id: String(d.id || 'build'), title: String(d.title || 'Walkthrough'), app: String(d.app || 'console-web'),
    url: String(d.url || 'https://console.amberxai.com/'), device: d.device === 'phone' ? 'phone' : 'desktop',
    viewport: d.viewport ?? { width: 412, height: 915 }, desktop: d.desktop ?? { width: 1920, height: 1080 },
    output: d.output ?? { width: 1920, height: 1080, crf: 26, preset: 'veryfast' }, downloads: [],
    voice: String(d.voice || 'en_US-kristin-medium'), speed: Number(d.speed) || 1,
    narration: d.narration !== false, captions: d.captions === true,
  };
  const CHAPTERS = (Array.isArray(d.chapters) ? d.chapters : []).map((c) => ({
    id: String(c.id), title: String(c.title || c.id), device: c.device === 'phone' ? 'phone' : WALKTHROUGH.device,
    ...(c.url ? { url: String(c.url) } : {}),
    scenes: (Array.isArray(c.scenes) ? c.scenes : []).map((s) => ({ say: String(s.say ?? ''), act: actOf(s.do) })),
  }));
  // the base checks, with the build's own moves in place of hand-written functions
  const walkthroughErrors = (meta = WALKTHROUGH, chapters = CHAPTERS) => baseErrors(meta, chapters);
  return { WALKTHROUGH, CHAPTERS, walkthroughErrors };
}

export function loadScriptFile(path) {
  return fromData(JSON.parse(readFileSync(path, 'utf8')));
}

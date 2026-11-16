// One video of the series as a recordable walkthrough (walkthrough-video@1), so the recorder, Piper, the assembler and
// the player of ../ record it like any other walkthrough. Each video is its own walkthrough id and is recorded on its own:
//   series-<video id>      the full video          (WALKTHROUGH=series-voice-control bash ../rebuild.sh)
//   series-<video id>-60   its 60-second cut, for the videos that have one
// A chapter is split where the device changes (a phone scene inside a desktop video): every recorded piece is one page
// on one device, and the assembler fits them all into the video's frame (16:9 for desktop videos, 9:16 for phone ones).
import { SERIES, VIDEOS } from './scripts.mjs';
import { MORE } from './more/index.mjs';
import { APPS, deviceOf, planOf } from './acts.mjs';
import { walkthroughErrors as baseErrors } from '../script.mjs';

export const ALL = [...VIDEOS, ...MORE];
export const PREFIX = 'series-';
export const SHORT = '-60';

/** Every walkthrough id the series records: full videos, then the 60-second cuts. */
export function seriesIds() {
  return [...ALL.map((v) => `${PREFIX}${v.id}`), ...ALL.filter((v) => v.short).map((v) => `${PREFIX}${v.id}${SHORT}`)];
}

/** { video, cut } for a walkthrough id, or null. */
export function resolveId(id) {
  if (!id?.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const full = ALL.find((v) => v.id === rest);
  if (full) return { video: full, cut: 'full' };
  const short = rest.endsWith(SHORT) && ALL.find((v) => v.id === rest.slice(0, -SHORT.length) && v.short);
  return short ? { video: short, cut: 'short' } : null;
}

/** The chapters of a cut as scripts.mjs writes them (the 60-second cut is one chapter). */
function sourceChapters(video, cut) {
  if (cut === 'short') return [{ id: 'short', title: video.short.title ?? `${video.title} (60 seconds)`, scenes: video.short.scenes }];
  return video.chapters;
}

/** Open the scene's app first when the page shows another one (a desktop chapter can move from console to axHub). */
const onApp = (app, act) => async (h) => { if (APPS[app]?.url) await h.app(APPS[app].url); await act(h); };

/** The walkthrough for one series id: { WALKTHROUGH, CHAPTERS, walkthroughErrors }. */
export function seriesWalkthrough(id) {
  const r = resolveId(id);
  if (!r) throw new Error(`no series video "${id}"`);
  const { video, cut } = r;
  const phone = video.viewport === 'phone';
  const home = APPS[video.app]?.url ?? APPS['console-web'].url;
  const CHAPTERS = [];
  for (const c of sourceChapters(video, cut)) {
    let piece = null;
    let device = phone ? 'phone' : 'desktop';
    c.scenes.forEach((s, i) => {
      const plan = planOf(video, s, `${c.id}-${i}`);
      const d = deviceOf(plan) ?? device;
      if (!piece || d !== piece.device) {
        const n = CHAPTERS.filter((x) => x.source === c.id).length;
        piece = { id: n ? `${c.id}-p${n + 1}` : c.id, title: c.title, source: c.id, device: d, url: APPS[plan.app]?.device === d && APPS[plan.app]?.url ? APPS[plan.app].url : d === 'phone' ? APPS['amberx-droid'].url : home, scenes: [] };
        CHAPTERS.push(piece);
      }
      device = d;
      piece.scenes.push({ say: s.say, shot: s.shot, staged: !!s.staged, plan: plan.kind, act: plan.kind === 'route' || plan.kind === 'act' ? onApp(plan.app, plan.act) : plan.act });
    });
  }
  const WALKTHROUGH = {
    $axf: 'walkthrough-video@1',
    id,
    title: cut === 'short' ? (video.short.title ?? `${video.title} (60 seconds)`) : video.title,
    series: SERIES.id,
    video: video.id,
    cut,
    skin: video.skin,
    app: video.app,
    url: home,
    device: phone ? 'phone' : 'desktop',
    viewport: SERIES.viewport.phone,
    desktop: SERIES.viewport.desktop,
    output: phone ? { width: 1080, height: 1920, crf: 24, preset: 'veryfast' } : { width: 1920, height: 1080, crf: 24, preset: 'veryfast' },
    downloads: [720],
    socials: true,
    voice: SERIES.voice,
    speed: 1,
  };
  return { WALKTHROUGH, CHAPTERS, walkthroughErrors: seriesErrors };
}

/** The walkthrough checks, plus: every piece has a device and starting url. */
export function seriesErrors(meta, chapters) {
  const errors = baseErrors(meta, chapters);
  for (const c of chapters ?? []) {
    if (!['phone', 'desktop'].includes(c.device)) errors.push(`${c.id}: no device`);
    if (!c.url) errors.push(`${c.id}: no starting url`);
  }
  return errors;
}

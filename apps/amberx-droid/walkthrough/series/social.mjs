// MP4 exports for socials (step s4): the assembled video re-framed for each feed, captions burned in (feeds autoplay
// muted), H.264 + AAC with faststart. Runs where ffmpeg is (the recorder image): assemble.mjs calls it for walkthroughs
// that ask for `socials`, or on its own to re-export without re-recording:
//   OUT=/out node series/social.mjs            (inside the recorder image; series/publish.sh does this)
// Writes $OUT/publish/walkthrough-social-<format>.mp4 and returns them as download rows for chapters.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

/** The feeds' frames. The picture is fitted whole over a blurred, filled copy of itself, so nothing is cropped away. */
export const SOCIAL_FORMATS = [
  { id: '9x16', label: 'Reels 9:16', width: 1080, height: 1920 },
  { id: '1x1', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: '16x9', label: 'Wide 16:9', width: 1920, height: 1080 },
];
export const socialFile = (id) => `walkthrough-social-${id}.mp4`;

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

/** Make every format from pub/walkthrough.mp4 + walkthrough.vtt; returns [{ file, label, height, bytes, social }]. */
export function exportSocials(pub, formats = SOCIAL_FORMATS) {
  const src = `${pub}/walkthrough.mp4`;
  const vtt = `${pub}/walkthrough.vtt`;
  const out = [];
  for (const f of formats) {
    const file = socialFile(f.id);
    // Captions about 1/18 of the frame's short side, kept clear of the feeds' own bottom bar (more room on 9:16). libass
    // draws a .vtt on a 288-line canvas, so sizes and margins are given in its units.
    const unit = 288 / f.height;
    const size = Math.round((Math.min(f.width, f.height) / 18) * unit);
    const margin = Math.round((f.height > f.width ? f.height / 7 : f.height / 14) * unit);
    const subs = existsSync(vtt) ? `,subtitles=${vtt}:force_style='Fontsize=${size},Outline=1,Shadow=0,MarginV=${margin},MarginL=10,MarginR=10,Alignment=2'` : '';
    const graph = `[0:v]split[a][b];[a]scale=${f.width}:${f.height}:force_original_aspect_ratio=increase,crop=${f.width}:${f.height},boxblur=24:2[bg];` +
      `[b]scale=${f.width}:${f.height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2${subs},format=yuv420p[v]`;
    ff(['-i', src, '-filter_complex', graph, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${pub}/${file}`]);
    out.push({ file, label: f.label, height: f.height, bytes: statSync(`${pub}/${file}`).size, social: f.id });
  }
  return out;
}

/** chapters.json with the social rows in its downloads (old social rows replaced). */
export function withSocials(index, rows) {
  const keep = (index.downloads ?? []).filter((d) => !d.social);
  return { ...index, downloads: [...keep, ...rows] };
}

if (process.argv[1]?.endsWith('social.mjs')) {
  const pub = `${process.env.OUT || '/out'}/publish`;
  const rows = exportSocials(pub);
  let ix = JSON.parse(readFileSync(`${pub}/chapters.json`, 'utf8'));
  // a video assembled before the series fields existed gets them from its walkthrough (WALKTHROUGH=series-<id>)
  if (process.env.WALKTHROUGH?.startsWith('series-')) {
    const { seriesWalkthrough } = await import('./walkthrough.mjs');
    const w = seriesWalkthrough(process.env.WALKTHROUGH).WALKTHROUGH;
    ix = { ...ix, series: w.series, video: w.video, cut: w.cut, skin: w.skin };
  }
  writeFileSync(`${pub}/chapters.json`, JSON.stringify(withSocials(ix, rows), null, 1));
  console.log(`socials: ${rows.map((r) => `${r.social} ${(r.bytes / 1e6).toFixed(1)} MB`).join(', ')}`);
}

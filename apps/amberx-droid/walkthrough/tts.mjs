// Amber's voice: every scene's narration through Piper (voice model in /voice, see rebuild.sh), one clip per scene,
// and each clip's length for the recorder's timing. A clip whose words, voice and speed haven't changed is kept (hash
// in its name), so an edited line in AmberX re-voices only that scene.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { loadWalkthrough } from './load.mjs';

const OUT = process.env.OUT || '/out';
const { CHAPTERS, WALKTHROUGH } = await loadWalkthrough();
const VOICE = process.env.VOICE_MODEL || `/voice/${WALKTHROUGH.voice}.onnx`;
mkdirSync(`${OUT}/audio/cache`, { recursive: true });
const durations = {};
let made = 0;
for (const ch of CHAPTERS) {
  ch.scenes.forEach((s, i) => {
    const hash = createHash('sha1').update(`${WALKTHROUGH.voice}|${WALKTHROUGH.speed === 1 ? '' : WALKTHROUGH.speed}|${s.say}`).digest('hex').slice(0, 12);
    const cached = `${OUT}/audio/cache/${hash}.wav`;
    if (!existsSync(cached)) {
      execFileSync('/opt/piper/piper', ['--model', VOICE, '--output_file', cached, '--sentence_silence', '0.3', '--length_scale', (0.97 / WALKTHROUGH.speed).toFixed(3)], { input: s.say, stdio: ['pipe', 'ignore', 'ignore'] });
      made++;
    }
    const wav = `${OUT}/audio/${ch.id}-${i}.wav`;
    copyFileSync(cached, wav);
    durations[`${ch.id}-${i}`] = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
  });
}
writeFileSync(`${OUT}/durations.json`, JSON.stringify(durations, null, 1));
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`tts: ${Object.keys(durations).length} clips (${made} new), ${(total / 60).toFixed(1)} min of speech`);

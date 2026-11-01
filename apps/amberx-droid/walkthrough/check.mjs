// Checks for the AmberX walkthrough (walkthrough-video@1).
//   node apps/amberx-droid/walkthrough/check.mjs              the script: chapters, scenes, clean narration
//   node apps/amberx-droid/walkthrough/check.mjs --scan DIR   a recording: every scene's visible text (DIR/texts) and the
//                                                             captions are free of key-like strings, the demo user only
// Exit 1 on any problem. Used by rebuild.sh (before recording, and before publishing) and test.mjs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { CHAPTERS, WALKTHROUGH, walkthroughErrors } from './script.mjs';

/** Things that look like secrets: provider keys, GitHub / Slack / AWS tokens, JWTs, private keys, long random strings. */
export const SECRET_PATTERNS = [
  ['provider key', /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{16,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['password in text', /\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/i],
  ['long random string', /\b(?=[A-Za-z0-9+/_-]*[0-9])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])[A-Za-z0-9+/_-]{32,}\b/],
];

export function findSecrets(text) {
  const hits = [];
  for (const [name, re] of SECRET_PATTERNS) {
    const m = String(text).match(re);
    if (m) hits.push({ name, sample: `${m[0].slice(0, 4)}…(${m[0].length} chars)` });
  }
  return hits;
}

export function scanRecording(dir, extraForbidden = []) {
  const problems = [];
  const texts = `${dir}/texts`;
  if (!existsSync(texts)) return [`no texts/ in ${dir}: record first`];
  const files = readdirSync(texts).filter((f) => f.endsWith('.txt'));
  if (!files.length) problems.push('no scene texts were saved');
  const vtt = `${dir}/publish/walkthrough.vtt`;
  for (const [name, body] of [...files.map((f) => [f, readFileSync(`${texts}/${f}`, 'utf8')]), ...(existsSync(vtt) ? [['walkthrough.vtt', readFileSync(vtt, 'utf8')]] : [])]) {
    for (const h of findSecrets(body)) problems.push(`${name}: ${h.name} ${h.sample}`);
    for (const w of extraForbidden) if (w && body.includes(w)) problems.push(`${name}: shows "${w.slice(0, 2)}…" (a real name or value that must not be on screen)`);
  }
  return problems;
}

if (process.argv[1]?.endsWith('check.mjs')) {
  const i = process.argv.indexOf('--scan');
  if (i > 0) {
    const dir = process.argv[i + 1] || '/opt/amberx-walkthrough-rec';
    // the recorder account's name and any value in its env file never belong on screen
    const forbidden = (process.env.WALKTHROUGH_FORBIDDEN || '').split(',').map((s) => s.trim()).filter((s) => s.length >= 4);
    const env = process.env.AMBERX_WALKTHROUGH_ENV || '/root/.tour-recorder.env';
    try { for (const l of readFileSync(env, 'utf8').split('\n')) { const v = l.split('=').slice(1).join('=').trim(); if (v.length >= 6) forbidden.push(v); } } catch { /* not on this machine */ }
    const p = scanRecording(dir, forbidden);
    if (p.length) { console.error(`secrets scan: ${p.length} problem(s)\n  ${p.join('\n  ')}`); process.exit(1); }
    console.log(`secrets scan: clean (${readdirSync(`${dir}/texts`).length} scene texts + captions)`);
  } else {
    const e = walkthroughErrors(WALKTHROUGH, CHAPTERS);
    if (e.length) { console.error(`walkthrough script: ${e.length} problem(s)\n  ${e.join('\n  ')}`); process.exit(1); }
    const words = CHAPTERS.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.say.split(/\s+/).length, 0), 0);
    console.log(`walkthrough script: ${CHAPTERS.length} chapters, ${CHAPTERS.reduce((n, c) => n + c.scenes.length, 0)} scenes, ${words} words (~${Math.round(words / 150)} min of narration)`);
  }
}

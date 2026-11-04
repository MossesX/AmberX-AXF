/** Web core self-test: npx -y tsx apps/console-web/plugins/live-sessions/web/core-check.mts */
import { NO_FILTERS, clock, dur, filterRows, nextSpeech, partAt, paintWidget, tokensAt, upTo, widgetAsset, type Row } from './core';

let n = 0;
const ok = (c: unknown, m: string) => { if (!c) throw new Error(`check failed: ${m}`); n++; };
const row = (p: Partial<Row>): Row => ({ id: 'x', kind: 'human', client: 'code', mode: 'text', account: 'main', primary: true, device: 'VPS', app: 'Claude Code', title: '', doing: '', build: '', step: '', progress: null, model: '', thinking: '', agent: { id: 'paulie', name: 'Ping Paulie', title: '', avatar: null, known: true }, startedAt: 0, lastAt: 0, costUsd: null, status: 'live', voice: { ok: false, why: '' }, recording: true, watchers: [], notice: { watched: false, recording: true, text: 'Recording', by: [] }, source: '', url: '', ...p });
const rows = [row({ id: 'a' }), row({ id: 'b', kind: 'headless', agent: { id: 'sully', name: 'Snap Sully', title: '', avatar: null, known: true } }), row({ id: 'c', status: 'ended', account: 'helper-2' })];
ok(filterRows(rows, NO_FILTERS).map((r) => r.id).join() === 'a,b', 'ended hidden');
ok(filterRows(rows, { ...NO_FILTERS, kind: 'headless' }).map((r) => r.id).join() === 'b', 'kind');
ok(filterRows(rows, { ...NO_FILTERS, ended: true, account: 'helper-2' }).map((r) => r.id).join() === 'c', 'account');
ok(filterRows(rows, { ...NO_FILTERS, agent: 'Snap Sully' }).map((r) => r.id).join() === 'b', 'agent');
ok(clock(3_723_000) === '1:02:03' && clock(65_000) === '1:05' && dur(4000) === '4s' && dur(3_900_000) === '1h 05m', 'clocks');
const evs = [{ seq: 0, t: 0, atMs: 0, kind: 'user' }, { seq: 1, t: 500, atMs: 0, kind: 'assistant' }, { seq: 2, t: 900, atMs: 0, kind: 'tool' }];
ok(upTo(evs, 600).length === 2 && upTo(evs, -1).length === 0 && upTo(evs, 900).length === 3, 'upTo');
ok(tokensAt({ durationMs: 0, markers: [], speech: [], silenceMs: 0, context: [{ t: 0, seq: 0, tokens: 10 }, { t: 500, seq: 1, tokens: 30 }] }, 499) === 10, 'tokensAt');
const sp = [{ track: 'mic', from: 100, to: 200 }, { track: 'tts', from: 500, to: 600 }];
ok(nextSpeech(sp, 150) === 150 && nextSpeech(sp, 250) === 500 && nextSpeech(sp, 700) === 700, 'skip silence');
const parts = [{ track: 'mic' as const, startMs: 100, endMs: 200, file: 'm', bytes: 1 }, { track: 'tts' as const, startMs: 500, endMs: null, file: 't', bytes: 1 }];
ok(partAt(parts, 'mic', 150, () => 0)?.offsetMs === 50 && partAt(parts, 'mic', 300, () => 0) === null && partAt(parts, 'tts', 550, () => 100)?.part.file === 't', 'partAt');
ok(widgetAsset({ human: 2, headless: 4, total: 6, label: '2 human · 4 headless', watched: 0 }).data.onLabel === '2 human · 4 headless', 'widget label');
const calls: string[] = [];
paintWidget({ registry: { register: () => calls.push('reg') }, setBadge: (k, v) => calls.push(`${k}=${v}`), attachToBanner: () => calls.push('attach'), detachFromBanner: () => calls.push('detach') }, { human: 1, headless: 0, total: 1, label: '1 human', watched: 1 }, true);
ok(calls.join() === 'reg,live.sessions.human=1,live.sessions.headless=0,live.sessions.watched=1,attach', 'paint widget');
console.log(`live-sessions web core: ${n} checks ok`);

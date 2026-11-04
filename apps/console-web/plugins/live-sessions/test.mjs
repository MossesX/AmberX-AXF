#!/usr/bin/env node
/** Hook + web core self-test: node apps/console-web/plugins/live-sessions/test.mjs (no network, no model). */
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newLines } from './live.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const f = join(mkdtempSync(join(tmpdir(), 'axf-live-')), 't.jsonl');
const L = (o) => JSON.stringify(o) + '\n';
writeFileSync(f, L({ type: 'user', entrypoint: 'cli', message: { content: 'hi' } }) + L({ type: 'api-request-blob', message: 'big' }) + L({ type: 'assistant', message: { content: [] } }) + '{"type":"user","mess');
let r = newLines(f, 0);
ok(r.lines.length === 2 && r.entrypoint === 'cli', 'keeps user/assistant, skips blobs and the half line');
appendFileSync(f, 'age":{"content":"x"}}\n' + L({ type: 'user', isSidechain: true, message: { content: 'sub' } }));
const r2 = newLines(f, r.offset);
ok(r2.lines.length === 1 && JSON.parse(r2.lines[0]).message.content === 'x', 'continues from the offset, skips side chains');
ok(newLines(f, r2.offset).lines.length === 0, 'nothing new');
ok(newLines('/nope', 5).offset === 5, 'missing file');
console.log(`live-sessions hook: ${n} checks ok`);

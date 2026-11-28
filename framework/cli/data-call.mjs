#!/usr/bin/env node
/**
 * data-call — one data-store@1 call from a synchronous caller (builds-store.mjs and other sync code paths that must
 * reach axf-data in cutover mode). framework/core/data-files.mjs `callSync()` runs this with the request on stdin and
 * reads one JSON answer from stdout:
 *
 *   { op: 'get' | 'put' | 'patch' | 'item' | 'summary' | 'append' | 'read' | 'list' | 'delete' | 'health', key | ns, data?, body?, ifMatch?, create?, entries?, idem?, since?, prefix? }
 *   → { ok: true, result } | { ok: false, code, message, rev?, etag? }
 *
 * The client is framework/core/data-store.mjs over httpBackend (AXF_DATA_URL, AXF_DATA_TOKEN), with its retries.
 */
import { DataStoreError } from '../core/data-store.mjs';
import { remoteStore } from '../core/data-files.mjs';
import { readText } from '../core/clip.mjs';

// decoded once: `input += chunk` split a multi-byte character at every 64 KB pipe boundary into U+FFFD (B4-01)
const input = await readText(process.stdin);
let req;
try { req = JSON.parse(input); } catch { req = {}; }
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
try {
  const s = remoteStore();
  if (!s) throw new DataStoreError('unavailable', 'AXF_DATA_URL is unset');
  let result;
  switch (req.op) {
    case 'get': { const r = await s.get(req.key); result = r ? { ...r, data: r.data instanceof Uint8Array ? { $bytes: Buffer.from(r.data).toString('base64') } : r.data } : null; break; }
    case 'put': result = await s.put(req.key, req.data && req.data.$bytes !== undefined ? new Uint8Array(Buffer.from(req.data.$bytes, 'base64')) : req.data, { ifMatch: req.ifMatch, create: !!req.create, force: !!req.force, contentType: req.contentType }); break;
    case 'delete': result = await s.delete(req.key, { ifMatch: req.ifMatch, force: !!req.force }); break;
    case 'patch': result = await s.patch(req.key, req.body); break;
    case 'item': result = await s.item(req.key, req.id, { list: req.list }); break;
    case 'summary': result = await s.summary(req.key, { list: req.list }); break;
    case 'health': result = await s.health(); break;
    case 'append': result = await s.append(req.key, req.entries, { idempotencyKey: req.idem }); break;
    case 'read': result = await s.read(req.key, { since: req.since, limit: req.limit }); break;
    case 'list': result = await s.list(req.ns, { prefix: req.prefix, after: req.after, limit: req.limit }); break;
    default: throw new DataStoreError('invalid_body', `unknown op "${req.op}"`);
  }
  out({ ok: true, result });
} catch (e) {
  out({ ok: false, code: e.code || 'internal', message: e.message, ...(e.rev !== undefined ? { rev: e.rev } : {}), ...(e.etag !== undefined ? { etag: e.etag } : {}) });
}

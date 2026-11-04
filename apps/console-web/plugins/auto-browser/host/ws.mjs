/**
 * Minimal WebSocket server side (RFC 6455) for the browser host: handshake, text frames out, masked text frames in,
 * ping/pong and close. No dependency, because the host image only carries playwright-core.
 */
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_IN = 1 << 20; // 1 MiB per incoming message is plenty for input events and commands

/** Upgrade an HTTP request to a WebSocket. Returns a small socket object, or null when the request isn't one. */
export function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return null;
  const digest = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${digest}`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  const handlers = { message: [], close: [] };
  let buf = Buffer.alloc(0);
  let closed = false;
  let parts = [];

  const ws = {
    get open() { return !closed; },
    get buffered() { return socket.writableLength; },
    on(ev, fn) { handlers[ev]?.push(fn); return ws; },
    send(data) {
      if (closed) return;
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      socket.write(frame(Buffer.isBuffer(data) ? 0x2 : 0x1, payload));
    },
    close(code = 1000) {
      if (closed) return;
      const p = Buffer.alloc(2); p.writeUInt16BE(code);
      try { socket.write(frame(0x8, p)); } catch { /* socket already gone */ }
      finish();
      socket.end();
    },
  };

  function finish() {
    if (closed) return;
    closed = true;
    for (const fn of handlers.close) { try { fn(); } catch { /* listener errors don't stop the others */ } }
  }

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_IN) { ws.close(1009); return; }
      if (!masked) { ws.close(1002); return; } // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) { ws.close(); return; }
      if (op === 0x9) { socket.write(frame(0xa, data)); continue; }
      if (op === 0xa) continue;
      parts.push(data);
      if (!fin) continue;
      const msg = Buffer.concat(parts).toString('utf8');
      parts = [];
      for (const fn of handlers.message) { try { fn(msg); } catch { /* a bad message never kills the socket */ } }
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
  return ws;
}

function frame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len])
    : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 0xff])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
  return Buffer.concat([head, payload]);
}

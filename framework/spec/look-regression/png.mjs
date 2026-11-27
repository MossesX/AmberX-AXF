/**
 * Tiny PNG reader / writer for the look-regression diff (no dependencies): decodes 8-bit RGB / RGBA / grey non-interlaced
 * PNGs (what Chromium screenshots are), compares two images pixel by pixel and writes a diff image (changed pixels in
 * red over a faded copy of the baseline).
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

/** { width, height, data: RGBA bytes } */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; colorType = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p]; p += 1;
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff; }
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4, s = x * channels;
      if (channels === 1) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = 255; }
      else if (channels === 2) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; }
      else if (channels === 3) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255; }
      else { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
    }
    prev = line;
  }
  return { width, height, data: out };
}

export function encodePng({ width, height, data }) {
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) { raw[y * (width * 4 + 1)] = 0; data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Compare two decoded images. `tolerance` is the per-channel difference that still counts as equal (anti-aliasing).
 * Returns { same, changed, total, ratio, sizeChanged, diff } where diff is an encodable image or null when identical.
 */
export function diffPng(a, b, { tolerance = 16, masks = [] } = {}) {
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const sizeChanged = a.width !== b.width || a.height !== b.height;
  const out = Buffer.alloc(width * height * 4);
  const masked = (x, y) => masks.some(([mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh);
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (masks.length && masked(x, y)) { out[o] = 60; out[o + 1] = 60; out[o + 2] = 80; out[o + 3] = 255; continue; }
      const inA = x < a.width && y < a.height, inB = x < b.width && y < b.height;
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
      let diff = !inA || !inB;
      if (!diff) for (let c = 0; c < 4 && !diff; c += 1) diff = Math.abs(a.data[ia + c] - b.data[ib + c]) > tolerance;
      if (diff) { changed += 1; out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255; }
      else if (inA) { const g = Math.round(0.3 * a.data[ia] + 0.59 * a.data[ia + 1] + 0.11 * a.data[ia + 2]); const f = 160 + Math.round(g * 0.35); out[o] = out[o + 1] = out[o + 2] = f; out[o + 3] = 255; }
    }
  }
  const total = width * height;
  return { same: changed === 0 && !sizeChanged, changed, total, ratio: total ? changed / total : 0, sizeChanged, diff: changed || sizeChanged ? { width, height, data: out } : null };
}

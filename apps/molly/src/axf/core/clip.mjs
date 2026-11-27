/**
 * clip — cut text to a length without cutting a character in half, and read a byte stream as text without splitting
 * a character across chunks. Both were the source of U+FFFD ("�") in stored build text (deep audit B4-01):
 *
 *   clip(text, n)        text.slice(0, n) that never ends on half a surrogate pair (an emoji cut in the middle is
 *                        written to a UTF-8 file as U+FFFD).
 *   readText(stream)     every chunk collected as bytes and decoded once. `text += chunk` decodes each chunk on its
 *                        own, so a multi-byte character that straddles a chunk boundary (a pipe delivers 64 KB chunks)
 *                        turns into two or three U+FFFD.
 */
export function clip(v, n = Infinity) {
  const s = typeof v === 'string' ? v : '';
  if (!(n < s.length)) return s;
  const end = Math.max(0, Math.floor(n));
  const last = s.charCodeAt(end - 1);
  // a high surrogate at the cut: its low half would be dropped, so the whole character goes
  return s.slice(0, end > 0 && last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** All of a readable stream (stdin, an HTTP request) as one UTF-8 string, decoded once at the end. */
export async function readText(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c, 'utf8') : c);
  return Buffer.concat(chunks).toString('utf8');
}

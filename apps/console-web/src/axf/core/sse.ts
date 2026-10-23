/**
 * Server-Sent Events for every AXF web app: one parser, one stream reader, one reconnecting follower.
 *
 * The framing is the assistant contract's (assistant@1, spec/fixtures/assistant.json): blank lines end a frame,
 * `event:` names it (default `message`), `data:` lines are joined with `\n`, `id:` is a positive number (the seq every
 * AXF host sends), lines starting with `:` are comments (keep-alives), CRLF is read as LF, and a frame without data is
 * dropped. Kotlin: `ai.amberx.axf.kernel.assistant.Sse` (same rules, same fixture). The MCP engine keeps its own
 * spec-complete parser (`SseParser` in engines/mcp.ts: string ids, `retry:`, bare CR) because MCP servers are not AXF hosts.
 *
 *   await readSse(response, (f) => …, signal)          read one stream to its end (throws SseHttpError when refused)
 *   const stop = followSse((signal) => fetch(…), (f) => …)   keep a stream open: reconnect with back-off until stop()
 *
 * EventSource is not used on purpose: it can't send an Authorization header, and tokens never go in a URL.
 */

export interface SseFrame { event: string; data: string; id?: number }

/** One `event:`/`data:`/`id:` block → frame (data lines joined, comments skipped); null when the block carries no data. */
export function parseSseBlock(block: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  let id: number | undefined;
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('id:')) { const n = Number(line.slice(3).trim()); if (Number.isFinite(n) && n > 0) id = n; }
  }
  if (!data.length) return null;
  return { event, data: data.join('\n'), ...(id === undefined ? {} : { id }) };
}

/** Frames out of a text with blank-line separators; `rest` is the unfinished tail to keep for the next chunk. */
export function parseSseText(text: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let buf = text.replace(/\r\n/g, '\n');
  let i: number;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const f = parseSseBlock(buf.slice(0, i));
    buf = buf.slice(i + 2);
    if (f) frames.push(f);
  }
  return { frames, rest: buf };
}

/** Serialise one frame the way AXF hosts stream it (data as JSON). */
export function sseLine(event: string, data: unknown, id?: number): string {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
}

/** A frame's data as JSON, or `undefined` when it isn't JSON. */
export function sseJson<T = unknown>(f: SseFrame): T | undefined {
  try { return JSON.parse(f.data) as T; } catch { return undefined; }
}

/** The server refused the stream (non-2xx or no body). `message` is the server's `detail` when it sent one. */
export class SseHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'SseHttpError'; }
}

/**
 * Read a text/event-stream until it ends, handing over every complete frame. `source` is a fetch Response (refused
 * → `SseHttpError` with the server's `detail` or "request failed (<status>)") or a body stream. Aborting `signal`
 * cancels the read and returns quietly; an unfinished last frame is dropped.
 */
export async function readSse(source: Response | ReadableStream<Uint8Array>, onFrame: (f: SseFrame) => void, signal?: AbortSignal): Promise<void> {
  let body: ReadableStream<Uint8Array> | null;
  if (typeof (source as Response).ok === 'boolean') {
    const r = source as Response;
    if (!r.ok || !r.body) {
      const j = (await r.json().catch(() => ({}))) as { detail?: unknown };
      throw new SseHttpError(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`, r.status);
    }
    body = r.body;
  } else body = source as ReadableStream<Uint8Array>;
  const reader = body.getReader();
  const stop = () => { reader.cancel().catch(() => { /* already closed */ }); };
  if (signal?.aborted) { stop(); return; }
  signal?.addEventListener('abort', stop, { once: true });
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { frames, rest } = parseSseText(buf);
      buf = rest;
      for (const f of frames) onFrame(f);
    }
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

export interface FollowSseOptions {
  /** first wait after a dropped or refused stream (ms, default 2000); reset after every successful open */
  initialDelayMs?: number;
  /** longest wait (ms, default 60000); each failure doubles the wait up to this */
  maxDelayMs?: number;
  /** called when a stream opened (2xx with a body) */
  onOpen?: () => void;
  /** called after a stream ended or failed, before waiting `delayMs` */
  onDrop?: (error: unknown, delayMs: number) => void;
  /** wait implementation (tests); default setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

/** Wait before the next attempt: `initial · 2^(failures-1)`, capped (failures ≥ 1). */
export function sseBackoffMs(failures: number, initialMs = 2000, maxMs = 60_000): number {
  return Math.min(maxMs, initialMs * 2 ** Math.max(0, Math.floor(failures) - 1));
}

/**
 * Keep an event stream open: `open(signal)` makes the request (with the app's auth), every frame goes to `onFrame`,
 * and when the stream ends or fails it reconnects after a back-off (2 s, 4 s … 60 s; reset once a stream opens).
 * Returns `stop()`, which aborts the open request and ends the loop.
 */
export function followSse(open: (signal: AbortSignal) => Promise<Response>, onFrame: (f: SseFrame) => void, opts: FollowSseOptions = {}): () => void {
  const initial = opts.initialDelayMs ?? 2000;
  const max = opts.maxDelayMs ?? 60_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  let stopped = false;
  let ctrl: AbortController | null = null;
  let delay = initial;
  void (async () => {
    while (!stopped) {
      ctrl = new AbortController();
      let error: unknown = null;
      try {
        const r = await open(ctrl.signal);
        if (!r.ok || !r.body) throw new SseHttpError(`stream ${r.status}`, r.status);
        delay = initial;
        opts.onOpen?.();
        await readSse(r.body, onFrame, ctrl.signal);
      } catch (e) { error = e; /* aborted or offline: fall through to back-off */ }
      if (stopped) break;
      opts.onDrop?.(error, delay);
      await sleep(delay);
      delay = Math.min(delay * 2, max);
    }
  })();
  return () => { stopped = true; ctrl?.abort(); };
}

/*
 * Output terminal — web port of the kernel's runtime/OutputTerminal.kt. One append-only log every
 * long-running or user-visible operation writes to (installs, imports, hot swaps, kit fallbacks);
 * the React port renders it as a scrollable, auto-scrolling pane.
 */
export type TerminalLevel = 'info' | 'ok' | 'warn' | 'error' | 'note';
export interface TerminalLine { at: number; channel: string; level: TerminalLevel; text: string }

export class OutputTerminal {
  private _lines: TerminalLine[] = [];
  private listeners = new Set<(lines: TerminalLine[]) => void>();
  private seen = new Set<string>();
  constructor(private limit = 2000) {}
  get lines() { return this._lines; }
  subscribe(fn: (lines: TerminalLine[]) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((l) => l(this._lines)); }
  log(channel: string, text: string, level: TerminalLevel = 'info') { this._lines = [...this._lines, { at: Date.now(), channel, level, text }].slice(-this.limit); this.emit(); }
  ok(channel: string, text: string) { this.log(channel, text, 'ok'); }
  warn(channel: string, text: string) { this.log(channel, text, 'warn'); }
  error(channel: string, text: string) { this.log(channel, text, 'error'); }
  note(channel: string, text: string) { this.log(channel, text, 'note'); }
  /** Logs `text` once per `key` (e.g. one fallback note per kit × kind). */
  once(key: string, channel: string, text: string, level: TerminalLevel = 'note') { if (!this.seen.has(key)) { this.seen.add(key); this.log(channel, text, level); } }
  forget(prefix: string) { for (const k of [...this.seen]) if (k.startsWith(prefix)) this.seen.delete(k); }
  /** Multi-line output (a build-engine `log` array) → one line each. */
  many(channel: string, text: string | string[], level: TerminalLevel = 'info') { for (const l of Array.isArray(text) ? text : text.split('\n')) if (l.trim()) this.log(channel, l.trimEnd(), /note:/.test(l) ? 'note' : /^✗|error/i.test(l) ? 'error' : /^✓/.test(l) ? 'ok' : level); }
  clear() { this._lines = []; this.seen.clear(); this.emit(); }
  channels() { return [...new Set(this._lines.map((l) => l.channel))]; }
  export() { return this._lines.map((l) => `${new Date(l.at).toISOString()} [${l.channel}] ${l.level}: ${l.text}`).join('\n'); }
}

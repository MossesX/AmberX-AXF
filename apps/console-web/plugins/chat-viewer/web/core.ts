/**
 * Chat viewer — pure helpers (no React, no DOM): the shapes the server sends, source labels, time formatting, the
 * bubble list (consecutive tool calls folded into one collapsible run), search snippets, and the speech filter that
 * says which turns an audio export reads. The server is the source of truth; these only shape what it sent.
 */

export type Source = 'claude-ai-text' | 'claude-ai-voice' | 'claude-code' | 'headless' | 'hub-drop';
export type Role = 'user' | 'assistant' | 'tool';
export type Kind = 'speech' | 'text' | 'tool';
export interface Message { role: Role; text: string; at: string; kind: Kind; toolName?: string }
export interface Row {
  id: string; source: Source; title: string; startedAt: string; updatedAt: string; project: string; messageCount: number;
  model: string; branch: string; host: string; version: number; change: 'new' | 'continued' | 'changed'; changedAt: string; seen: boolean;
}
export interface Version { version: number; hash: string; updatedAt: string; messageCount: number; change: string; kept: boolean }
export interface Chapter { title: string; start: number; seq: number }
export interface AudioExport {
  sessionId: string; title: string; file: string; format: string; duration: number; chapters: Chapter[]; createdAt: string; engine: string;
  voices: Record<string, string>; range: { from: number; to: number | null }; turns: number; bytes: number;
}
export interface Job { id: string; kind: string; title: string; state: 'queued' | 'running' | 'done' | 'failed'; progress: number; total: number; message: string; error: string; result: AudioExport | null }
export interface SyncReport { at: string; new: number; continued: number; changed: number; unchanged: number; errors: string[]; bySource?: Record<string, Record<string, number>>; took?: number; total?: number; kind?: string }
export interface Hit { sessionId: string; seq: number; snippet: string; title: string; source: Source; updatedAt: string }

export const SOURCES: { id: Source; label: string; short: string; icon: string }[] = [
  { id: 'claude-ai-text', label: 'claude.ai chat', short: 'claude.ai', icon: 'type' },
  { id: 'claude-ai-voice', label: 'claude.ai voice', short: 'Voice', icon: 'mic' },
  { id: 'claude-code', label: 'Claude Code', short: 'Code', icon: 'terminal' },
  { id: 'headless', label: 'Headless build', short: 'Build', icon: 'hammer' },
  { id: 'hub-drop', label: 'Hub drop', short: 'Hub', icon: 'cloud' },
];
export const sourceOf = (s: string) => SOURCES.find((x) => x.id === s) ?? { id: s as Source, label: s, short: s, icon: 'file' };

export const WHO: Record<Role, string> = { user: 'Brett', assistant: 'Amber', tool: 'Tool' };

/** "new" (never opened), "updated" (continued / changed since last opened) or '' */
export function badge(r: Pick<Row, 'seen' | 'change' | 'version'>): '' | 'new' | 'updated' {
  if (r.seen) return '';
  return r.version <= 1 ? 'new' : 'updated';
}

export function fmtWhen(iso: string, now = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} ${time}`;
}

export function fmtDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** What the bubble list draws: one bubble per spoken / text message, one fold per run of tool messages. */
export type Line = { kind: 'msg'; seq: number; m: Message } | { kind: 'tools'; seq: number; items: { seq: number; m: Message }[] };
export function lines(messages: Message[]): Line[] {
  const out: Line[] = [];
  messages.forEach((m, seq) => {
    if (m.role === 'tool' || m.kind === 'tool') {
      const last = out[out.length - 1];
      if (last && last.kind === 'tools') last.items.push({ seq, m });
      else out.push({ kind: 'tools', seq, items: [{ seq, m }] });
    } else out.push({ kind: 'msg', seq, m });
  });
  return out;
}

/** A search snippet (marks \u0002 … \u0003 from SQLite) → plain and marked parts; rendered as text, never HTML. */
export function snippetParts(s: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let hit = false;
  for (const piece of s.split(/([\u0002\u0003])/)) {
    if (piece === '\u0002') hit = true;
    else if (piece === '\u0003') hit = false;
    else if (piece) out.push({ text: piece, hit });
  }
  return out;
}

/** The turns an audio export reads (the server decides; this is for counts shown before rendering). */
export const spoken = (messages: Message[], from = 0, to?: number) =>
  messages.filter((m, i) => i >= from && (to === undefined || i < to) && m.role !== 'tool' && m.kind !== 'tool' && m.text.trim()).length;

export function summary(r: SyncReport | null | undefined): string {
  if (!r) return 'Not checked yet';
  const bits = [`${r.new} new`, `${r.continued} continued`, `${r.changed} changed`, `${r.unchanged} unchanged`];
  return bits.join(' · ');
}

/** Plain-text transcript for copy / share. */
export function transcript(title: string, messages: Message[], withTools = false): string {
  const body = messages.filter((m) => withTools || m.role !== 'tool').map((m) => `${m.role === 'tool' ? `Tool${m.toolName ? `: ${m.toolName}` : ''}` : WHO[m.role]}${m.at ? ` (${fmtWhen(m.at)})` : ''}\n${m.text}`);
  return `${title}\n\n${body.join('\n\n')}\n`;
}

export function matches(r: Row, q: string): boolean {
  if (!q) return true;
  const t = q.toLowerCase();
  return [r.title, r.project, r.branch, r.model, sourceOf(r.source).label].some((x) => x && x.toLowerCase().includes(t));
}

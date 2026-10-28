/** Small builders the command libraries are written with (keeps 300+ commands readable). */
import type { CategoryId, Command, CommandSettings, SlotKind, Step } from './core';

export const op = (name: string, args: Record<string, string> = {}): Step => ({ do: 'op', op: name, args });
export const act = (action: string): Step => ({ do: 'action', action });
export const say = (text: string): Step => ({ do: 'say', text });
export const ask = (slot: string, question: string, kind: SlotKind = 'text', more: { optional?: boolean; choices?: string[] } = {}): Step => ({ do: 'ask', slot, question, kind, ...more });
export const confirm = (question: string): Step => ({ do: 'confirm', question });
export const run = (command: string): Step => ({ do: 'run', command });
export const ai = (prompt: string, into?: string): Step => (into ? { do: 'ai', prompt, into } : { do: 'ai', prompt });
export const molly = (task: string): Step => ({ do: 'molly', task });
export const intent = (i: Record<string, unknown>): Step => ({ do: 'intent', intent: i });
export const wait = (ms: number): Step => ({ do: 'wait', ms });

interface More { slots?: Record<string, SlotKind>; optional?: string[]; settings?: CommandSettings; defaultOff?: boolean; needsAi?: boolean; developer?: boolean }

/** A category's builder: `c.action(group, id, label, description, phrases, steps)`, same for chain and wizard. */
export function category(cat: CategoryId, prefix: string) {
  const out: Command[] = [];
  const make = (kind: Command['kind']) => (group: string, id: string, label: string, description: string, phrases: string[], steps: Step[], more: More = {}): void => {
    out.push({ id: `${prefix}.${id}`, category: cat, kind, group, label, description, phrases, steps, ...more });
  };
  return { list: out, action: make('action'), chain: make('chain'), wizard: make('wizard'), id: (id: string) => `${prefix}.${id}` };
}

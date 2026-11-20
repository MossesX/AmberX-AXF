export interface SlotField { value: number | null; min: number; max: number; available: boolean; why?: string }
export interface HostCapField extends SlotField { canEdit: boolean; live?: number | null }
export interface BuildSlots { stepsInParallel: SlotField; hostCap: HostCapField; over: boolean; note?: string }
export interface SlotDraft { steps: string; cap: string }
export function parseCount(text: unknown, range: { min: number; max: number }): { value?: number; error?: string };
export function overNote(steps: number | null, cap: number | null): string;
export function patchOf(slots: BuildSlots | null, draft: SlotDraft): { patch: { stepsInParallel?: number; maxBuilds?: number }; errors: { steps?: string; cap?: string } };
export function previewOver(slots: BuildSlots | null, draft: SlotDraft): string;

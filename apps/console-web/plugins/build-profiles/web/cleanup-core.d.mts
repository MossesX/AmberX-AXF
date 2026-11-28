// Types for cleanup-core.mjs.
export interface CleanupFinding {
  kind: string;
  id: string;
  title: string;
  profiles: string[];
  status: string;
  fixable: boolean;
  /** the status (or profile) the fix gives it; '' when there is no fix */
  to: string;
  /** why it can't be fixed here; '' when it can */
  why: string;
  evidence: string;
}
export interface CleanupScan { findings: CleanupFinding[]; counts: Record<string, number>; fixable: number; total: number }
export interface CleanupGroup { kind: string; title: string; hint: string; rows: CleanupFinding[]; fixable: number }
export interface CleanupFixResult { fixed: { id: string; kind: string; to: string }[]; refused: { id: string; why: string }[]; left: number | null }

export const KINDS: string[];
export function normalizeFinding(raw: unknown): CleanupFinding | null;
export function normalizeScan(raw: unknown): CleanupScan;
export function groupFindings(findings: CleanupFinding[]): CleanupGroup[];
export function evidenceText(f: CleanupFinding): string;
export function fixText(f: CleanupFinding): string;
export function summaryText(scan: CleanupScan): string;
export function fixRequest(scan: CleanupScan, opts?: { ids?: string[] | null; profile?: string }): { builds: string[]; profile?: string };
export function normalizeFix(raw: unknown, asked?: string[]): CleanupFixResult;
export function fixMessage(result: CleanupFixResult): { tone: 'info' | 'success' | 'warning' | 'danger'; text: string };

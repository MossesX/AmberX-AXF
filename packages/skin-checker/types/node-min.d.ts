// The few Node built-ins the loader and core use, so `tsc -p` checks the package without @types/node installed.
declare module 'node:fs' {
  export function existsSync(p: string): boolean;
  export function mkdirSync(p: string, o?: { recursive?: boolean }): void;
  export function readdirSync(p: string): string[];
  export function readFileSync(p: string, enc: 'utf8'): string;
  export function writeFileSync(p: string, data: string): void;
  export function renameSync(a: string, b: string): void;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(u: string | URL): string;
}
interface ImportMeta { url: string }
declare const process: { argv: string[]; env: Record<string, string | undefined>; exitCode?: number; stdout: { write(s: string): boolean; on(e: 'error', f: () => void): void }; stderr: { write(s: string): boolean }; cwd(): string };

/** Runtime host (filled in by s8): finds native elements of the active families and swaps in themed controls. */
export interface LiveHost { counts(): Record<string, number> }
let live: LiveHost | null = null;
export function liveHost(): LiveHost | null { return live; }
export function setLiveHost(h: LiveHost | null): void { live = h; }

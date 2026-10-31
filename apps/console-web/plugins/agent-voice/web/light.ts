/**
 * The live status light: lit while the selected agent (in an Assistant window) is a voice agent, and showing what the
 * voice is doing (ready / speaking / listening / paused / error). One computed snapshot shared by the banner badge,
 * the Assistant title bar and the console page.
 */
import { useSyncExternalStore } from 'react';
import { lightState, type LightState } from './core';
import { assistantAgent, onAssistantAgent } from './bridge';
import { onSpeaker, speakerState } from './engine';
import { agentName, onVoiceData, profileOf } from './store';

export interface Light { state: LightState; agentId: string; agentName: string; line: string }

let snap: Light = { state: 'off', agentId: '', agentName: '', line: '' };
const subs = new Set<() => void>();

function compute(): Light {
  const a = assistantAgent();
  const s = speakerState();
  // While an agent is talking, the light belongs to the talker even if another one gets selected.
  const id = s.speaking ? s.agentId : a.agentId;
  const profile = profileOf(id);
  const state = lightState({ profile, speaking: s.speaking, paused: s.paused, listening: s.listening, error: !!s.error && !s.speaking });
  return { state, agentId: id, agentName: (s.speaking ? s.agentName : a.agentName) || agentName(id), line: s.speaking ? s.line : '' };
}

function refresh() {
  const next = compute();
  if (next.state === snap.state && next.agentId === snap.agentId && next.agentName === snap.agentName && next.line === snap.line) return;
  snap = next;
  subs.forEach((f) => f());
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  onAssistantAgent(refresh);
  onSpeaker(refresh);
  onVoiceData(refresh);
  refresh();
}

export function light(): Light { wire(); return snap; }
export function onLight(fn: () => void): () => void { wire(); subs.add(fn); return () => { subs.delete(fn); }; }
export const useLight = (): Light => useSyncExternalStore(onLight, light, light);

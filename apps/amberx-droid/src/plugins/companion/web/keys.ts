/** Companion settings keys (Settings → Plugins → Gizmo). One place, so the view, talk mode and the settings agree. */
export const K = {
  /** '' = the assistant's default (Opus); else a model-policy key (opus | fable) */
  model: 'companion.model',
  /** Brett's own words added to every new chat's instructions (personality, how to answer) */
  persona: 'companion.persona',
  /** tools and connectors (axHub services, the repo, the crew) in new chats */
  tools: 'companion.tools',
  /** auto: tools load per turn when a message needs them | chat: never | tools: always. Each chat can change it. */
  toolMode: 'companion.toolMode',
  /** say replies out loud in talk mode */
  speak: 'companion.speak',
  /** say every reply out loud, typed ones too */
  speakAlways: 'companion.speakAlways',
  /** a phone (or browser) voice id; '' = the device default */
  voice: 'companion.voice',
  /** speech rate, 0.5 … 2 */
  rate: 'companion.rate',
  /** stop talking as soon as Brett talks over it */
  interrupt: 'companion.interrupt',
  /** talk mode keeps listening for the next thing said (hands-free) instead of push-to-talk only */
  handsFree: 'companion.handsFree',
  /** a toast when a reply finishes while another page is open */
  notify: 'companion.notify',
  /** keep a copy of every chat on axHub (amberx-axf/_data/companion/chats) */
  mirror: 'companion.mirror',
  /** daily cap in USD for this device's chats (0 = no cap), estimated from today's tokens */
  dailyCapUsd: 'companion.dailyCapUsd',
  /** show tool calls as cards in the chat */
  showTools: 'companion.showTools',
} as const;

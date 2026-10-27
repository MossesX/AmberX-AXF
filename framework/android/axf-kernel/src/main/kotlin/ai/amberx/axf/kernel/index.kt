/**
 * AmberX AXF kernel — Android port, pure Kotlin.
 *
 * Package map (mirrors framework/core on the web port):
 *   asset/     envelope, open type registry, validator, registry, typed models   (core/types.ts, registry.ts, validate.ts)
 *   engine/    theme, layout, component-style, uac, context-menu, action bus     (core/engines)
 *   runtime/   AxfState + AxfRuntime                                            (core/runtime.ts)
 *   module/    AxfModule, ModuleRegistry, ExtensionRegistry, ServiceRegistry, placeholders   (new — Foundations)
 *   event/     typed EventBus                                                   (new)
 *   flags/     FeatureFlags + kill switches                                     (new)
 *   config/    layered Config                                                   (new)
 *   migrate/   Migration registry + ledger + Semver + Deprecations              (new)
 *   platform/  seams every port implements: clock, ids, dispatchers, kv, secure, logger, telemetry, permissions, files
 *   state/     AxfStore — reducer/middleware/selector store with undo + persistence (state management engine)
 *   data/      QueryClient/Query/Mutation — keyed fetch + cache, stale-while-revalidate (data fetching & cache engine)
 *   contract/  RouteSpec/Router, SettingsGroup/SettingSpec, Ports, Strings, IconResolver, WorkScheduler/Worker, Session/Principal/AuditLog
 *   interop/   ActionDescriptor/EventDescriptor, CallOrigin/RemoteCaller, CallableAction, JobManager, RemoteServices,
 *              ProtocolAdapter/ProtocolHost, AppSurface (surface@1), WireError, AxfInterop   (new — protocol-neutral interop)
 *   manifest/  AxfManifest
 *   mcp/       McpEngine — MCP client protocol core (JSON-RPC framing, SSE, Streamable HTTP rules, pagination, wire errors, call gate)   (core/engines/mcp.ts)
 *   project/   ProjectManifests, ProjectRules, ProjectValidator — project.manifest.json (project-manifest@1)   (core/project.ts)
 *   triggers/  Trigger, TriggerKinds, TriggerRegistry, TriggerMatcher, Patterns, SpokenNumbers, TriggerHosting — triggers@1   (core/triggers.ts)
 *   ai/        AiMode, AiModes, AiModeRegistry, AiSessionClient — ai-modes@1 (lib-ai contract)   (core/ai-modes.ts)
 *   speech/    SpeechProvider, SpeechQueue — speech@1 (the speaking side)   (core/speech.ts)
 *   AxfKernel  builder + lifecycle + status
 */
package ai.amberx.axf.kernel

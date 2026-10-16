/**
 * AmberX AXF kernel — Android port, pure Kotlin.
 *
 * Package map (mirrors framework/core on the web port):
 *   asset/     envelope, open type registry, validator, registry, typed models   (core/types.ts, registry.ts, validate.ts)
 *   engine/    theme, layout, component-style, uac, context-menu, action bus     (core/engines/*)
 *   runtime/   AxfState + AxfRuntime                                            (core/runtime.ts)
 *   module/    AxfModule, ModuleRegistry, ExtensionRegistry, ServiceRegistry, placeholders   (new — Foundations)
 *   event/     typed EventBus                                                   (new)
 *   flags/     FeatureFlags + kill switches                                     (new)
 *   config/    layered Config                                                   (new)
 *   migrate/   Migration registry + ledger + Semver + Deprecations              (new)
 *   platform/  seams every port implements: clock, ids, dispatchers, kv, secure, logger, telemetry, permissions, files
 *   contract/  RouteSpec/Router, SettingsGroup/SettingSpec, Ports, Strings, IconResolver, WorkScheduler/Worker, Session/Principal/AuditLog
 *   manifest/  AxfManifest
 *   AxfKernel  builder + lifecycle + status
 */
package ai.amberx.axf.kernel

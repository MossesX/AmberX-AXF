# axf-devtools

Developer console for any AXF app: kernel status (modules, extension points filled/empty, placeholders), feature-flag playground, action and event logs (recorded through `ActionBus.intercept` + `EventBus.history`), asset inspector/validator, the build-engine client (`HttpBuildEngineClient` against the VPS driver, `NotImplementedBuildEngine` otherwise) and the `axf dev` hot reloader. Contributes the `devtools` route and a Developer settings group.

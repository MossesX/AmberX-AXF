# AmberX AXF: assets are plain JSON parsed reflectively by kotlinx.serialization — keep its runtime.
-keep,includedescriptorclasses class ai.amberx.axf.**$$serializer { *; }
-keepclassmembers class ai.amberx.axf.** { *** Companion; }
-keepclasseswithmembers class ai.amberx.axf.** { kotlinx.serialization.KSerializer serializer(...); }
# AX Notes plugins are created by class name from assets/axnotes/plugins.json (PluginHost): keep their no-arg constructors.
-keep class ai.amberx.axf.axnotes.plugins.** implements ai.amberx.axf.axnotes.pluginhost.AxNotesPlugin { public <init>(); }

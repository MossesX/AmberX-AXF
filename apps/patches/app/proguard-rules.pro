# AmberX AXF: assets are plain JSON parsed reflectively by kotlinx.serialization — keep its runtime.
-keep,includedescriptorclasses class ai.amberx.axf.**$$serializer { *; }
-keepclassmembers class ai.amberx.axf.** { *** Companion; }
-keepclasseswithmembers class ai.amberx.axf.** { kotlinx.serialization.KSerializer serializer(...); }

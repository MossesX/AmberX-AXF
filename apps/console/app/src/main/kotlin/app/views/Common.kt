package ai.amberx.axf.console.views

import ai.amberx.axf.console.ConsoleRepo
import ai.amberx.axf.console.Status
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfBadge
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
fun rememberRepo(): ConsoleRepo? = rememberService<ConsoleRepo>()

fun Status.tone(): String = when (this) { Status.BUILT -> "success"; Status.PARTIAL -> "info"; Status.PLACEHOLDER -> "warning"; Status.PLANNED -> "accent" }
fun Status.label(): String = name.lowercase()

@Composable
fun StatusBadge(s: Status, modifier: Modifier = Modifier) = AxfBadge(s.label(), modifier, tone = s.tone())

fun tagLabel(tag: String): String = when (tag) { "lock" -> "locked-in"; "ph" -> "placeholder"; "suggested" -> "suggested"; else -> tag }

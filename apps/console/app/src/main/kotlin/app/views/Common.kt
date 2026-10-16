package ai.amberx.axf.console.views

import ai.amberx.axf.console.ConsoleRepo
import ai.amberx.axf.console.Status
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfBadge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier

@Composable
fun rememberRepo(): ConsoleRepo? { val kernel = LocalAxfKernel.current; return remember(kernel) { kernel?.services?.get<ConsoleRepo>() } }

fun Status.tone(): String = when (this) { Status.BUILT -> "success"; Status.PARTIAL -> "info"; Status.PLACEHOLDER -> "warning"; Status.PLANNED -> "accent" }
fun Status.label(): String = name.lowercase()

@Composable
fun StatusBadge(s: Status, modifier: Modifier = Modifier) = AxfBadge(s.label(), modifier, tone = s.tone())

fun tagLabel(tag: String): String = when (tag) { "lock" -> "locked-in"; "ph" -> "placeholder"; "suggested" -> "suggested"; else -> tag }

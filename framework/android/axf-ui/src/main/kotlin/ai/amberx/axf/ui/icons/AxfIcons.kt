package ai.amberx.axf.ui.icons

import ai.amberx.axf.kernel.contract.IconResolver
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Help
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.automirrored.outlined.Redo
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentCut
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Inventory
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.PowerSettingsNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Shuffle
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp

/**
 * Name → vector registry for the icon names assets use (same vocabulary as framework/react/components/Icon.tsx).
 * Unknown names fall back to [fallback] (`box`), never crash. Icon packs and apps add entries with [register].
 * Implements the kernel's [IconResolver] so the validator/devtools can report unresolved names.
 */
public object AxfIcons : IconResolver {
    private val map: MutableMap<String, ImageVector> = linkedMapOf(
        "home" to Icons.Outlined.Home, "grid" to Icons.Outlined.GridView, "layers" to Icons.Outlined.Layers, "shield" to Icons.Outlined.Shield,
        "palette" to Icons.Outlined.Palette, "type" to Icons.Outlined.TextFields, "layout" to Icons.Outlined.Dashboard, "menu" to Icons.Outlined.Menu,
        "sliders" to Icons.Outlined.Tune, "chevron-right" to Icons.AutoMirrored.Outlined.KeyboardArrowRight, "chevron-left" to Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
        "chevron-down" to Icons.Outlined.ExpandMore, "chevron-up" to Icons.Outlined.ExpandLess, "box" to Icons.Outlined.Inventory2, "bell" to Icons.Outlined.Notifications,
        "zap" to Icons.Outlined.Bolt, "cut" to Icons.Outlined.ContentCut, "copy" to Icons.Outlined.ContentCopy, "paste" to Icons.Outlined.ContentPaste,
        "shuffle" to Icons.Outlined.Shuffle, "keyboard" to Icons.Outlined.Keyboard, "code" to Icons.Outlined.Code, "upload" to Icons.Outlined.Upload,
        "download" to Icons.Outlined.Download, "search" to Icons.Outlined.Search, "settings" to Icons.Outlined.Settings, "plus" to Icons.Outlined.Add,
        "minus" to Icons.Outlined.Remove, "check" to Icons.Outlined.Check, "x" to Icons.Outlined.Close, "info" to Icons.Outlined.Info,
        "alert" to Icons.Outlined.Warning, "trash" to Icons.Outlined.Delete, "edit" to Icons.Outlined.Edit, "save" to Icons.Outlined.Save,
        "folder" to Icons.Outlined.Folder, "file" to Icons.Outlined.Description, "play" to Icons.Outlined.PlayArrow, "pause" to Icons.Outlined.Pause,
        "refresh" to Icons.Outlined.Refresh, "external" to Icons.AutoMirrored.Outlined.OpenInNew, "user" to Icons.Outlined.Person, "users" to Icons.Outlined.People,
        "lock" to Icons.Outlined.Lock, "unlock" to Icons.Outlined.LockOpen, "eye" to Icons.Outlined.Visibility, "star" to Icons.Outlined.Star,
        "heart" to Icons.Outlined.Favorite, "terminal" to Icons.Outlined.Terminal, "github" to Icons.Outlined.Code, "cloud" to Icons.Outlined.Cloud,
        "wifi" to Icons.Outlined.Wifi, "map" to Icons.Outlined.Map, "camera" to Icons.Outlined.CameraAlt, "mic" to Icons.Outlined.Mic,
        "video" to Icons.Outlined.Videocam, "image" to Icons.Outlined.Image, "clock" to Icons.Outlined.Schedule, "calendar" to Icons.Outlined.CalendarToday,
        "list" to Icons.AutoMirrored.Outlined.List, "filter" to Icons.Outlined.FilterList, "sort" to Icons.AutoMirrored.Outlined.Sort, "more" to Icons.Outlined.MoreHoriz,
        "more-vertical" to Icons.Outlined.MoreVert, "moon" to Icons.Outlined.DarkMode, "sun" to Icons.Outlined.LightMode, "bug" to Icons.Outlined.BugReport,
        "flag" to Icons.Outlined.Flag, "tag" to Icons.Outlined.LocalOffer, "link" to Icons.Outlined.Link, "share" to Icons.Outlined.Share,
        "help" to Icons.AutoMirrored.Outlined.Help, "power" to Icons.Outlined.PowerSettingsNew,
        // names the web icon set also has
        "undo" to Icons.AutoMirrored.Outlined.Undo, "redo" to Icons.AutoMirrored.Outlined.Redo, "check-circle" to Icons.Outlined.CheckCircle, "x-circle" to Icons.Outlined.Cancel,
        "monitor" to Icons.Outlined.Monitor, "smartphone" to Icons.Outlined.Smartphone, "branch" to Icons.Outlined.AccountTree, "logout" to Icons.AutoMirrored.Outlined.Logout,
        "sparkles" to Icons.Outlined.AutoAwesome, "package" to Icons.Outlined.Inventory, "rocket" to Icons.Outlined.RocketLaunch,
        "arrow-left" to Icons.AutoMirrored.Outlined.ArrowBack, "arrow-right" to Icons.AutoMirrored.Outlined.ArrowForward, "send" to Icons.AutoMirrored.Outlined.Send,
        "history" to Icons.Outlined.History, "database" to Icons.Outlined.Storage, "error" to Icons.Outlined.ErrorOutline,
    )

    public val fallback: ImageVector get() = Icons.Outlined.Inventory2

    public fun register(name: String, vector: ImageVector) { map[name] = vector }
    public fun registerAll(vectors: Map<String, ImageVector>) { map.putAll(vectors) }
    public operator fun get(name: String?): ImageVector = name?.let { map[it] } ?: fallback
    public fun getOrNull(name: String?): ImageVector? = name?.let { map[it] }
    public fun names(): List<String> = map.keys.toList()
    override fun has(name: String): Boolean = name in map
}

/** Draws a registered icon. `tint` defaults to the current content color; `contentDescription` falls back to the name. */
@Composable
public fun AxfIcon(name: String?, modifier: Modifier = Modifier, size: Dp? = null, tint: Color = androidx.compose.material3.LocalContentColor.current, contentDescription: String? = name) {
    if (name == null) return
    Icon(imageVector = AxfIcons[name], contentDescription = contentDescription, modifier = if (size != null) modifier.size(size) else modifier, tint = tint)
}

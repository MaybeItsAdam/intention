package uk.co.maybeitssoftware.intention

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Is Settings showing Intention's own page?"
 *
 * The first test is the regression. `isRemovalSurface` used to answer true for
 * any visible node whose text equalled the accessibility service label — which
 * is EVERY ROW of Settings -> Accessibility, since that screen lists every
 * installed service. A user who went there to switch on a screen reader got
 * our activity thrown over the top of Settings, and (with no durable
 * stand-down; see LeavePolicyTest) got it again on the next window change,
 * without end.
 */
class RemovalSurfaceMatcherTest {

    private val APP = "Intention"
    private val SERVICE = "Intention App Blocker"
    private val DESCRIPTION =
        "Monitors app launches and, in supported browsers, the address bar to block " +
            "distracting apps and websites."

    private fun matcher() = RemovalSurfaceMatcher(APP, SERVICE, DESCRIPTION)

    /** Feed a whole screen, the way the bounded walk does. */
    private fun screen(vararg nodes: Pair<String?, String?>): Boolean {
        val m = matcher()
        for ((text, id) in nodes) if (m.observe(text, id)) return true
        return m.matched
    }

    // ---- Screens we must leave alone -------------------------------------

    @Test
    fun theAccessibilityListIsNotARemovalSurface() {
        assertFalse(
            screen(
                "Accessibility" to "com.android.settings:id/action_bar_title",
                "TalkBack" to "android:id/title",
                "Select to Speak" to "android:id/title",
                SERVICE to "android:id/title",
                "Switch Access" to "android:id/title"
            )
        )
    }

    @Test
    fun anAccessibilityListWithPerRowSwitchesIsStillNotARemovalSurface() {
        // Some skins put a switch on each row. `switch_widget` is deliberately
        // not one of the detail-page anchors for exactly this reason — only
        // the page-level toggle BAR counts.
        assertFalse(
            screen(
                "TalkBack" to "android:id/title",
                null to "com.android.settings:id/switch_widget",
                SERVICE to "android:id/title",
                null to "com.android.settings:id/switch_widget"
            )
        )
    }

    @Test
    fun theAllAppsListIsNotARemovalSurface() {
        assertFalse(
            screen(
                "Chrome" to "android:id/title",
                APP to "android:id/title",
                "Instagram" to "android:id/title"
            )
        )
    }

    @Test
    fun anotherAppsInfoPageIsNotARemovalSurface() {
        assertFalse(
            screen(
                "Chrome" to "com.android.settings:id/entity_header_title",
                "Uninstall" to "com.android.settings:id/uninstall_button"
            )
        )
    }

    @Test
    fun anEmptyScreenIsNotARemovalSurface() {
        assertFalse(screen(null to null, "" to null, "  " to "android:id/title"))
    }

    // ---- Screens we must still catch -------------------------------------

    @Test
    fun ourOwnAppInfoPageMatchesOnItsHeader() {
        assertTrue(screen(APP to "com.android.settings:id/entity_header_title"))
    }

    @Test
    fun ourOwnAppInfoPageMatchesOnTheUninstallButtonPlusOurLabel() {
        assertTrue(
            screen(
                "App info" to "com.android.settings:id/action_bar_title",
                APP to "android:id/title",
                "Uninstall" to "com.samsung.android.settings:id/uninstall_button"
            )
        )
    }

    @Test
    fun ourOwnServiceDetailPageMatchesOnItsToggleBar() {
        assertTrue(
            screen(
                SERVICE to "com.android.settings:id/action_bar_title",
                "Use $SERVICE" to "com.android.settings:id/main_switch_bar"
            )
        )
    }

    @Test
    fun ourOwnServiceDetailPageMatchesOnOurOwnDescription() {
        // The description is our string, rendered under the toggle and
        // nowhere else — the anchor that survives a skin renaming the switch.
        assertTrue(screen(SERVICE to "android:id/title", DESCRIPTION to "android:id/summary"))
    }

    @Test
    fun aClippedDescriptionStillMatches() {
        assertTrue(
            screen(
                SERVICE to "android:id/title",
                DESCRIPTION.take(RemovalSurfaceMatcher.DESCRIPTION_PREFIX_CHARS + 5) to "android:id/summary"
            )
        )
    }

    @Test
    fun aDescriptionTooShortToBeOursIsNotAnAnchor() {
        // Guard on the guard: an empty or stubbed description must not turn
        // every node on the accessibility list into a detail-page anchor.
        val m = RemovalSurfaceMatcher(APP, SERVICE, "")
        m.observe(SERVICE, "android:id/title")
        m.observe("", "android:id/summary")
        assertFalse(m.matched)
    }
}

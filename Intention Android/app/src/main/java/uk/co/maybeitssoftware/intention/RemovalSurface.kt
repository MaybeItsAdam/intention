package uk.co.maybeitssoftware.intention

/**
 * "Is Settings showing INTENTION'S OWN page?" — the whole of that question,
 * pure, so it can be driven from a test with a handful of made-up nodes
 * instead of from a phone.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS HAS TO MEAN, AND WHAT IT USED TO MEAN
 * ---------------------------------------------------------------------------
 * It has to mean "the user is looking at the page from which Intention gets
 * switched off": our own App info page in Settings, or our own accessibility
 * service's detail page. It must NOT mean "one of our labels is somewhere on
 * screen", and the difference is not academic — it was the bug.
 *
 * The previous rule answered true for ANY visible node whose text equalled the
 * accessibility service label. That is every row of Settings -> Accessibility,
 * because that screen is a list of installed services and ours is one of them.
 * So a user who opened Accessibility to set up TalkBack got our activity
 * launched over the top of Settings, and — with no durable stand-down, see
 * LeavePolicy — got it again on the next window change, indefinitely. Two apps
 * taking turns at the foreground of the Settings app is the exact shape Play
 * pulls accessibility apps for, and it trapped somebody who came for a screen
 * reader in the one screen they needed.
 *
 * The old comment argued the list was worth matching because "the list is
 * where the toggle they are reaching for actually is". That has not been true
 * since Android 12: the list rows are plain preferences that navigate to a
 * per-service page, and the on/off switch lives on that page. Matching the
 * detail page loses nothing real and costs a class of false positive that has
 * no upper bound.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SHAPES, BOTH CONJUNCTIONS
 * ---------------------------------------------------------------------------
 * Every rule below needs two independent things to be true at once, because
 * any one of them alone is also true of a list we must not match:
 *
 *   1. OUR APP INFO PAGE
 *      a. our app label as the text OF the header-title node — that node names
 *         the app the page is about, so this is unambiguous on its own; or
 *      b. an uninstall button anywhere on screen AND our app label as the text
 *         of some node. `uninstall_button` only exists on an app's own details
 *         page, and if that page were another app's, our label would not be on
 *         it. "Intention" alone is also every row of the all-apps list, which
 *         is why it never counts by itself.
 *
 *   2. OUR ACCESSIBILITY SERVICE'S DETAIL PAGE
 *      our service label as node text AND a detail-page anchor, being either
 *      the page-level toggle bar (`main_switch_bar` and friends — the big "Use
 *      Intention App Blocker" switch, which is a property of a settings DETAIL
 *      page and never of a list) or the opening words of our own service
 *      description, which Settings renders under that toggle and renders
 *      nowhere else. Two anchors rather than one because either can go missing
 *      on a skin, and their absence costs silence rather than a false match.
 *
 * Matched on OUR OWN labels and OUR OWN description rather than on the word
 * "Uninstall" or "Use", which the system localises and which would therefore
 * stop matching the moment somebody changes their phone's language. Ours are
 * ours. (They are also English-only today, so a user whose Settings app is
 * localised still gets our label; if we ever translate them, this keeps
 * working, because it reads the same resources Settings does.)
 *
 * The uninstall CONFIRMATION dialog is deliberately not here, and not
 * reachable from here: it belongs to the package installer rather than to
 * Settings, and the caller only ever runs this while a known Settings package
 * is in front. Somebody looking at the system's own "are you sure" has made
 * the decision, and interrupting it is the fighting-for-control shape this
 * whole feature refuses — quite apart from it being the very dialog our own
 * WebAppInterface.requestUninstall() raises at the end of the conversation.
 *
 * Anything unreadable answers false, i.e. do nothing. Failing quiet is the
 * only defensible direction: the cost is a leaving conversation that did not
 * happen, and the user was on their way to Settings to end the relationship
 * anyway.
 */
class RemovalSurfaceMatcher(
    appLabel: String,
    serviceLabel: String,
    serviceDescription: String = ""
) {
    companion object {
        // The header title on an app's own details page. Its TEXT is the app
        // the page is about, which is what makes it worth a rule of its own.
        private const val APP_INFO_HEADER_ID = ":id/entity_header_title"

        // The uninstall button on that same page. Present only there.
        private const val UNINSTALL_BUTTON_ID = ":id/uninstall_button"

        // The page-level toggle bar of a Settings detail screen. A list screen
        // has no such bar by construction, which is the whole reason these are
        // usable as "this is a detail page" evidence. Deliberately NOT
        // `:id/switch_widget`: that is the switch itself, and skins that put a
        // per-row switch on a list use it there too.
        private val DETAIL_SWITCH_BAR_IDS = listOf(
            ":id/main_switch_bar",
            ":id/settings_main_switch_bar",
            ":id/switch_bar"
        )

        // How much of our service description has to be on screen to count.
        // Long enough to be ours beyond coincidence, short enough to survive
        // the description being clipped, collapsed behind a "More", or having
        // its tail edited in a later release.
        const val DESCRIPTION_PREFIX_CHARS = 40
    }

    private val appLabel = appLabel.trim()
    private val serviceLabel = serviceLabel.trim()
    private val descriptionPrefix = serviceDescription.trim().take(DESCRIPTION_PREFIX_CHARS)

    private var sawOurAppInfoHeader = false
    private var sawUninstallButton = false
    private var sawAppLabel = false
    private var sawServiceLabel = false
    private var sawServiceDetailAnchor = false

    /** Whether the nodes fed so far add up to one of the two shapes. */
    var matched: Boolean = false
        private set

    /**
     * Feed one VISIBLE node's text and view id. Returns whether the answer is
     * now settled, so a caller walking a hierarchy can stop early; a caller
     * that walks the whole thing reads `matched` instead. Both are the same
     * answer — this only ever moves from false to true.
     */
    fun observe(text: String?, viewId: String?): Boolean {
        if (matched) return true

        val trimmed = text?.trim()
        val isAppInfoHeader = viewId != null && viewId.endsWith(APP_INFO_HEADER_ID)

        if (!trimmed.isNullOrEmpty()) {
            if (trimmed.equals(appLabel, ignoreCase = true)) {
                sawAppLabel = true
                if (isAppInfoHeader) sawOurAppInfoHeader = true
            }
            if (trimmed.equals(serviceLabel, ignoreCase = true)) sawServiceLabel = true
            if (descriptionPrefix.length >= DESCRIPTION_PREFIX_CHARS &&
                trimmed.startsWith(descriptionPrefix, ignoreCase = true)
            ) {
                sawServiceDetailAnchor = true
            }
        }

        if (viewId != null) {
            if (viewId.endsWith(UNINSTALL_BUTTON_ID)) sawUninstallButton = true
            if (DETAIL_SWITCH_BAR_IDS.any { viewId.endsWith(it) }) sawServiceDetailAnchor = true
        }

        matched = sawOurAppInfoHeader ||
            (sawUninstallButton && sawAppLabel) ||
            (sawServiceLabel && sawServiceDetailAnchor)
        return matched
    }
}

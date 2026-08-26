package uk.co.maybeitssoftware.intention

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * The anti-loop half of the leaving interposition, and the only reason this
 * feature is shippable next to Play's accessibility policy.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A FILE OF ITS OWN
 * ---------------------------------------------------------------------------
 * Interposing means launching OUR activity over the top of the Settings app.
 * Two apps taking turns at owning the foreground of Settings is, precisely,
 * the shape accessibility apps get pulled from Play for, and it is worse than
 * a policy problem: someone who opened Accessibility to set up a screen reader
 * and cannot get a window of ours to stay away is trapped in the one place
 * they went for help. So "it can only happen once, and then not again for a
 * quarter of an hour" is not a nicety. It is the property to point a reviewer
 * at, and a property nobody can read back in a test is one that drifts.
 * Everything that decides it therefore lives here, pure, in one place.
 *
 * ---------------------------------------------------------------------------
 * DURABLE, BECAUSE THE PROCESS IS NOT
 * ---------------------------------------------------------------------------
 * An AccessibilityService process is restarted by Android routinely — on an
 * app update, on a low-memory kill, on the user toggling the service, on
 * "Restart accessibility apps" — and none of those are events the user
 * caused or noticed. A debounce held in a field of the service is therefore
 * not a debounce at all; it is a debounce that any of a dozen ordinary system
 * events silently sets back to zero, and the loop it was supposed to prevent
 * comes back with it. Every floor here is written to the same shared prefs the
 * browser build writes, through the same encoder, and read back on each check.
 *
 * ---------------------------------------------------------------------------
 * THE SAME TWO FLOORS THE BROWSER HAS
 * ---------------------------------------------------------------------------
 * `allows` mirrors leaveInterposeAllowed() in shared/background.js key for key
 * and number for number — same stored keys, same order, same comparisons, one
 * documented addition (blockedApps, see `allows`). The two floors it reads:
 *
 *   INTERPOSE_DEBOUNCE_MS  ten minutes between interpositions with no
 *                          conversation had at all — someone walking in and
 *                          out of a Settings page.
 *   STAND_DOWN_MS          fifteen minutes of silence after the conversation,
 *                          however it ended.
 *
 * `interpositionPatch` is NOT a key-for-key mirror of the browser's
 * interposeOnRemovalSurface(), and the difference is the subject of the next
 * section. The JS writes one key, `leaveInterposedAt`; this writes that AND a
 * fifteen-minute `leaveStandDown` up front. Both keys are read and written by
 * the shared JS as well, so the state the two platforms leave behind is not
 * identical and a reader must not assume it is.
 *
 * The values are repeated rather than read across the bridge because they are
 * caps as much as settings: `until - now <= STAND_DOWN_MS` is what stops a
 * clock jump or a hand-edited prefs file writing a silence that outlives its
 * own length. Change one, change both.
 *
 * ---------------------------------------------------------------------------
 * A BACK PRESS IS AN OUTCOME
 * ---------------------------------------------------------------------------
 * On the web the stand-down is written by the conversation itself — every exit
 * from the gate modal calls beginLeave(), including a decline. Here it cannot
 * be: our activity is launched over Settings and the ordinary way to be rid of
 * it is the system Back button, which finishes it without the page ever
 * hearing about it. Deliberately so — see the head of the leaving section in
 * IntentionAccessibilityService.kt for why we refuse to fight the user for the
 * Back button. But a conversation that was shown and dismissed IS an outcome,
 * and the browser's promise is fifteen minutes after every outcome.
 *
 * So the stand-down is bought UP FRONT, by `interpositionPatch`, at the moment
 * we decide to launch — not collected afterwards from a lifecycle callback
 * that a Back press, a process death or a force-stop can each skip. Paying
 * before the show also means an activity that fails to start still spends the
 * silence: something we could not launch is not a reason to try again on the
 * next window change. If the conversation does run to a proper end, its own
 * beginLeave() overwrites this with fifteen minutes counted from THEN, which
 * is strictly later. There is no ordering in which the user gets less silence
 * than the browser build would have given them.
 *
 * That extra `leaveStandDown` write is therefore the one deliberate divergence
 * from interposeOnRemovalSurface(), which writes `leaveInterposedAt` alone.
 * The browser does not need it because closing the leave tab is not how that
 * conversation ends — beginLeave() runs on every exit from the modal — where
 * here the ordinary way to be rid of our activity is a Back press nothing
 * hears. Same promise, one more key, because the platform gives us no callback
 * to make the promise with. Keeping it means the Android build silences itself
 * in a case the browser build does not: a shown-and-dismissed conversation.
 * That is the intended reading of "fifteen minutes after every outcome", and
 * erring towards silence is the direction that cannot trap anyone.
 */
object LeavePolicy {

    private const val TAG = "IntentionLeavePolicy"

    // Mirrors LEAVE_STAND_DOWN_MS in shared/background.js.
    const val STAND_DOWN_MS = 15 * 60 * 1000L

    // Mirrors LEAVE_INTERPOSE_DEBOUNCE_MS in shared/background.js. Ten
    // minutes, not the thirty seconds this used to be: thirty seconds is a
    // rate limit, and what is needed here is a floor a person feels.
    const val INTERPOSE_DEBOUNCE_MS = 10 * 60 * 1000L

    // Exactly the keys background.js reads for the same decision, plus
    // blockedApps. Requested by name rather than reading the whole prefs file
    // so the read stays cheap enough to sit in front of the node walk.
    private val STATE_KEYS = listOf(
        "setupComplete",
        "blockedDomains",
        "blockedApps",
        "leaveStandDown",
        "leaveInterposedAt",
        "leaveRequest"
    )

    /**
     * Every reason Intention stays quiet, from the stored state alone. Pure,
     * for the reason given at the head of this file.
     *
     * One deliberate difference from the JS, and only one: it counts blocked
     * APPS as well as blocked domains. The rule being mirrored is "an empty
     * blocklist means nothing is being enforced, so there is nothing to have a
     * conversation about", and on a phone the blocklist is mostly apps — an
     * Android user who blocks four apps and no websites is emphatically not
     * someone who has already left.
     */
    fun allows(state: JSONObject?, now: Long): Boolean {
        try {
            if (state == null) return false

            // Before setup there is nothing to leave, and an empty blocklist
            // means nothing is being enforced. A user who has removed every
            // site and app has already effectively left; pestering them about
            // it would be absurd.
            if (!state.optBoolean("setupComplete", false)) return false
            val listed = (state.optJSONArray("blockedDomains")?.length() ?: 0) +
                (state.optJSONArray("blockedApps")?.length() ?: 0)
            if (listed == 0) return false

            // A conversation already happened, whatever way it ended —
            // including being dismissed with Back, which is why this is
            // written at launch rather than collected afterwards.
            val standDownUntil = state.optJSONObject("leaveStandDown")?.optLong("until", 0L) ?: 0L
            if (standDownUntil > now && standDownUntil - now <= STAND_DOWN_MS) return false

            // They asked, and the coach agreed. Whether the cool-off is still
            // running or has run out, the answer was yes — asking someone to
            // justify a decision we have already accepted is the loop this
            // must never become.
            val availableAt = state.optJSONObject("leaveRequest")?.optLong("availableAt", 0L) ?: 0L
            if (availableAt > 0L) return false

            // The plain debounce, for a visit with no conversation at all. A
            // timestamp in the future (the clock moved back) does not count,
            // or it would silence the feature until the clock caught up.
            val last = state.optLong("leaveInterposedAt", 0L)
            if (last > 0L && now >= last && now - last < INTERPOSE_DEBOUNCE_MS) return false

            return true
        } catch (e: Exception) {
            return false
        }
    }

    /** The same question, against the live shared storage. */
    fun allows(context: Context, now: Long): Boolean = try {
        allows(read(context), now)
    } catch (e: Exception) {
        // Unreadable state means we do nothing, which is the direction every
        // other failure in the leaving flow takes: the cost is a conversation
        // that did not happen, and the user was on their way to Settings to
        // end the relationship anyway.
        Log.e(TAG, "Could not read the leaving state; staying quiet: ", e)
        false
    }

    /**
     * What an interposition spends, as a storage patch. Pure, so the anti-loop
     * property can be asserted end to end — write this, ask `allows` again —
     * without a device.
     *
     * TWO keys, where shared/background.js's interposeOnRemovalSurface() sets
     * only `leaveInterposedAt`. The second, `leaveStandDown`, is bought up
     * front because a Back press ends the conversation here without anything
     * being able to record it — see A BACK PRESS IS AN OUTCOME at the head of
     * this file. It is a deliberate divergence, not a mirror; both keys are
     * also read and written by the shared JS, so the two platforms do not
     * leave identical state behind after an interposition.
     *
     * `declined` is the outcome recorded because it is what background.js's
     * beginLeave() records for anything that is not one of its four known
     * outcomes, and a dismissal is exactly that: a conversation that ended
     * with the user staying. Writing a name the JS does not know would put a
     * value in shared storage that no reader on the other platform accounts
     * for.
     */
    fun interpositionPatch(now: Long): JSONObject = JSONObject()
        .put("leaveInterposedAt", now)
        .put(
            "leaveStandDown",
            JSONObject().put("until", now + STAND_DOWN_MS).put("reason", "declined")
        )

    /**
     * Spend it, durably, BEFORE the activity is launched.
     *
     * Straight through BackgroundJsHelper's encoder rather than to prefs by
     * hand: it is the one definition of how a value is shaped in storage, and
     * these two keys are read back by the shared JS as well as by us.
     */
    fun recordInterposition(context: Context, now: Long) {
        BackgroundJsHelper.setSharedStorage(context, interpositionPatch(now).toString())
    }

    private fun read(context: Context): JSONObject = JSONObject(
        BackgroundJsHelper.getSharedStorage(context, JSONArray(STATE_KEYS).toString())
    )
}

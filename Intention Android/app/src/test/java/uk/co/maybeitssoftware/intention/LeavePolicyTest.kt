package uk.co.maybeitssoftware.intention

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The anti-loop property, asserted end to end.
 *
 * This is the test to point at if a Play reviewer asks how often Intention can
 * put a window over the Settings app. Everything it asserts is decided from
 * DURABLE state and nothing else, which is the fix: the floor used to be a
 * plain field on the accessibility service, so every one of the many ordinary
 * reasons Android restarts that process reset it to zero.
 */
class LeavePolicyTest {

    private val NOW = 1_700_000_000_000L

    private fun live(): JSONObject = JSONObject()
        .put("setupComplete", true)
        .put("blockedApps", JSONArray().put("com.instagram.android"))

    /** Apply a storage patch the way BackgroundJsHelper would, and read it back. */
    private fun applied(state: JSONObject, patch: JSONObject): JSONObject {
        val keys = patch.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            state.put(k, patch.get(k))
        }
        return state
    }

    // ---- The durable debounce and stand-down ------------------------------

    @Test
    fun anInterpositionSilencesTheNextOne() {
        val after = applied(live(), LeavePolicy.interpositionPatch(NOW))
        assertFalse("one second later", LeavePolicy.allows(after, NOW + 1_000L))
        assertFalse("thirty-one seconds later", LeavePolicy.allows(after, NOW + 31_000L))
        assertFalse("nine minutes later", LeavePolicy.allows(after, NOW + 9 * 60_000L))
    }

    @Test
    fun theStandDownOutlastsTheDebounce() {
        // A Back press is an outcome, and the browser's promise is fifteen
        // minutes after every outcome — not the ten of the plain debounce.
        val after = applied(live(), LeavePolicy.interpositionPatch(NOW))
        assertFalse(
            "the ten-minute debounce has lapsed but the stand-down has not",
            LeavePolicy.allows(after, NOW + LeavePolicy.INTERPOSE_DEBOUNCE_MS + 1)
        )
        assertFalse(LeavePolicy.allows(after, NOW + LeavePolicy.STAND_DOWN_MS - 1))
        assertTrue(
            "and then it lapses, rather than being permanent",
            LeavePolicy.allows(after, NOW + LeavePolicy.STAND_DOWN_MS + 1)
        )
    }

    @Test
    fun aServiceRestartChangesNothing() {
        // The whole decision is a function of stored state, so "a fresh
        // process" is the same call with nothing in memory. This is the
        // assertion the old in-memory field could not have passed.
        val stored = applied(live(), LeavePolicy.interpositionPatch(NOW)).toString()
        val reread = JSONObject(stored)
        assertFalse(LeavePolicy.allows(reread, NOW + 1_000L))
    }

    @Test
    fun aBareInterposedStampIsHonoured() {
        // Without the stand-down half — i.e. exactly what shared/background.js
        // writes on the web — the ten-minute debounce still holds on its own.
        val state = live().put("leaveInterposedAt", NOW)
        assertFalse(LeavePolicy.allows(state, NOW + 1_000L))
        assertFalse(LeavePolicy.allows(state, NOW + LeavePolicy.INTERPOSE_DEBOUNCE_MS - 1))
        assertTrue(LeavePolicy.allows(state, NOW + LeavePolicy.INTERPOSE_DEBOUNCE_MS))
    }

    @Test
    fun aStampInTheFutureDoesNotSilenceUsForever() {
        // The clock moved back. Honouring the stamp would mute the feature
        // until real time caught up with it.
        val state = live().put("leaveInterposedAt", NOW + 5 * 60_000L)
        assertTrue(LeavePolicy.allows(state, NOW))
    }

    @Test
    fun anAbsurdStandDownIsCapped() {
        val state = live().put("leaveStandDown", JSONObject().put("until", NOW + 400L * 24 * 3600_000L))
        assertTrue("a hand-edited value cannot buy a silence longer than its own length",
            LeavePolicy.allows(state, NOW))
    }

    @Test
    fun theInterpositionPatchWritesTwoKeysNotOne() {
        // Pinned because the header used to claim this file mirrored
        // shared/background.js's interposeOnRemovalSurface() "key for key",
        // and it does not: that function writes leaveInterposedAt alone, and
        // this buys the stand-down up front as well because a Back press ends
        // the conversation here with nothing able to record it. The divergence
        // is deliberate and documented; what must not happen is a reader
        // assuming the two platforms leave identical state behind. If this
        // ever legitimately becomes one key, the header changes with it.
        val patch = LeavePolicy.interpositionPatch(NOW)
        assertEquals(setOf("leaveInterposedAt", "leaveStandDown"), patch.keys().asSequence().toSet())
        assertEquals(NOW, patch.getLong("leaveInterposedAt"))
        assertEquals(NOW + LeavePolicy.STAND_DOWN_MS, patch.getJSONObject("leaveStandDown").getLong("until"))
    }

    @Test
    fun theRecordedOutcomeIsOneTheSharedCodeKnows() {
        // background.js's beginLeave() normalises anything it does not
        // recognise to 'declined'; writing a name it has never heard of would
        // put a value in shared storage no reader on the other platform
        // accounts for.
        val patch = LeavePolicy.interpositionPatch(NOW)
        assertTrue(patch.getJSONObject("leaveStandDown").getString("reason") == "declined")
    }

    // ---- Every other reason we stay quiet ---------------------------------

    @Test
    fun aLiveBlocklistAfterSetupIsTheOneCaseThatAllows() {
        assertTrue(LeavePolicy.allows(live(), NOW))
    }

    @Test
    fun beforeSetupThereIsNothingToLeave() {
        assertFalse(LeavePolicy.allows(live().put("setupComplete", false), NOW))
    }

    @Test
    fun anEmptyBlocklistMeansTheyHaveAlreadyLeft() {
        val state = JSONObject()
            .put("setupComplete", true)
            .put("blockedApps", JSONArray())
            .put("blockedDomains", JSONArray())
        assertFalse(LeavePolicy.allows(state, NOW))
    }

    @Test
    fun blockedAppsCountEvenWithNoBlockedSites() {
        // The one deliberate difference from the JS: on a phone the blocklist
        // is mostly apps.
        val state = JSONObject()
            .put("setupComplete", true)
            .put("blockedDomains", JSONArray())
            .put("blockedApps", JSONArray().put("com.instagram.android"))
        assertTrue(LeavePolicy.allows(state, NOW))
    }

    @Test
    fun anAgreedLeaveRequestEndsTheConversationForGood() {
        val state = live().put("leaveRequest", JSONObject().put("availableAt", NOW - 1))
        assertFalse(LeavePolicy.allows(state, NOW))
        assertFalse(LeavePolicy.allows(state, NOW + 365L * 24 * 3600_000L))
    }

    @Test
    fun unreadableStateStaysQuiet() {
        assertFalse(LeavePolicy.allows(null, NOW))
    }
}

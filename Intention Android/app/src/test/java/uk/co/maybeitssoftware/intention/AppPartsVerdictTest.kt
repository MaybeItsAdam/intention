package uk.co.maybeitssoftware.intention

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of the "block only Reels" decision.
 *
 * The first group is the one that matters: an 'only' rule this build cannot
 * evaluate used to answer "not gated", so `only: ["reddit:sub:rust"]` on
 * com.reddit.frontpage — a package APP_PARTS has no entry for at all — opened
 * Reddit without a walk ever being attempted. One line in stored state was a
 * whole app unblocked. See the DEGRADATION section at the head of AppParts.kt.
 *
 * The second group is the same hole through the other door: an 'only' rule the
 * build CAN evaluate, on a screen it did not recognise, used to open too — and
 * with a table that is unverified on every signal, that is the common case
 * rather than the rare one. Both now gate.
 */
class AppPartsVerdictTest {

    private fun only(vararg parts: String) = AppParts.PartRule(AppParts.SCOPE_ONLY, parts.toList())
    private fun except(vararg parts: String) = AppParts.PartRule(AppParts.SCOPE_EXCEPT, parts.toList())

    // ---- A rule this build can never evaluate is refused whole -------------

    @Test
    fun onlyRuleOnAPackageWithNoTableEntryGates() {
        val v = AppParts.verdict(only("reddit:sub:rust"), "com.reddit.frontpage", null)
        assertTrue("an only-rule we can never evaluate must gate", v.gated)
        assertTrue(v.degraded)
    }

    @Test
    fun exceptRuleOnAPackageWithNoTableEntryGates() {
        val v = AppParts.verdict(except("reddit:sub:rust"), "com.reddit.frontpage", null)
        assertTrue(v.gated)
        assertTrue(v.degraded)
    }

    @Test
    fun oneUnknownPartPoisonsTheWholeRule() {
        // The screen IS recognised, and is not the part they narrowed to. The
        // old code filtered the rule down to its detectable ids and answered
        // "not gated, not degraded" — confidently wrong, and invisible to the
        // miss counter.
        val v = AppParts.verdict(
            only("instagram:reels", "instagram:notes"),
            "com.instagram.android",
            "instagram:dms"
        )
        assertTrue("a rule naming a part we can never see must gate", v.gated)
        assertTrue("and must be counted, so the user is told", v.degraded)
    }

    @Test
    fun aPathRuleWrittenOnTheWebGates() {
        val v = AppParts.verdict(only("path:/watch"), "com.google.android.youtube", "youtube:home")
        assertTrue(v.gated)
        assertTrue(v.degraded)
    }

    // ---- An evaluable rule still behaves exactly as documented ------------

    @Test
    fun noRuleGatesEverything() {
        val v = AppParts.verdict(AppParts.PartRule(AppParts.SCOPE_ALL, emptyList()), "com.instagram.android", null)
        assertTrue(v.gated)
        assertFalse(v.degraded)
    }

    @Test
    fun onlyGatesTheNarrowedPart() {
        val v = AppParts.verdict(only("instagram:reels"), "com.instagram.android", "instagram:reels")
        assertTrue(v.gated)
        assertFalse(v.degraded)
        assertEquals("instagram:reels", v.partId)
    }

    @Test
    fun onlyLetsEverythingElseThrough() {
        val v = AppParts.verdict(only("instagram:reels"), "com.instagram.android", "instagram:dms")
        assertFalse(v.gated)
        assertFalse(v.degraded)
    }

    @Test
    fun exceptLetsTheCarvedOutPartThrough() {
        val v = AppParts.verdict(except("instagram:dms"), "com.instagram.android", "instagram:dms")
        assertFalse(v.gated)
        assertFalse(v.degraded)
    }

    @Test
    fun exceptGatesEverythingElse() {
        val v = AppParts.verdict(except("instagram:dms"), "com.instagram.android", "instagram:reels")
        assertTrue(v.gated)
        assertFalse(v.degraded)
    }

    // ---- An evaluable rule on an unrecognised screen gates, both scopes ----

    @Test
    fun onlyFailsClosedWhenTheScreenItselfIsUnrecognised() {
        // Every id in this rule is one we could produce; we simply could not
        // see it on this screen. This used to answer "not gated" on the
        // argument that a miss is rare — but APP_PARTS ships UNVERIFIED on
        // every signal, so a miss is the NORMAL answer, and "block only Reels"
        // meant an Instagram that was never blocked at all. The gate is the
        // coach, so this is not a trap: there is a way through it and, from
        // the same screen, a way to change the rule.
        val v = AppParts.verdict(only("instagram:reels"), "com.instagram.android", null)
        assertTrue("an only-rule we could not resolve on this screen must gate", v.gated)
        assertTrue(v.degraded)
        assertFalse("we could have recognised it; we just did not, here", v.refused)
    }

    @Test
    fun exceptStillFailsClosedWhenTheScreenIsUnrecognised() {
        val v = AppParts.verdict(except("instagram:dms"), "com.instagram.android", null)
        assertTrue(v.gated)
        assertTrue(v.degraded)
        assertFalse(v.refused)
    }

    @Test
    fun theTwoDegradationPathsAgree() {
        // The property the header now claims: nothing in this file answers
        // "we could not tell" by opening an app. Both causes, both scopes.
        for (rule in listOf(only("instagram:reels"), except("instagram:dms"))) {
            assertTrue(
                "screen unrecognised, scope ${rule.scope}",
                AppParts.verdict(rule, "com.instagram.android", null).gated
            )
        }
        for (rule in listOf(only("instagram:notes"), except("instagram:notes"))) {
            assertTrue(
                "rule unevaluable, scope ${rule.scope}",
                AppParts.verdict(rule, "com.instagram.android", null).gated
            )
        }
    }

    // ---- `refused` names the cause, so the gate can say the right thing ----

    @Test
    fun anUnevaluableRuleIsMarkedRefused() {
        // Same gate, different admission: a part this build can never see will
        // not start working after the next app update, where a screen we
        // missed may. CoachingActivity picks its line off this flag.
        assertTrue(AppParts.verdict(only("instagram:notes"), "com.instagram.android", null).refused)
        assertTrue(AppParts.verdict(except("instagram:notes"), "com.instagram.android", null).refused)
        assertTrue(AppParts.verdict(only("reddit:sub:rust"), "com.reddit.frontpage", null).refused)
    }

    @Test
    fun aResolvedVerdictIsNeitherDegradedNorRefused() {
        // The gate stays silent about parts for everyone whose rules work.
        val v = AppParts.verdict(only("instagram:reels"), "com.instagram.android", "instagram:reels")
        assertFalse(v.degraded)
        assertFalse(v.refused)
    }
}

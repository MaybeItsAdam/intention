package uk.co.maybeitssoftware.intention

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

/**
 * In-app section detection: "is this the Reels tab or the DM inbox?"
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS ALLOWED TO DO, AND WHAT IT MUST NEVER DO
 * ---------------------------------------------------------------------------
 * This is the only place in Intention that looks at another app's view
 * hierarchy for anything other than a browser address bar, so the boundary is
 * written down here rather than assumed:
 *
 *   * The rule table below is STATIC and ships in the APK. Play's
 *     AccessibilityService policy requires the automation to be deterministic
 *     and rule-based, and that is the whole reason this file is a `Map` of
 *     literals rather than anything cleverer.
 *   * The coach NEVER reads an accessibility node, and NEVER drives an
 *     accessibility action. The model is not asked what to look for, is not
 *     shown a node, and cannot press anything. The service answers exactly one
 *     question — "which section is on screen?" — and hands back a string id
 *     from the fixed vocabulary below. Nothing else crosses the line.
 *   * Nothing detected here leaves the device. The miss counter written by
 *     `recordMiss` is local SharedPreferences, read only by our own settings
 *     screen. PRIVACY.md holds unchanged.
 *
 * If a future change lets the model choose what to look for, or lets anything
 * here call `performAction`, the app becomes removable from Play. That is not
 * a style rule.
 *
 * The Play Permissions Declaration Form must describe this use before the next
 * `publish-android.yml` run. Shipping the APK without it is the release
 * blocker, not the code.
 *
 * ---------------------------------------------------------------------------
 * ONE VOCABULARY WITH THE WEB
 * ---------------------------------------------------------------------------
 * Every id in APP_PARTS is a part id from `shared/parts.js`'s PART_CATALOGUE —
 * `instagram:reels`, `youtube:shorts`, and so on — because the settings UI
 * offers one list of parts for a service and resolves an Android package onto
 * its website through `serviceKeyFor()` (shared/sites.js). A rule the user
 * writes once as "only Reels" has to mean the same thing in Chrome and in the
 * Instagram app, or the row in Settings is describing a rule that only half
 * works. If you add a part here, it must already exist there; if the two lists
 * disagree, this file is the one that is wrong.
 *
 * ---------------------------------------------------------------------------
 * DEGRADATION — THE PART A READER WILL OTHERWISE GET BACKWARDS
 * ---------------------------------------------------------------------------
 * The view ids below are internal to Instagram and YouTube. They are not a
 * public API, they are not versioned, and they change without notice — the
 * same concession `BROWSER_URL_BAR_IDS` already makes about `url_bar`, except
 * that Instagram ships very much more often than Chrome renames its omnibox.
 * Detection failing is therefore not an edge case here. It is a scheduled
 * event, and the only question that matters is what happens on that day.
 *
 * There are TWO different failures hiding under "we could not tell". Both now
 * gate, so the ANSWER is the same; they are kept apart because the two have
 * different causes, are counted separately, and are described to the user in
 * different words. What is never different is the direction — nothing in this
 * file answers "we could not tell" by opening an app, because doing that once
 * is what let an app open on its own.
 *
 * (1) THE RULE ITSELF CANNOT BE EVALUATED BY THIS BUILD — it names a part id
 *     that is not in APP_PARTS for this package at all: `reddit:sub:rust` on
 *     com.reddit.frontpage, a `path:` rule written on the web, a part added to
 *     the catalogue by a newer version of the extension than this APK. There
 *     is no screen anywhere in that app that we would ever answer with, so
 *     detection is not "failing" — it was never going to run.
 *
 *     BOTH SCOPES FAIL CLOSED. The rule is refused whole and the target
 *     reverts to "block all of it".
 *
 *     This is the direction a reader will otherwise get backwards, so the
 *     reasoning is spelled out rather than assumed. Intention is a
 *     self-control product: the person it protects is the same person who, in
 *     a weak moment, will look for the cheapest way around it. "Block only
 *     r/rust" typed into a rule for an app we cannot see inside of must not be
 *     a one-line route to an unblocked Reddit — and if the safe direction
 *     were ever in doubt, the tie is broken by which failure the user can SEE.
 *     A whole app that stays blocked is noticed within seconds and is one tap
 *     from being fixed. An app that quietly opens announces nothing; the
 *     blocklist has stopped working and the only person who could tell is the
 *     one it has stopped working for.
 *
 * (2) THE RULE IS EVALUABLE BUT THIS SCREEN WAS NOT RECOGNISED — every id in
 *     the rule is one this build can produce, we walked the hierarchy, and
 *     nothing matched (or two things matched and the answer was ambiguous).
 *     This is Instagram having shipped a release, which is routine rather than
 *     exceptional.
 *
 *     BOTH SCOPES FAIL CLOSED, exactly as in (1). "We could not tell what this
 *     screen is" gates.
 *
 *   scope "except" -> the easy half. The user said "block everything except
 *                     DMs". If we cannot prove this screen is DMs, it is not
 *                     DMs. The cost is an unnecessary gate on the one surface
 *                     they carved out; the cost of the other choice is the
 *                     whole app unblocked.
 *
 *   scope "only"   -> this used to FAIL OPEN, on the argument that we DO know
 *                     what Reels looks like and gating the whole app takes
 *                     away DMs nobody asked us to touch. That argument assumed
 *                     a table that mostly works, with a miss as the rare
 *                     exception. This table is UNVERIFIED on every signal (see
 *                     the section at the foot of this header), so until a
 *                     device pass lands the rare exception IS the normal case:
 *                     "block only Reels" would have meant an Instagram that is
 *                     never blocked at all — the silent-open failure this file
 *                     spends two paragraphs above arguing is the unacceptable
 *                     one. It cannot be unacceptable in (1) and fine here.
 *
 *                     Failing closed is safe rather than a trap for the same
 *                     reason it is safe for "except": a blocked app still
 *                     opens the COACH. There is always a way through it and,
 *                     from the same screen, a way to change the rule. Nobody
 *                     is shut out; the worst case is a conversation they did
 *                     not expect to have.
 *
 * So both cases now agree with `resolvePartVerdict` in shared/parts.js, which
 * has always failed closed in both directions. The two platforms answer "we
 * could not evaluate this" the same way, and there is no scope-shaped hole
 * left in either.
 *
 * Fail-closed is only honest if it is LOUD, because with an unproven table
 * "block only Reels" behaves as "block Instagram" and the user is entitled to
 * know that is what is happening. It is said in two places. Every unresolved
 * check increments a per-target counter (`recordMiss`), and MainActivity puts
 * a card in front of the user once it passes MISS_WARNING_THRESHOLD inside
 * MISS_WINDOW_MS, offering to turn the rule back into "block all of it" for
 * good. But that card lives inside the app they are deliberately not opening,
 * so the gate itself says it too: when a verdict is `degraded`, CoachingActivity
 * puts one line above the coach naming why the whole app is blocked. That is
 * the moment it matters — they are looking at a block they expected to be let
 * through.
 *
 * The settings UI only offers part rules for packages this table covers, so a
 * case (1) rule should not be writable from inside the app at all. It is
 * defended against here anyway, because storage is older than the UI that
 * validates it: a rule can arrive from a device-transfer backup, from a
 * version of the catalogue this APK predates, or from someone editing prefs.
 *
 * ---------------------------------------------------------------------------
 * EVERY ID BELOW NEEDS A DEVICE PASS
 * ---------------------------------------------------------------------------
 * None of the view ids or content descriptions in this file have been
 * confirmed on a device. Each signal carries an `evidence` string naming the
 * app and Android version it is believed correct for; `dumpNodeSignals()`
 * exists so the confirmation takes ten minutes rather than an afternoon. Until
 * that pass happens, assume the table is wrong and let the degradation rules
 * above carry the feature.
 */
object AppParts {

    private const val TAG = "IntentionAppParts"
    private const val PREFS_NAME = "intention_prefs"

    // The bounded walk. `MAX_NODES` counts every node we obtain a handle to,
    // not just the ones we look at, because `getChild()` is the expensive half
    // — it crosses into the other app's process. 400 covers a bottom nav plus
    // the visible page of a feed on a phone; 12 levels covers a tab host
    // wrapping a fragment wrapping a RecyclerView wrapping a row. Both are
    // deliberately too small to walk a long list, which is the point: the cost
    // of this check has to be a constant a user never feels.
    const val MAX_NODES = 400
    const val MAX_DEPTH = 12

    // Mirrors PART_LIST_MAX in shared/parts.js. Change one, change both.
    private const val PART_LIST_MAX = 20
    private const val PART_ID_MAX = 96

    // Scope values, spelled exactly as shared/parts.js writes them.
    const val SCOPE_ALL = "all"
    const val SCOPE_ONLY = "only"
    const val SCOPE_EXCEPT = "except"

    // The miss counter, and when it becomes a card in the user's face. Five is
    // past coincidence — a single unlucky check while a screen is still
    // animating is not a broken table — and seven days is long enough that a
    // rule used twice a week still reports, short enough that misses from an
    // app version two updates ago do not keep an old warning alive.
    const val MISS_WARNING_THRESHOLD = 5
    const val MISS_WINDOW_MS = 7L * 24 * 60 * 60 * 1000
    private const val MISSES_KEY = "partDetectionMisses"

    /**
     * How much a matched signal is worth. Ranked strongest first, so a lower
     * ordinal wins.
     *
     * SURFACE beats TAB on purpose. A container that only exists while a
     * surface is on screen (the Reels pager, the DM thread list) is present
     * exactly when that surface is; a bottom-nav selection is a claim about
     * where the user last was, and it stays behind while a full-screen player
     * is opened over the top of it. When YouTube's Shorts player is up with
     * the Home tab still lit, the player is telling the truth.
     */
    private enum class Strength { SURFACE, TAB, WEAK }

    /**
     * One way of recognising one part.
     *
     * A part may have several signals (Reels is both "the clips pager is on
     * screen" and "the clips tab is selected"); each is a separate entry, and
     * the strongest match across the whole walk decides. Keep the kinds
     * unmixed within a signal — view ids in one, descriptions in another —
     * because `strength` is a property of the signal, not of which field
     * happened to match.
     *
     *   viewIds              bare ids; the walk prefixes them with
     *                        "<package>:id/" itself.
     *   contentDescriptions  anchored, case-insensitive regexes. Content
     *                        descriptions are the most stable of the three
     *                        signals — the app maintains them as accessibility
     *                        labels — but they are LOCALISED, so a device in
     *                        any other language misses every one of them and
     *                        degrades per the rules at the head of this file.
     *   requireSelected      for bottom-nav tabs: the node existing proves
     *                        nothing (the Reels tab is on screen while you
     *                        read your DMs), only its being selected does.
     *   evidence             where this came from and what it was believed
     *                        correct for. Mandatory. An id with no provenance
     *                        is a guess nobody can later check.
     */
    private data class PartSignal(
        val partId: String,
        val evidence: String,
        val viewIds: List<String> = emptyList(),
        val contentDescriptions: List<Regex> = emptyList(),
        val requireSelected: Boolean = false
    ) {
        val strength: Strength
            get() = when {
                requireSelected -> Strength.TAB
                viewIds.isNotEmpty() -> Strength.SURFACE
                else -> Strength.WEAK
            }
    }

    private data class Match(val partId: String, val strength: Strength, val order: Int)

    private fun ci(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE)

    // UNVERIFIED, all of it. See the header. The shorthand in each `evidence`
    // string is "believed correct for <app version window> on <Android
    // version>, harvested from <where>", and "device pass" means nobody has
    // yet watched this fire on real hardware.
    private const val DEVICE_PASS = "UNVERIFIED — needs a device pass"

    /**
     * The table. Keyed by Android package name; the part ids are
     * shared/parts.js's.
     *
     * Order within a package's list is the tie-break of last resort, so the
     * most specific surfaces come first.
     *
     * Deliberately NOT covered, so that the absence is a decision rather than
     * an oversight — each of these degrades per the scope rules and raises the
     * warning card, which is the honest outcome for a surface we cannot
     * recognise:
     *
     *   com.zhiliaoapp.musically (TikTok) — the app is one endless feed; the
     *     only part worth separating is the DM inbox, and no candidate id for
     *     it survived scrutiny.
     *   com.twitter.android (X), com.facebook.katana (Facebook),
     *   com.linkedin.android (LinkedIn) — no candidate ids at all. Guessing
     *     here would ship a rule that silently never matches, which is worse
     *     than none: the user believes a part is blocked and it is not.
     *   com.reddit.frontpage (Reddit) — `reddit:sub:<name>` is the part people
     *     actually want, and a subreddit name is not reliably in the view
     *     hierarchy at all. The catalogue's fixed Reddit parts (home, popular,
     *     all) are not worth the false positives on their own.
     */
    private val APP_PARTS: Map<String, List<PartSignal>> = mapOf(
        // ---- Instagram ----------------------------------------------------
        // A naming trap worth stating out loud, because getting it backwards
        // silently swaps two parts: inside Instagram, "clips" means REELS and
        // "reel" means STORIES. Anything matching `reel_viewer_*` is the
        // stories viewer. Anything matching `clips_*` is Reels.
        "com.instagram.android" to listOf(
            PartSignal(
                partId = "instagram:reels",
                evidence = "$DEVICE_PASS — Instagram's Reels player container; believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("clips_viewer_view_pager", "clips_viewer_media_container", "clips_video_container")
            ),
            PartSignal(
                partId = "instagram:stories",
                evidence = "$DEVICE_PASS — Instagram's stories viewer ('reel' is stories here, see note above); believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("reel_viewer_root", "reel_viewer_media_container")
            ),
            PartSignal(
                partId = "instagram:dms",
                evidence = "$DEVICE_PASS — Direct inbox and open thread; believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("direct_inbox_recycler_view", "direct_inbox_view", "direct_thread_view", "row_thread_composer_edittext")
            ),
            PartSignal(
                partId = "instagram:explore",
                evidence = "$DEVICE_PASS — Explore grid; believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("explore_grid", "explore_recycler_view")
            ),
            // The bottom-nav fallbacks. Weaker than the surfaces above, and
            // only counted while the tab is actually selected.
            PartSignal(
                partId = "instagram:reels",
                evidence = "$DEVICE_PASS — bottom-nav clips tab; believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("clips_tab"),
                requireSelected = true
            ),
            PartSignal(
                partId = "instagram:explore",
                evidence = "$DEVICE_PASS — bottom-nav search/explore tab; believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("search_tab"),
                requireSelected = true
            ),
            PartSignal(
                partId = "instagram:feed",
                evidence = "$DEVICE_PASS — bottom-nav home tab; believed correct for Instagram 300–360 on Android 13–15",
                viewIds = listOf("feed_tab"),
                requireSelected = true
            ),
            // English-only, by construction. A localised label is the most
            // stable signal Instagram gives us and the least portable one, so
            // it sits last and never overrules a view id.
            PartSignal(
                partId = "instagram:reels",
                evidence = "$DEVICE_PASS — English accessibility label on the selected Reels tab; misses on every non-English device by design",
                contentDescriptions = listOf(ci("^reels?$")),
                requireSelected = true
            )
        ),

        // ---- YouTube ------------------------------------------------------
        // YouTube's internal name for Shorts is "reel", which collides with
        // Instagram's internal name for Stories. They are different apps and
        // the table is keyed by package, so nothing has to be done about it —
        // but do not carry an id across from one list to the other.
        "com.google.android.youtube" to listOf(
            PartSignal(
                partId = "youtube:shorts",
                evidence = "$DEVICE_PASS — Shorts player fragment; believed correct for YouTube 19.x–20.x on Android 13–15",
                viewIds = listOf("reel_recycler", "reel_player_page_container", "reel_watch_fragment_root")
            ),
            PartSignal(
                partId = "youtube:watch",
                evidence = "$DEVICE_PASS — full watch player; believed correct for YouTube 19.x–20.x on Android 13–15",
                viewIds = listOf("watch_player")
            ),
            PartSignal(
                partId = "youtube:shorts",
                evidence = "$DEVICE_PASS — English label on the selected pivot-bar Shorts tab",
                contentDescriptions = listOf(ci("^shorts$")),
                requireSelected = true
            ),
            PartSignal(
                partId = "youtube:subs",
                evidence = "$DEVICE_PASS — English label on the selected pivot-bar Subscriptions tab",
                contentDescriptions = listOf(ci("^subscriptions$")),
                requireSelected = true
            ),
            PartSignal(
                partId = "youtube:home",
                evidence = "$DEVICE_PASS — English label on the selected pivot-bar Home tab",
                contentDescriptions = listOf(ci("^home$")),
                requireSelected = true
            )
        )
    )

    /** Does this build know how to recognise anything inside this app at all? */
    fun isCovered(packageName: String): Boolean = APP_PARTS.containsKey(packageName)

    /** Can this build ever produce this part id for this package? */
    private fun canDetect(packageName: String, partId: String): Boolean =
        APP_PARTS[packageName]?.any { it.partId == partId } == true

    // =======================================================================
    // THE RULE, AS STORED
    // =======================================================================

    /**
     * A target's part rule, cleaned. Mirrors `sanitizePartRule` in
     * shared/parts.js closely enough that the two must be changed together —
     * the same "change one, change both" discipline rules.js documents at its
     * head, and the reason the JS side is the one to copy from rather than
     * re-derive.
     */
    data class PartRule(val scope: String, val parts: List<String>)

    private val NO_RULE = PartRule(SCOPE_ALL, emptyList())

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * The limits entry for a target. Mirrors `limitEntryFor` in shared/rules.js
     * — domainLimits first, then appLimits, which cannot collide because one is
     * keyed by hostname and the other by package name.
     *
     * These come out of `intention_prefs` in plain JSON form, which is not an
     * accident: `BackgroundJsHelper.setSharedStorage` keeps objects unquoted
     * specifically so this service can read them without the WebView being
     * alive. See its comment.
     */
    private fun limitEntry(context: Context, target: String): JSONObject? {
        val store = prefs(context)
        for (key in listOf("domainLimits", "appLimits")) {
            try {
                val raw = store.getString(key, null) ?: continue
                val entry = JSONObject(raw).optJSONObject(target)
                if (entry != null) return entry
            } catch (e: Exception) {
                Log.e(TAG, "Error reading $key: ", e)
            }
        }
        return null
    }

    fun ruleFor(context: Context, target: String): PartRule = ruleFrom(limitEntry(context, target))

    private fun ruleFrom(entry: JSONObject?): PartRule {
        if (entry == null) return NO_RULE
        try {
            val scope = when (entry.optString("scope")) {
                SCOPE_ONLY -> SCOPE_ONLY
                SCOPE_EXCEPT -> SCOPE_EXCEPT
                else -> return NO_RULE
            }
            val list = entry.optJSONArray("parts") ?: return NO_RULE
            // An over-long list did not come from this extension: every write
            // path on the JS side caps it. Truncating would be the wrong
            // repair — for an 'only' rule the dropped ids are exactly the
            // parts that would then stop being blocked — so an implausible
            // list is refused whole, and the target reverts to "block all of
            // it", which is the same direction every other unanswerable
            // question in this file takes.
            if (list.length() > PART_LIST_MAX) return NO_RULE
            val parts = mutableListOf<String>()
            for (i in 0 until list.length()) {
                val candidate = list.optString(i, "").trim()
                if (candidate.isEmpty() || candidate.length > PART_ID_MAX) continue
                val normalized = if (candidate.startsWith("path:")) candidate else candidate.lowercase()
                if (!parts.contains(normalized)) parts.add(normalized)
            }
            if (parts.isEmpty()) return NO_RULE
            return PartRule(scope, parts)
        } catch (e: Exception) {
            return NO_RULE
        }
    }

    // =======================================================================
    // THE VERDICT
    // =======================================================================

    /**
     * `gated` is the answer — should the coach appear. `partId` is what we
     * decided was on screen, when we decided anything. `degraded` says the
     * answer came from the degradation rules rather than from a recognised
     * surface, which is what the miss counter records — and, since those rules
     * now gate in every direction, it is also what the gate itself has to tell
     * the user about.
     *
     * `refused` splits `degraded` the same way `DetectionWarning.refused`
     * does: true for case (1) at the head of this file (the rule names a part
     * this build can never see), false for case (2) (we could have seen it and
     * did not, here). Both block the whole app, so this changes no decision —
     * it decides which sentence CoachingActivity puts above the coach, because
     * "we cannot recognise the part you chose" and "we could not tell what
     * this screen is" are not the same admission.
     */
    data class PartVerdict(
        val gated: Boolean,
        val partId: String?,
        val scope: String,
        val degraded: Boolean,
        val refused: Boolean = false
    )

    private val GATE_EVERYTHING = PartVerdict(true, null, SCOPE_ALL, false)

    /**
     * The whole decision for one app coming to the foreground.
     *
     * `rootProvider` is a lambda rather than a node so that the overwhelmingly
     * common case — a target with no part rule at all — costs one
     * SharedPreferences read and never touches the view hierarchy. Every
     * untouched blocklist entry behaves exactly as it did before this file
     * existed, at exactly the same cost.
     *
     * Call this on TYPE_WINDOW_STATE_CHANGED, or from a timer. Do NOT call it
     * from TYPE_WINDOW_CONTENT_CHANGED: a scrolling feed emits those
     * continuously, and a 400-node cross-process walk behind each one is a
     * battery complaint and a janky scroll.
     */
    fun verdictForApp(
        context: Context,
        packageName: String,
        rootProvider: () -> AccessibilityNodeInfo?
    ): PartVerdict {
        val rule = ruleFor(context, packageName)
        if (rule.scope == SCOPE_ALL) return GATE_EVERYTHING

        // A rule naming a part this build can never produce is refused whole
        // by verdict() below, and that answer does not depend on what is on
        // screen — so the walk is skipped rather than run and then ignored.
        // Not crossing into another app's process to ask a question we already
        // know the answer to is the right side of the boundary at the head of
        // this file, as well as the cheap side.
        val evaluable = rule.parts.all { canDetect(packageName, it) }

        val detected = if (!evaluable) null else try {
            detectPart(rootProvider(), packageName)
        } catch (e: Exception) {
            // A node handle can go stale between obtaining it and reading it —
            // the window changed underneath us. That is an unresolved check,
            // not a crash, and it degrades like any other.
            Log.e(TAG, "Part detection failed for $packageName: ", e)
            null
        }

        val verdict = verdict(rule, packageName, detected)
        if (verdict.degraded) recordMiss(context, packageName, rule.scope) else clearMisses(context, packageName)
        Log.d(TAG, "Part verdict for $packageName: scope=${verdict.scope} part=${verdict.partId} " +
            "gated=${verdict.gated} degraded=${verdict.degraded} refused=${verdict.refused}")
        return verdict
    }

    /**
     * The pure half, so the decision can be reasoned about (and one day
     * tested) without a device.
     *
     * The four cases, in the order they are asked:
     *   1. No rule — the target's own blocking governs, unchanged.
     *   2. The rule names an id this build can never produce — case (1) at the
     *      head of this file. The rule is refused WHOLE, both scopes, and the
     *      target goes back to being blocked in full.
     *   3. Every id is one we could produce and we recognised the screen —
     *      'only' gates when it is in the list, 'except' when it is not.
     *   4. Every id is one we could produce and we recognised nothing — case
     *      (2) at the head of this file. BOTH scopes gate, and the caller
     *      counts it. 'only' used to open here; with a table that is
     *      unverified on every signal that made "block only Reels" into an
     *      Instagram that never blocks, so it now agrees with 'except' and
     *      with shared/parts.js. Nobody is trapped by it: the gate is the
     *      coach, and the coach is also where the rule can be changed.
     *
     * Case 2 is asked BEFORE the detected part is looked at, and that ordering
     * is the fix to a real hole rather than tidiness. Filtering the rule down
     * to its detectable ids and carrying on meant `only: ["instagram:reels",
     * "instagram:notes"]` answered "not gated, and not degraded either" the
     * moment we recognised any other Instagram surface — a confident wrong
     * answer that did not even reach the miss counter. A rule is honoured as
     * written or it is not honoured at all.
     */
    fun verdict(rule: PartRule, packageName: String, detected: String?): PartVerdict {
        if (rule.scope == SCOPE_ALL) return GATE_EVERYTHING

        // Case 2. Note this deliberately does not distinguish 'only' from
        // 'except': for 'only' the unrecognisable id is a section the user
        // asked us to block and we would never block, and for 'except' it is a
        // section they asked us to allow and we would never allow. Neither
        // rule can be carried out as written, and the one answer that is
        // truthful about that is the one the user already understands — the
        // whole app is blocked, exactly as it was before they narrowed it.
        if (rule.parts.any { !canDetect(packageName, it) }) {
            return PartVerdict(
                gated = true,
                partId = null,
                scope = rule.scope,
                degraded = true,
                refused = true
            )
        }

        if (detected != null) {
            val inList = rule.parts.contains(detected)
            val gated = if (rule.scope == SCOPE_ONLY) inList else !inList
            return PartVerdict(gated, detected, rule.scope, degraded = false)
        }
        // Case 4. Both scopes, one answer: we could not tell what this screen
        // is, so the narrowing cannot be carried out and the target is blocked
        // whole. The scope only changes what the user is told, never whether
        // the coach appears — see the "only" paragraph at the head of this
        // file for why the old fail-open was a silent unblock in practice, and
        // why gating here is not a trap.
        return PartVerdict(
            gated = true,
            partId = null,
            scope = rule.scope,
            degraded = true,
            refused = false
        )
    }

    // =======================================================================
    // THE BOUNDED WALK
    // =======================================================================

    /**
     * Breadth-first, capped at MAX_NODES handles and MAX_DEPTH levels, over
     * the active window. Returns a part id, or null for "could not tell" —
     * which is a real answer here, not an error, and is what the degradation
     * rules act on.
     *
     * Two rules decide between competing matches:
     *
     *   * The strongest signal wins (SURFACE over TAB over WEAK), with table
     *     order as the tie-break within a strength.
     *   * Two DIFFERENT parts matching at the SAME strength is ambiguity, and
     *     ambiguity answers null. design-02 proposed "first in table order
     *     wins"; this departs from it deliberately. A tie means the table is
     *     wrong for this app version, and a confident wrong answer gates the
     *     wrong surface silently, where "could not tell" degrades by a
     *     documented rule and gets counted where the user can see it.
     *
     * Only nodes `isVisibleToUser` count. Fragments that have been navigated
     * away from can linger in the hierarchy, and a DM thread the user left ten
     * minutes ago must not read as "the DM inbox is on screen".
     */
    fun detectPart(root: AccessibilityNodeInfo?, packageName: String): String? {
        val signals = APP_PARTS[packageName] ?: return null
        if (root == null) return null

        var best: Match? = null
        var ambiguous = false
        var obtained = 1
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.addLast(root to 0)

        while (queue.isNotEmpty()) {
            val (node, depth) = queue.removeFirst()

            val match = matchNode(node, packageName, signals)
            if (match != null) {
                val current = best
                when {
                    current == null -> { best = match; ambiguous = false }
                    match.strength.ordinal < current.strength.ordinal -> { best = match; ambiguous = false }
                    match.strength != current.strength -> { /* weaker; ignore */ }
                    match.partId == current.partId -> { /* same answer twice; no new information */ }
                    match.order < current.order -> { best = match; ambiguous = true }
                    else -> ambiguous = true
                }
            }

            if (depth >= MAX_DEPTH) continue
            val childCount = node.childCount
            for (i in 0 until childCount) {
                if (obtained >= MAX_NODES) break
                val child = try { node.getChild(i) } catch (e: Exception) { null } ?: continue
                obtained++
                queue.addLast(child to depth + 1)
            }
        }

        if (ambiguous) {
            Log.d(TAG, "Ambiguous part signals in $packageName — answering 'unknown'")
            return null
        }
        return best?.partId
    }

    private fun matchNode(
        node: AccessibilityNodeInfo,
        packageName: String,
        signals: List<PartSignal>
    ): Match? {
        if (!node.isVisibleToUser) return null

        val rawId = node.viewIdResourceName
        val prefix = "$packageName:id/"
        val viewId = if (rawId != null && rawId.startsWith(prefix)) rawId.substring(prefix.length) else null
        val description = node.contentDescription?.toString()
        if (viewId == null && description.isNullOrEmpty()) return null

        for ((index, signal) in signals.withIndex()) {
            // A tab that exists but is not selected is evidence AGAINST its
            // own surface, never for it — the Reels tab is on screen the whole
            // time you are reading your DMs.
            if (signal.requireSelected && !node.isSelected) continue
            if (viewId != null && signal.viewIds.contains(viewId)) {
                return Match(signal.partId, signal.strength, index)
            }
            if (!description.isNullOrEmpty() &&
                signal.contentDescriptions.any { it.containsMatchIn(description) }
            ) {
                return Match(signal.partId, signal.strength, index)
            }
        }
        return null
    }

    /**
     * The harvesting tool, for the device pass this table is waiting on.
     *
     * Logs every view id, content description and class name in the bounded
     * walk, so an implementer holding a phone can open Instagram's Reels tab,
     * read logcat, and fill in the real ids instead of the believed ones.
     *
     * Guarded on the application being debuggable rather than on
     * `BuildConfig.DEBUG`, because this module does not generate a BuildConfig
     * and adding one would mean touching the Gradle build. A release APK is
     * not debuggable, so this can never run in front of a user — which matters
     * more than usual, since it would otherwise be writing another app's
     * accessibility labels into the system log.
     */
    fun dumpNodeSignals(context: Context, root: AccessibilityNodeInfo?, packageName: String) {
        if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) return
        if (root == null) return
        var obtained = 1
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.addLast(root to 0)
        while (queue.isNotEmpty()) {
            val (node, depth) = queue.removeFirst()
            val id = node.viewIdResourceName
            val desc = node.contentDescription
            if (id != null || !desc.isNullOrEmpty()) {
                Log.d(TAG, "[$packageName] d=$depth id=$id desc=$desc cls=${node.className} " +
                    "selected=${node.isSelected} visible=${node.isVisibleToUser}")
            }
            if (depth >= MAX_DEPTH) continue
            for (i in 0 until node.childCount) {
                if (obtained >= MAX_NODES) break
                val child = try { node.getChild(i) } catch (e: Exception) { null } ?: continue
                obtained++
                queue.addLast(child to depth + 1)
            }
        }
    }

    // =======================================================================
    // THE MISS COUNTER, AND THE WARNING IT EARNS
    // =======================================================================
    //
    // Stored under `partDetectionMisses` in the same prefs the JS layer
    // mirrors into, as
    //
    //   { "<target>": { "count": n, "firstAt": ms, "lastAt": ms, "scope": s } }
    //
    // in plain JSON, the form `BackgroundJsHelper.setSharedStorage` uses for
    // objects. Nothing on the JS side reads it yet; it is written here and
    // read by MainActivity, and it never leaves the device.
    //
    // `scope` is recorded for diagnosis only — the scope as it stood when the
    // misses happened. The warning card reads the LIVE rule instead, because
    // the user may have edited it since and the copy has to describe what is
    // true now.

    @Synchronized
    private fun readMisses(context: Context): JSONObject = try {
        JSONObject(prefs(context).getString(MISSES_KEY, "{}") ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    @Synchronized
    private fun writeMisses(context: Context, misses: JSONObject) {
        prefs(context).edit().putString(MISSES_KEY, misses.toString()).apply()
    }

    /**
     * One unresolved check. The window is rolling rather than cumulative: a
     * run of misses from an app version two updates ago must not keep a
     * warning alive for a table that has since started working again.
     */
    @Synchronized
    fun recordMiss(context: Context, target: String, scope: String) {
        try {
            val misses = readMisses(context)
            val now = System.currentTimeMillis()
            val existing = misses.optJSONObject(target)
            var firstAt = existing?.optLong("firstAt", now) ?: now
            var count = existing?.optInt("count", 0) ?: 0
            if (now - firstAt > MISS_WINDOW_MS) {
                firstAt = now
                count = 0
            }
            misses.put(target, JSONObject().apply {
                put("count", count + 1)
                put("firstAt", firstAt)
                put("lastAt", now)
                put("scope", scope)
            })
            writeMisses(context, misses)
        } catch (e: Exception) {
            Log.e(TAG, "Error recording part-detection miss: ", e)
        }
    }

    /** A check that resolved. Detection works here; forget the run of misses. */
    @Synchronized
    fun clearMisses(context: Context, target: String) {
        try {
            val misses = readMisses(context)
            if (!misses.has(target)) return
            misses.remove(target)
            writeMisses(context, misses)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing part-detection misses: ", e)
        }
    }

    /**
     * What the warning card needs to know.
     *
     * `refused` separates the two degradations the head of this file keeps
     * apart. Both now block the app in full, so it is no longer the
     * consequence that differs — it is the cause, and the repair the user
     * should reach for. A rule naming a part this build can never see is
     * wrong for good and will not start working: the honest advice is to pick
     * a different part or block the app outright. A rule we simply failed to
     * resolve on this screen may well come back on the next app update, so
     * "keep trying" is a real option there. Same counter, same outcome,
     * different advice, which is why the copy still splits.
     */
    data class DetectionWarning(
        val target: String,
        val scope: String,
        val count: Int,
        val refused: Boolean
    )

    /**
     * The worst target currently over the threshold, or null.
     *
     * One card at a time: a user with three narrowed apps and a broken table
     * gets one clear problem to act on rather than a stack of identical
     * warnings, and acting on it surfaces the next.
     */
    fun pendingWarning(context: Context): DetectionWarning? {
        try {
            val misses = readMisses(context)
            val now = System.currentTimeMillis()
            var worst: DetectionWarning? = null
            // A run of misses outlives the rule that caused it: the counter is
            // only ever touched while a part rule is in force, so a user who
            // widens "only Reels" back to "all of Instagram" in Settings would
            // otherwise keep being warned about a rule they no longer have.
            // Collected and cleared after the walk, not during it — removing
            // from a JSONObject while iterating its keys is undefined.
            val stale = mutableListOf<String>()
            val keys = misses.keys()
            while (keys.hasNext()) {
                val target = keys.next()
                val entry = misses.optJSONObject(target) ?: continue
                val count = entry.optInt("count", 0)
                val firstAt = entry.optLong("firstAt", 0L)
                if (count < MISS_WARNING_THRESHOLD) continue
                if (now - firstAt > MISS_WINDOW_MS) continue
                val live = ruleFor(context, target)
                if (live.scope == SCOPE_ALL) { stale.add(target); continue }
                if (worst == null || count > worst.count) {
                    // Derived from the LIVE rule for the same reason `scope`
                    // is: the user may have narrowed or widened it since the
                    // misses were counted, and the card has to describe what
                    // is happening now.
                    val refused = live.parts.any { !canDetect(target, it) }
                    worst = DetectionWarning(target, live.scope, count, refused)
                }
            }
            for (target in stale) clearMisses(context, target)
            return worst
        } catch (e: Exception) {
            Log.e(TAG, "Error reading part-detection misses: ", e)
            return null
        }
    }

    /**
     * The one-tap repair: turn "only Reels" back into "block all of it".
     *
     * Deletes the two keys rather than writing `scope: "all"`, because absence
     * is the third state in this vocabulary on the JS side too — an entry with
     * no `scope` and no `parts` is byte-identical to one written before parts
     * existed, so there is nothing for a later version to migrate or undo.
     *
     * Returns whether anything was actually changed, so the caller can tell a
     * repair from a no-op.
     */
    @Synchronized
    fun blockAllOf(context: Context, target: String): Boolean {
        val store = prefs(context)
        var changed = false
        for (key in listOf("domainLimits", "appLimits")) {
            try {
                val raw = store.getString(key, null) ?: continue
                val map = JSONObject(raw)
                val entry = map.optJSONObject(target) ?: continue
                if (!entry.has("scope") && !entry.has("parts")) continue
                entry.remove("scope")
                entry.remove("parts")
                map.put(target, entry)
                store.edit().putString(key, map.toString()).apply()
                changed = true
            } catch (e: Exception) {
                Log.e(TAG, "Error clearing part rule on $key: ", e)
            }
        }
        clearMisses(context, target)
        return changed
    }
}

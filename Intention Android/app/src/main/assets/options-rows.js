// options-rows.js - the blocked-site / blocked-app row.
//
// One row is a small card that reads top to bottom as a single decision
// getting more specific: WHICH site, HOW it is blocked, HOW MUCH at most, WHEN
// the coach stops being lenient, and WHY you set it up. Every control on it
// obeys one rule - tightening saves itself, loosening has to be argued with the
// coach first (applyOrGate in options.js) - which is why they are built here
// together rather than wherever each happens to be rendered.

// ---- The blocked-site / blocked-app row ------------------------------------
//
// A row is a small card, and it reads top to bottom as one decision getting
// more specific: WHICH site, HOW it's blocked, HOW MUCH at most, WHEN the
// coach stops being lenient, and WHY you set it up in the first place.
//
// The head is identity and the one switch that changes everything under it —
// a brand mark, the name, the Coach/Simple toggle, Remove. Everything below
// the hairline is that mode's settings. Hierarchy comes from surface and
// position: every field names itself with the 10px micro-label rather than
// with a bigger font, and the controls all sit at one size.
//
// What was here before had six controls and no order: a badge that only
// reported the blocking mode, a "Blocking mode" select two inches under it
// saying the same thing, a limit called "Daily limit" as if it were an
// allowance, and the two answers the coach actually argues from folded away
// inside a collapsed disclosure at the bottom.

function microLabel(text) {
  const el = document.createElement('span');
  el.className = 'micro-label';
  el.textContent = text;
  return el;
}

// A labelled control in the settings strip: a micro-label caption over one or
// more controls that sit on a line together. Every control in a row is named
// this way rather than by a title attribute a screen reader may never announce.
function buildRowField(labelEl, ...controls) {
  const field = document.createElement('div');
  field.className = 'row-field';
  field.appendChild(labelEl);
  const control = document.createElement('div');
  control.className = 'row-field-control';
  control.append(...controls);
  field.appendChild(control);
  return field;
}

// What the row does, and the control that changes it — one thing, in the head,
// where you read it.
//
// This replaces a pair that said the same thing twice: a "COACH" badge in the
// head and a "Blocking mode" select in the strip below it. A badge that only
// reports a setting sitting two inches above the setting is a label pretending
// to be information.
//
// Two buttons where storage has three states. The third — `mode` absent,
// meaning "follow the global default" — is not dropped, it is just no longer
// something to choose: the toggle shows the mode that is EFFECTIVE, and
// picking the one that already matches the global deletes the override rather
// than writing it. So a row you never touched still follows the global card,
// and a row you set to disagree with it stays set. Same three states, one
// fewer decision.
function buildRowModeToggle(target, label, limitInfo, globalMode, persistKey, onSaved) {
  const group = document.createElement('div');
  group.className = 'row-mode-toggle';
  // A named group, because "Coach" and "Simple" ten times down the page is
  // twenty unattached words to a screen reader without the row named once.
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `How ${label} is blocked`);

  const current = effectiveModeFor(limitInfo, globalMode);

  const persist = async (mode) => {
    if (mode === current) return;
    const state = await getConfig();
    const currentLimits = state[persistKey] || {};
    if (!currentLimits[target]) currentLimits[target] = { maxGrants: 3 };
    // Matching the global again means having no opinion again — see above.
    if (mode === (globalMode || 'coach')) delete currentLimits[target].mode;
    else currentLimits[target].mode = mode;
    // The simple-only fields follow the mode they belong to, exactly as they
    // did when the select owned this: a coach row carrying a stale pass length
    // is a setting that does nothing and reappears if you ever switch back.
    if (mode === 'simple') {
      if (!currentLimits[target].behavior) currentLimits[target].behavior = limitInfo.behavior || 'pass';
      if (!currentLimits[target].passMinutes) currentLimits[target].passMinutes = limitInfo.passMinutes || 10;
    } else {
      delete currentLimits[target].behavior;
      delete currentLimits[target].passMinutes;
    }
    await sendBg({ action: 'saveSettings', config: { [persistKey]: currentLimits } });
    await onSaved();
  };

  for (const [mode, text] of [['coach', 'Coach'], ['simple', 'Simple']]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-mode-btn';
    btn.textContent = text;
    // Buttons carrying a .selected class read as nothing at all without this;
    // aria-pressed is what makes the pair announce as a choice.
    btn.setAttribute('aria-pressed', String(mode === current));
    btn.classList.toggle('selected', mode === current);
    btn.addEventListener('click', () => persist(mode));
    group.appendChild(btn);
  }
  return group;
}

// The head and the empty settings strip, shared by all four lists (settings
// and wizard, sites and apps). Returns both, so the caller fills the strip
// with whatever its list actually offers.
//
// `inlineFields` drops the strip and hands back the head instead: the wizard
// rows carry a daily limit and nothing else, and a band of its own for one
// number is a lot of card for very little.
function buildBlockedRow({ target, label, headExtra, onRemove, inlineFields = false }) {
  const li = document.createElement('li');

  const head = document.createElement('div');
  head.className = 'row-head';

  const mark = document.createElement('span');
  mark.className = 'row-mark';
  mark.setAttribute('aria-hidden', 'true');
  applyServiceMark(mark, { key: serviceKeyFor(target), label });
  head.appendChild(mark);

  const name = document.createElement('span');
  name.className = 'domain-name';
  name.textContent = label;
  // The name still truncates on a narrow window; the title is the whole of it.
  name.title = label;
  head.appendChild(name);

  // The settings rows put the Coach/Simple toggle here, between the name and
  // Remove. The wizard rows pass nothing: it hasn't asked about blocking mode
  // yet at that step, so there is nothing true to put there.
  if (headExtra) head.appendChild(headExtra);

  // Placed before the Remove button either way, so the caller can fill it
  // afterwards and still have Remove come last.
  const fields = document.createElement('div');
  fields.className = inlineFields ? 'row-fields-inline' : 'row-fields';
  if (inlineFields) head.appendChild(fields);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Remove';
  btn.className = 'delete-btn';
  // Ten buttons all reading "Remove" is one row of the settings page to a
  // screen reader. The visible label stays short; the accessible one doesn't.
  btn.setAttribute('aria-label', `Remove ${label}`);
  btn.addEventListener('click', onRemove);
  head.appendChild(btn);

  li.appendChild(head);
  if (!inlineFields) li.appendChild(fields);

  return { li, fields };
}

// Ids for the info notes below. A page-lifetime counter rather than the target
// name: a domain is not a valid id fragment, and the same service can appear
// in both the sites list and the apps list.
let rowInfoSeq = 0;

// The ⓘ beside the absolute daily max. A disclosure, not a tooltip: a tooltip
// is a hover, and most installs of this page are a phone. `aria-expanded` and
// `aria-controls` are the whole of the semantics, and what it opens is
// ordinary text in the flow rather than a floating layer to keep positioned.
function buildInfoAffordance(labelText, text) {
  const id = `row-info-${++rowInfoSeq}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row-info-btn';
  btn.textContent = 'i';
  btn.setAttribute('aria-label', labelText);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', id);

  const note = document.createElement('p');
  note.className = 'row-info-note';
  note.id = id;
  note.textContent = text;
  note.hidden = true;

  btn.addEventListener('click', () => {
    note.hidden = !note.hidden;
    btn.setAttribute('aria-expanded', String(!note.hidden));
  });
  return { btn, note };
}

const MAX_MINUTES_EXPLAINER =
  'The most time you could genuinely need here in one day — a ceiling, not a target. ' +
  'Your coach will never grant past it, however good the reason. Set it to what a bad day should still be allowed to cost you, not to what a normal day looks like.';

// The absolute daily max — the same `maxMinutes` field it has always been,
// under the name it has always had in the coach's own prompts ("absolute max").
// "Daily limit" read like an allowance to be spent; it is a wall.
//
// The four lists disagree about what a change means — the wizard writes to a
// draft, the settings lists gate an increase behind the coach — so the handler
// is the caller's, and only the markup is shared. `info` is settings-only: the
// wizard step explains the number in its own subtitle, and a second
// explanation per row would be three of them on one screen.
function buildDailyLimitField(minutes, ariaName, onChange, { info = false } = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.className = 'inline-limit-input';
  input.setAttribute('aria-label', `Absolute daily max in minutes for ${ariaName}`);
  input.value = minutes;
  input.addEventListener('change', onChange);
  const unit = document.createElement('span');
  unit.className = 'row-field-unit';
  unit.textContent = 'min/day';

  if (!info) return buildRowField(microLabel('Absolute daily max'), input, unit);

  const { btn, note } = buildInfoAffordance(
    `What the absolute daily max on ${ariaName} means`,
    MAX_MINUTES_EXPLAINER
  );
  const field = buildRowField(microLabel('Absolute daily max'), input, unit, btn);
  field.appendChild(note);
  return field;
}

// An empty list used to render as nothing at all, which reads the same as a
// list that failed to load. One line saying so, and where to start.
function renderEmptyList(list, text) {
  const li = document.createElement('li');
  li.className = 'list-empty';
  li.textContent = text;
  list.appendChild(li);
}

// The two lists' four disagreements, in one place. Everything below the head
// hairline is otherwise identical between a blocked site and a blocked app,
// and it was already two near-identical copies of the daily-max gate before
// the timeline and the reason boxes were about to make it three.
const ROW_KINDS = {
  domain: {
    persistKey: 'domainLimits',
    increaseLimit: 'increase_limit',
    increaseLoose: 'increase_loose_window',
    narrowScope: 'narrow_block_scope',
    // Both lists offer section rules, and the two of them mean it differently.
    // A site row is answered from the address bar, which every platform has;
    // an app row is answered by reading the app's own screen, which only
    // Android can do and only for the packages AppParts.kt has a table for.
    // So `hasParts` says the field exists on this kind of row, and
    // partsAvailabilityFor() below decides what that field actually contains —
    // the control, or the sentence explaining why there isn't one. An app the
    // native side cannot see inside of must never be offered a rule that would
    // silently never match; being told so is not the same as being ignored.
    hasParts: true,
    isApp: false
  },
  app: {
    persistKey: 'appLimits',
    increaseLimit: 'increase_app_limit',
    increaseLoose: 'increase_app_loose_window',
    narrowScope: 'narrow_app_block_scope',
    hasParts: true,
    isApp: true
  }
};

// ---- The loose -> strict timeline (buildLooseTimelineField) ----------------
//
// One number drawn as the day it describes: `looseUntilMinutes`, how many of
// today's minutes on this site the coach spends being lenient before it turns
// strict. Left of the split a plausible, specific reason earns time; right of
// it only genuine need does, and any pass the coach does grant comes back
// clamped short. Absent means no split at all — the whole day is lenient,
// which is exactly how every row behaved before this control existed — so the
// handle opens at the far right rather than inventing a line the user never
// drew. Dragging it back is the act of drawing one.
//
// The thing that moves is a real <input type="range">, not a div with pointer
// handlers. A range is keyboard-operable out of the box (arrows, Home, End,
// Page keys), announced by screen readers with its own value and bounds, and
// draggable, with no ARIA plumbing to get wrong. The band behind it is
// decoration and is hidden from the accessibility tree outright, because a
// screen reader reading "loose, strict, slider 15" is the same fact three
// times. The number box beside it is the second way in, for anyone who would
// rather type 15 than hunt for it; both write the same field.
//
// The band and the number update on `input` — live, as you drag — but nothing
// is saved until `change`, which for a range fires on release. Otherwise
// dragging left to right would open a coach gate for every pixel on the way.
// The widget on its own: band, slider, number box, scale, note. It knows how
// to paint a value and how to report one that was committed, and nothing about
// where that value goes.
//
// Split out because setup needs the same control under a completely different
// rule. In settings, lengthening the lenient window is a loosening and has to
// be argued past the coach (see buildLooseTimelineField below). In the wizard
// there is nothing to argue with and nothing saved yet — you are choosing the
// rule, not relaxing one you already set — so the same drag just writes to the
// draft. Sharing the markup rather than the policy is the whole point: the two
// sliders must look and read identically, and must not behave identically.
function buildTimelineWidget({ label, maxMinutes, value, onCommit }) {
  const effective = value;

  const field = document.createElement('div');
  field.className = 'row-field row-timeline-field';
  field.appendChild(microLabel('Coach goes strict after'));

  const timeline = document.createElement('div');
  timeline.className = 'row-timeline';

  // The band and the range it drives share a positioned box of their own, so
  // the range can be laid over the band without reaching the scale beneath it
  // — on a coarse pointer the range grows to a 44px target and would otherwise
  // sit on top of the number box.
  const track = document.createElement('div');
  track.className = 'row-timeline-track';

  const band = document.createElement('div');
  band.className = 'row-timeline-band';
  band.setAttribute('aria-hidden', 'true');
  const loose = document.createElement('span');
  loose.className = 'row-timeline-phase is-loose';
  loose.textContent = 'loose';
  const strict = document.createElement('span');
  strict.className = 'row-timeline-phase is-strict';
  strict.textContent = 'strict';
  band.append(loose, strict);

  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'row-timeline-range';
  range.min = '0';
  range.max = String(maxMinutes);
  range.step = '1';
  range.setAttribute('aria-label', `Minutes on ${label} before the coach turns strict`);

  const scale = document.createElement('div');
  scale.className = 'row-timeline-scale';
  const zero = document.createElement('span');
  zero.className = 'row-timeline-end';
  zero.textContent = '0';
  const number = document.createElement('input');
  number.type = 'number';
  number.className = 'inline-limit-input row-timeline-number';
  number.min = '0';
  number.max = String(maxMinutes);
  number.setAttribute('aria-label', `Minutes on ${label} before the coach turns strict`);
  const end = document.createElement('span');
  end.className = 'row-timeline-end';
  end.textContent = `${maxMinutes} min`;
  scale.append(zero, number, end);

  const note = document.createElement('p');
  note.className = 'row-timeline-note';

  // Paints, never saves. Called on every drag frame and to revert a change the
  // coach didn't approve.
  const paint = (value) => {
    const pct = maxMinutes > 0 ? Math.round((value / maxMinutes) * 100) : 100;
    loose.style.flexBasis = `${pct}%`;
    strict.style.flexBasis = `${100 - pct}%`;
    range.value = String(value);
    number.value = String(value);
    // aria-valuetext, so the announcement is "15 minutes, then strict" rather
    // than a bare "15" — the number alone doesn't say what it counts.
    range.setAttribute('aria-valuetext',
      value >= maxMinutes
        ? `lenient all day, no strict phase`
        : `${value} of ${maxMinutes} minutes lenient, then strict`);
    note.textContent = value >= maxMinutes
      ? 'Lenient all day — the coach never turns strict here.'
      : `The first ${value} min of your day here are judged gently. After that, genuine need only, and passes are capped short.`;
  };
  paint(effective);

  // Parsing and clamping belong to the widget; deciding what a committed value
  // means belongs to the caller. `paint` goes with it so a caller that refuses
  // the change can put the control back where it was.
  //
  // Returns onCommit's result, which for the settings policy is a promise that
  // only settles once the write has landed. Swallowing it here would make every
  // save fire-and-forget: nothing could await one, and a caller that reloaded
  // the row afterwards would race its own write.
  const commit = (raw) => {
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
      paint(effective);
      return undefined;
    }
    const value = Math.max(0, Math.min(maxMinutes, parsed));
    if (value === effective) {
      paint(effective);
      return undefined;
    }
    return onCommit(value, { paint, effective });
  };

  range.addEventListener('input', () => paint(parseInt(range.value, 10) || 0));
  range.addEventListener('change', () => commit(range.value));
  number.addEventListener('change', () => commit(number.value));

  track.append(band, range);
  timeline.append(track, scale, note);
  field.appendChild(timeline);
  return field;
}

// Settings: the coach-gated slider. Shortening the lenient window tightens the
// rule and saves itself; lengthening it loosens the rule and has to be argued
// past the coach — the same direction test the daily max above uses.
function buildLooseTimelineField(target, label, limitInfo, kind, maxMinutes, rerender) {
  const stored = looseUntilFor(limitInfo);
  // A max that has since been lowered can leave a split beyond the end of the
  // track. Past the end and absent mean the same thing here — lenient all day.
  const effective = stored == null ? maxMinutes : Math.min(stored, maxMinutes);

  const persist = async (value) => {
    const state = await getConfig();
    const currentLimits = state[kind.persistKey] || {};
    if (!currentLimits[target]) currentLimits[target] = { maxGrants: 3 };
    currentLimits[target].looseUntilMinutes = value;
    await sendBg({ action: 'saveSettings', config: { [kind.persistKey]: currentLimits } });
  };

  return buildTimelineWidget({
    label,
    maxMinutes,
    value: effective,
    onCommit: async (value, { paint }) => {
      if (value < effective) {
        paint(value);
        await persist(value);
        return;
      }
      paint(effective); // revert until/unless approved
      applyOrGate({
        // Only ever reachable in coach mode — the whole band is coach-only, so
        // there is no simple-mode branch to take here. Passed anyway, and read
        // from the row, so the day this moves it does the right thing.
        isSimple: false,
        isApp: kind.isApp,
        appLabel: kind.isApp ? label : undefined,
        changeType: kind.increaseLoose,
        domain: target,
        currentValue: effective,
        newValue: value,
        title: `Stay lenient for longer on ${label}?`,
        subtitle: `Right now your coach goes strict after ${effective} min a day on ${label}. You're asking for ${value}. Convince your coach.`,
        onApproved: rerender
      });
    }
  });
}

// Setup: the same control, ungated, writing to the in-memory draft. Nothing is
// committed until Finish, so there is no rule yet to loosen and no coach yet to
// loosen it past — every move is just the user choosing, in either direction.
//
// An unset window means lenient all day, so the slider opens at the far end
// rather than at 0: starting at 0 would mean "strict from the first minute",
// which is the opposite of what an untouched control should say.
function buildSetupTimelineField(label, maxMinutes, looseUntilMinutes, onChange) {
  const stored = normalizeLooseUntil(looseUntilMinutes);
  const effective = stored == null ? maxMinutes : Math.min(stored, maxMinutes);
  return buildTimelineWidget({
    label,
    maxMinutes,
    value: effective,
    onCommit: (value, { paint }) => {
      paint(value);
      onChange(value);
    }
  });
}

// ---- The two site-specific answers (buildRowReasonFields) ------------------
//
// Promoted out of the collapsed <details> they used to hide inside. They are
// not a footnote to the row: they are the calm version of you, in writing,
// which the coach quotes back at the version standing in front of the block.
// A disclosure was the right shape when they were optional prose nobody read;
// it is the wrong shape for the thing that decides the argument.
//
// Keyed per SERVICE, not per target (serviceKeyFor folds the X app and x.com
// onto one answer), which is what the "Shared with …" note is telling you.
//
// Editing one now costs a conversation. They feed every gate decision on this
// service, so quietly rewriting "when is it legitimate" is just the block with
// extra steps. The FIRST write of a field is direct, exactly as the coach-
// context card's is — there is no weak moment to guard against before anything
// exists — and every edit after that routes through applyOrGate.
function buildRowReasonFields(target, label, kind, serviceReasons, allBlocked, rerender) {
  const key = serviceKeyFor(target);
  const answers = (serviceReasons || {})[key] || {};

  const wrap = document.createElement('div');
  wrap.className = 'row-reasons';

  // Only worth saying where it is true, and it is the entire explanation for
  // why editing this row also changes another one.
  const shared = (allBlocked || [])
    .filter(t => t.target !== target && serviceKeyFor(t.target) === key)
    .map(t => t.label);
  if (shared.length) {
    const sharedNote = document.createElement('p');
    sharedNote.className = 'row-reason-shared';
    sharedNote.textContent = `Shared with ${shared.join(', ')} — the same service, so this edits both.`;
    wrap.appendChild(sharedNote);
  }

  const fields = [
    {
      field: 'purpose',
      caption: "Why you're blocking it",
      changeType: 'edit_site_purpose',
      placeholder: `e.g. It eats the evening and I never meant to open it.`
    },
    {
      field: 'legitimateUse',
      caption: 'Why you need it',
      changeType: 'edit_site_legitimate',
      placeholder: `e.g. Replying to one specific DM. Never the feed.`
    }
  ];

  for (const { field, caption, changeType, placeholder } of fields) {
    const row = document.createElement('div');
    row.className = 'row-reason';

    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'micro-label row-reason-label';
    fieldLabel.textContent = caption;

    const area = document.createElement('textarea');
    area.rows = 2;
    area.className = 'row-reason-input';
    area.value = answers[field] || '';
    area.placeholder = placeholder;
    area.id = `row-reason-${++rowInfoSeq}`;
    fieldLabel.htmlFor = area.id;
    // The visible caption is two or three words and repeats down the page; the
    // accessible one names the row it belongs to.
    area.setAttribute('aria-label', `${caption} — ${label}`);

    area.addEventListener('change', async () => {
      // Re-read rather than trusting the closure: another row of the same
      // service may have been edited since this one was drawn.
      const state = await getConfig();
      const existing = (state.serviceReasons || {})[key] || {};
      const before = String(existing[field] || '');
      const after = area.value.trim();
      if (after === before) return;

      if (!before) {
        // Nothing there yet, so there is nothing to weaken. Straight in.
        const next = { ...(state.serviceReasons || {}) };
        next[key] = { ...(next[key] || {}), [field]: after, updatedAt: Date.now() };
        await sendBg({ action: 'saveSettings', config: { serviceReasons: next } });
        return;
      }

      area.value = before; // revert until/unless approved
      applyOrGate({
        isSimple: false,
        isApp: kind.isApp,
        appLabel: kind.isApp ? label : undefined,
        changeType,
        domain: target,
        currentValue: before,
        newValue: after,
        title: `Change "${caption.toLowerCase()}" for ${label}?`,
        subtitle: `Your coach reads this at every block on ${label}. Rewriting it changes every future decision, not just today's. Talk it through.`,
        onApproved: rerender
      });
    });

    row.append(fieldLabel, area);
    wrap.appendChild(row);
  }
  return wrap;
}

// The one thing a simple-mode row owns: what happens when you open it, and for
// how long. There is no coach to argue with, so the loose/strict split and the
// two answers written FOR that coach are both dead controls here, and the row
// shows this pair in their place.
function buildSimpleBehaviorField(target, label, limitInfo, kind, onSaved) {
  const behaviorSelect = document.createElement('select');
  behaviorSelect.className = 'row-behavior-select';
  behaviorSelect.setAttribute('aria-label', `What happens when you open ${label}`);
  behaviorSelect.innerHTML = `<option value="pass">Timed pass</option><option value="hard">Hard block</option>`;
  behaviorSelect.value = limitInfo.behavior || 'pass';

  const minutesInput = document.createElement('input');
  minutesInput.type = 'number';
  minutesInput.min = '1';
  minutesInput.max = '180';
  minutesInput.className = 'row-minutes-input inline-limit-input';
  minutesInput.setAttribute('aria-label', `Minutes per pass on ${label}`);
  minutesInput.value = limitInfo.passMinutes || 10;

  const minutesUnit = document.createElement('span');
  minutesUnit.className = 'row-field-unit';
  minutesUnit.textContent = 'min';

  const updateVisibility = () => {
    const showMinutes = behaviorSelect.value === 'pass';
    minutesInput.hidden = !showMinutes;
    minutesUnit.hidden = !showMinutes;
  };
  updateVisibility();

  const persist = async () => {
    const state = await getConfig();
    const currentLimits = state[kind.persistKey] || {};
    if (!currentLimits[target]) currentLimits[target] = { maxGrants: 3 };
    currentLimits[target].behavior = behaviorSelect.value;
    currentLimits[target].passMinutes = parseInt(minutesInput.value, 10) || 10;
    await sendBg({ action: 'saveSettings', config: { [kind.persistKey]: currentLimits } });
    await onSaved();
  };

  behaviorSelect.addEventListener('change', () => { updateVisibility(); persist(); });
  minutesInput.addEventListener('change', persist);

  return buildRowField(microLabel('When you open it'), behaviorSelect, minutesInput, minutesUnit);
}

// ---- Parts of the site (buildRowPartsField + the picker) -------------------
//
// "Block Instagram" is usually a lie about what someone wants. What they want
// is Reels shut and their messages open, or every subreddit but the two they
// actually read. This field is where that is said: a scope — all of it, only
// these parts, everything except these parts — and a list of parts to go with
// it.
//
// Three properties of this control are load-bearing:
//
//   * It obeys the row's one rule, and the direction test is NOT obvious from
//     the gesture. Adding a part to an 'only' list blocks MORE and saves
//     itself; adding the same part to an 'except' list blocks LESS and has to
//     be argued with the coach. Removing one flips both. parts.js answers that
//     with partEditIsLoosening and this file never second-guesses it — one
//     sentence covers the whole table: any edit that leaves less of the site
//     blocked goes through the coach.
//   * A scope with no parts in it is NOT saved. It decides nothing: an empty
//     'only' list gates the whole site (resolvePartVerdict fails closed) and
//     sanitizePartRule collapses it to no rule at all on the way to storage.
//     So choosing "Only some parts" paints the editor and writes nothing until
//     a part actually names something — and the empty-state copy below says so
//     out loud, because a control that looks armed and is not is the worst
//     thing a blocker can be.
//   * It renders in simple mode as well as coach mode. Which parts of a site
//     are blocked is a fact about the blocklist, not about how the coach
//     behaves once you are stopped, and checkFromStorage reaches the part
//     verdict before it ever resolves a mode.
//
// The same field appears on an app row, and everything above still holds —
// what changes is where the answer comes from and how sure of it we are. A
// site is read off the address bar, which is exact. An app is read off the
// app's own screen through the Android accessibility service (AppParts.kt),
// against view ids that are internal to Instagram and YouTube and that change
// without notice. That is a real difference and the copy says so rather than
// papering over it: see PARTS_EXPLAINER_APP and PARTS_APP_DEGRADE, which
// describe what happens on the day detection stops working, because it is a
// scheduled event rather than an edge case.
//
// Where it cannot work at all, the field still appears and says why —
// partsAvailabilityFor(). A control that is silently missing teaches the user
// nothing; one that is present and lying is worse; a sentence is the only
// honest third option.

const PARTS_SCOPE_CHOICES = [
  { value: 'all', text: 'All of it' },
  { value: 'only', text: 'Only some parts' },
  { value: 'except', text: 'All except' }
];

// Looked up by name rather than branched on, deliberately. What a scope value
// MEANS is resolvePartVerdict's decision and nothing else's —
// tests/parts.test.js greps every other shared file for a comparison against
// one — so this table renders the copy for a scope it has copy for, and the
// absence of an entry for 'all' is what "there is no rule here" looks like.
//
// The 'only' empty-state line is the one piece of copy in this feature that
// had to be written twice. It first read "Nothing listed yet, so nothing on
// {label} is blocked at all", which is the opposite of what the code does: an
// empty 'only' list fails CLOSED — resolvePartVerdict gates everything, and
// hasPartRule answers false so the host keeps its redirect rule. The semantics
// are right (an unreadable rule must never silently open a site) and the copy
// was wrong, so the copy moved.
//
// Two tables, keyed the same way, because a site and an app are not the same
// noun: you are ON a website and IN an app, and one set of sentences bent to
// cover both reads as machine-written in whichever half it was not written
// for.
const PARTS_SCOPE_COPY = {
  only: {
    helper: (label) => `Only the parts below are blocked. Everything else on ${label} stays open.`,
    empty: (label) => `Nothing listed yet, so all of ${label} is still blocked. Add a part to say which bit you mean.`
  },
  except: {
    helper: (label) => `All of ${label} is blocked except the parts below.`,
    empty: (label) => `Nothing listed yet, so all of ${label} is blocked.`
  }
};

const PARTS_SCOPE_COPY_APP = {
  only: {
    helper: (label) => `Only the sections below are blocked. The rest of ${label} stays open.`,
    empty: (label) => `Nothing listed yet, so all of ${label} is still blocked. Add a section to say which bit you mean.`
  },
  except: {
    helper: (label) => `All of ${label} is blocked except the sections below.`,
    empty: (label) => `Nothing listed yet, so all of ${label} is blocked.`
  }
};

// What happens on the day the app ships a release we cannot read, said on the
// row and per scope.
//
// These sentences are not decoration: they are AppParts.kt's degradation rules
// written in the user's words, and they have to keep saying what that file
// does. If the Kotlin's fail-open/fail-closed choice ever moves, this table
// moves with it in the same commit.
//
// It moved. `only` used to fail OPEN — an unrecognised screen let you through —
// and this table called it "the softer of the two rules inside an app" on that
// basis. It now fails CLOSED, agreeing with `except`, because the recogniser
// table ships unverified on every signal: an app that quietly opens announces
// nothing, where an app that stays blocked is something you notice at once and
// can act on from the gate it shows you. So the two scopes no longer degrade in
// opposite directions, there is no softer choice, and the only thing that
// differs on that day is which sentence the gate puts in front of you.
//
// Saying otherwise would be the expensive kind of wrong: someone picks "only"
// believing it is the cautious option, and meets a wholly blocked app instead.
const PARTS_APP_DEGRADE = {
  only: (label) => `If ${label} changes and Intention can't tell which section is open, the whole app stays blocked — the same as the other rule. Your coach still opens, so you can get through or change the rule from there.`,
  except: (label) => `If ${label} changes and Intention can't tell which section is open, the whole app stays blocked. Your coach still opens, so you can get through or change the rule from there.`
};

const PARTS_EXPLAINER =
  'Intention works out which part you are on from the web address. A pass still opens the whole site for its length — ' +
  'the parts only decide when your coach steps in at all.';

// The app version of the same note, and it is longer for one reason: inside an
// app there is nothing as reliable as an address, so the honest explanation
// includes how this fails. Overselling it here would be the expensive kind of
// wrong — someone leaves Instagram installed believing Reels is shut.
const PARTS_EXPLAINER_APP =
  'There is no address inside an app, so Intention recognises a section from the app\'s own screen. ' +
  'That is best-effort: it depends on the version of the app you have, and on your phone being in English for some screens. ' +
  'A section this version of Intention does not recognise blocks the whole app rather than opening it. ' +
  'Intention counts the times it could not tell and offers to turn the rule back into "All of it" if that keeps happening. ' +
  'A pass still opens the whole app for its length — the sections only decide when your coach steps in at all.';

// The packages Intention can see inside, and the sections it can recognise in
// each. This is the JS half of APP_PARTS in
// "Intention Android/.../AppParts.kt" — the same part ids, deliberately
// duplicated, because that table lives in the APK and this page has no way to
// ask it anything. tests/options-row.test.js reads the Kotlin and fails if the
// two disagree, which is what keeps a duplicate honest.
//
// Only these ids are offered on an app row, and the picker's hand-written
// address box is not offered at all. Both follow from the same rule: a rule
// naming something the native side can never answer with is refused whole and
// the target reverts to "block all of it", so offering one would be offering a
// control whose only possible effect is to undo the user's own carve-out.
const APP_PART_IDS = {
  'com.instagram.android': ['instagram:reels', 'instagram:stories', 'instagram:dms', 'instagram:explore', 'instagram:feed'],
  'com.google.android.youtube': ['youtube:shorts', 'youtube:watch', 'youtube:subs', 'youtube:home']
};

// Whether this row can carry a section rule, and if not, the sentence the row
// says instead.
//
// Three answers, and the two refusals are different facts about the world:
//
//   iOS/macOS  — never, for any app. Screen Time shields an app behind an
//                opaque token (a FamilyActivitySelection); there is no API
//                that reports which screen is open, and nothing Intention can
//                do about it. This is not "not yet".
//   Android, uncovered package — not for this app yet. The view ids for a new
//                app have to be harvested from a real device and shipped in
//                the APK, so the list grows one app at a time.
//   Android, covered package  — yes.
//
// The host is detected the way options.js already detects it — window
// .intentionApps is the Android bridge, window.intentionScreenTime the iOS one
// — rather than by asking the platform, because what matters is which bridge
// is answering, not which OS is underneath.
function partsAvailabilityFor(target, label, kind) {
  if (!kind.isApp) return { available: true };
  const host = typeof window === 'undefined' ? {} : window;
  if (!host.intentionApps && host.intentionScreenTime) {
    return {
      available: false,
      note: `On iPhone and iPad, apps are blocked with Screen Time, which hides the whole app behind a shield and tells Intention nothing about what is on screen. Blocking part of ${label} is not possible here — only all of it. Section rules work on websites, and in some apps on Android.`
    };
  }
  // The bridge has to be there as well as the package: the table is read by
  // the Android accessibility service, so without that host nothing is on the
  // other end of the rule. "No bridge" therefore lands on the same answer as
  // "package we cannot see inside of", which is the direction to fail in — an
  // offered control that cannot bind is the one thing this field must never be.
  if (host.intentionApps && APP_PART_IDS[target]) {
    return { available: true, ids: APP_PART_IDS[target] };
  }
  return {
    available: false,
    note: `Sections are not available for ${label} yet. Intention can only tell which section is open inside apps it has been taught to read — Instagram and YouTube so far — and a rule it cannot read would block the whole app anyway. All of ${label} is blocked, as before.`
  };
}

// The notation a parameterised part is written in ('r/', 'u/', '@'), asked of
// parts.js rather than restated here: partLabel is the one place that knows
// r/rust is written with a slash and @veritasium with an at sign, so the
// prefix is read back off a sample label instead of being typed out a second
// time and left to drift.
function partParamPrefix(optionId) {
  const sample = partLabel(`${optionId}:example`);
  return sample.endsWith('example') ? sample.slice(0, -'example'.length) : '';
}

// What the user typed into a parameterised part's box, as a part id or null.
//
// Accepts the argument on its own ('rust') and the site's own notation
// ('r/rust', '@veritasium'), because both are what people type. The id is
// built and then handed to parts.js to accept or refuse — the argument's shape
// is the catalogue's rule (Reddit's own 21-character limit, X's 15) and this
// file must not carry a second opinion about it.
function partIdFromParamInput(optionId, raw, serviceKey) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  const bare = text.replace(/^@/, '').replace(/^(?:r|u|user)\//i, '');
  const guess = `${optionId}:${bare.toLowerCase()}`;
  if (partIsRecognised(guess)) return guess;
  const normalized = normalizePartInput(text, serviceKey);
  return normalized && normalized.indexOf(`${optionId}:`) === 0 ? normalized : null;
}

// The picker. A dialog, built here rather than in options.html: it is the row's
// control, it exists only while it is open, and every node in it is created
// with createElement/textContent so nothing user-typed is ever parsed as
// markup.
//
// `onPick(partId)` is called with a part id parts.js has already accepted, so
// the caller never has to validate one.
//
// `only` narrows the catalogue to a fixed list of ids and drops the
// hand-written address box with it — the app case. The two travel together on
// purpose: both exist because inside an app the answer comes from a table of
// view ids rather than from the address bar, so anything outside that table is
// something the native side can never answer with. An app row offering a
// picker full of parts it cannot see, or a box for typing a URL into an app
// that has none, would be a control whose only possible effect is to blank the
// rule the user already had.
function openPartPicker({ serviceKey, label, existing, onPick, only = null }) {
  const modal = document.createElement('div');
  modal.className = 'add-modal';

  const box = document.createElement('div');
  box.className = 'coach-box add-modal-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const header = document.createElement('div');
  header.className = 'coach-header';
  const title = document.createElement('h2');
  title.textContent = `Which part of ${label}?`;
  box.appendChild(header);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'secondary';
  closeBtn.textContent = 'Close';
  header.append(title, closeBtn);

  const close = () => modal.remove();
  closeBtn.addEventListener('click', close);
  // The scrim closes it; a click inside must not. Same behaviour as the other
  // add dialogs on this page.
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Returns whatever onPick returns — which for the row is the promise its
  // save settles on. A picker that swallowed it would make every add
  // fire-and-forget, and nothing could wait for the write.
  const pick = (partId) => {
    close();
    return onPick(partId);
  };

  // ---- The catalogue half.
  const known = partsForService(serviceKey)
    .filter(option => !only || only.includes(option.id));
  if (known.length) {
    const knownLabel = document.createElement('p');
    knownLabel.className = 'micro-label';
    knownLabel.textContent = only ? 'Sections Intention can recognise' : 'Known parts';
    box.appendChild(knownLabel);

    const grid = document.createElement('div');
    grid.className = 'part-picker-grid';
    for (const option of known) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill part-picker-option';
      btn.textContent = option.label;
      // A part already on the list is shown and disabled rather than hidden:
      // a picker whose contents change depending on what you did last is a
      // picker you cannot learn.
      if (!option.param && existing.includes(option.id)) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }
      btn.addEventListener('click', () => {
        if (option.param) {
          openParamInput(option);
          return undefined;
        }
        return pick(option.id);
      });
      grid.appendChild(btn);
    }
    box.appendChild(grid);
  }

  // The app half's version of the same honesty: this list is short because it
  // is everything the shipped table can recognise, not because Instagram has
  // four screens. Said here, next to the buttons, rather than only in the row's
  // info note — this is the moment someone wonders where the rest went.
  if (only) {
    const note = document.createElement('p');
    note.className = 'row-info-note part-picker-note';
    note.textContent = `These are the sections Intention can recognise inside ${label}. ` +
      'It reads them from the app\'s own screen, so an app update can change what it sees — and anything it cannot see stays blocked.';
    box.appendChild(note);
  }

  // The one place a part is offered that the address cannot actually
  // distinguish, said in the picker rather than discovered later. X serves
  // "For You" and "Following" from the same /home, so they are not separate
  // parts and must never be offered as if they were.
  if (serviceKey === 'x.com') {
    const note = document.createElement('p');
    note.className = 'row-info-note part-picker-note';
    note.textContent = 'X shows "For You" and "Following" at the same address, so Intention can\'t tell them apart. ' +
      'You can block the home timeline, or leave it.';
    box.appendChild(note);
  }

  // The argument box for a parameterised part, opened in place of the grid so
  // the dialog never grows a second scrolling column on a phone.
  const paramWrap = document.createElement('div');
  paramWrap.className = 'part-picker-param';
  paramWrap.hidden = true;
  box.appendChild(paramWrap);

  const paramNodes = [];
  function openParamInput(option) {
    paramWrap.hidden = false;
    for (const node of paramNodes.splice(0)) node.remove();

    const caption = document.createElement('p');
    caption.className = 'micro-label';
    caption.textContent = option.label;

    const group = document.createElement('div');
    group.className = 'input-group part-picker-input-group';
    const prefix = partParamPrefix(option.id);
    if (prefix) {
      const prefixEl = document.createElement('span');
      prefixEl.className = 'part-picker-prefix';
      prefixEl.setAttribute('aria-hidden', 'true');
      prefixEl.textContent = prefix;
      group.appendChild(prefixEl);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = option.param;
    input.setAttribute('aria-label', `${option.label} on ${label}`);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'primary';
    addBtn.textContent = 'Add part';
    group.append(input, addBtn);

    const error = document.createElement('p');
    error.className = 'int-pw-error';
    error.hidden = true;

    const submit = () => {
      const id = partIdFromParamInput(option.id, input.value, serviceKey);
      if (!id) {
        error.textContent = `That doesn't look like a ${option.param} on ${label}. Letters, numbers and underscores only.`;
        error.hidden = false;
        return undefined;
      }
      return pick(id);
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    paramWrap.append(caption, group, error);
    paramNodes.push(caption, group, error);
    try { input.focus(); } catch (e) { /* no focus in a test DOM */ }
  }

  // ---- The escape hatch. Every site on the web, catalogue or not.
  //
  // Absent when the catalogue was narrowed to a fixed list (see `only`): an
  // address rule is a match against a URL, and the inside of an app has no
  // URLs. One typed here would be a rule the native side can never evaluate,
  // and a rule it cannot evaluate is refused whole — so the box would be a
  // way to quietly turn "block only Reels" back into "block all of it".
  if (!only) {
    const customLabel = document.createElement('p');
    customLabel.className = 'micro-label';
    customLabel.textContent = 'Or match an address yourself';
    box.appendChild(customLabel);

    const customGroup = document.createElement('div');
    customGroup.className = 'input-group';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = '/reels/*';
    customInput.setAttribute('aria-label', `An address on ${label} to treat as a part`);
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'primary';
    customBtn.textContent = 'Add part';
    customGroup.append(customInput, customBtn);

    const customHelp = document.createElement('p');
    customHelp.className = 'row-info-note part-picker-note';
    customHelp.textContent = 'Matched against everything after the domain. Use * to stand for anything.';

    const customError = document.createElement('p');
    customError.className = 'int-pw-error';
    customError.hidden = true;

    const submitCustom = () => {
      const id = normalizePartInput(customInput.value, serviceKey);
      if (!id) {
        customError.textContent = "That doesn't look like an address. Start it with / — for example /reels/*.";
        customError.hidden = false;
        return undefined;
      }
      return pick(id);
    };
    customBtn.addEventListener('click', submitCustom);
    customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCustom(); });

    box.append(customGroup, customHelp, customError);
  }

  modal.appendChild(box);
  document.body.appendChild(modal);
  return modal;
}

// The field itself. Holds the row's part rule as a draft, paints it, and hands
// every committed edit to parts.js to judge the direction of.
function buildRowPartsField(target, label, limitInfo, kind, globalMode, rerender) {
  const serviceKey = serviceKeyFor(target);
  const isApp = kind.isApp;
  const noun = isApp ? 'app' : 'site';
  const availability = partsAvailabilityFor(target, label, kind);
  // Nothing here can bind, so the field is one sentence saying why. It is
  // still a field, with the same caption as every other row's: the answer to
  // "can I shut just the Reels tab?" is a fact about this app, and a user who
  // never sees the question asked cannot learn the answer.
  if (!availability.available) {
    const field = document.createElement('div');
    field.className = 'row-field row-parts-field';
    field.appendChild(microLabel(`Parts of the ${noun}`));
    const note = document.createElement('p');
    note.className = 'row-info-note row-parts-unavailable';
    note.textContent = availability.note;
    field.appendChild(note);
    return field;
  }
  const scopeCopy = isApp ? PARTS_SCOPE_COPY_APP : PARTS_SCOPE_COPY;
  // The rule as it stands in storage. Kept up to date after a direct save
  // rather than read once: the settings list rebuilds the whole row after a
  // write, but nothing here should depend on that happening — a second edit
  // compared against a stale `before` would ask parts.js the wrong question
  // about which direction it goes in.
  let stored = sanitizePartRule(limitInfo);
  // The chosen scope before it has any parts to act on. Stored state cannot
  // hold it — sanitizePartRule collapses an empty list to no rule — so the
  // half-made decision lives here, in the row, until it means something.
  let draftScope = stored.scope;
  let parts = stored.parts.slice();

  const field = document.createElement('div');
  field.className = 'row-field row-parts-field';

  const caption = microLabel(`Parts of the ${noun}`);
  field.appendChild(caption);

  const control = document.createElement('div');
  control.className = 'row-field-control';
  field.appendChild(control);

  const group = document.createElement('div');
  group.className = 'row-mode-toggle row-scope-toggle';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `Which parts of ${label} are blocked`);
  control.appendChild(group);

  const { btn: infoBtn, note: infoNote } = buildInfoAffordance(
    `What "parts of the ${noun}" means`,
    isApp ? PARTS_EXPLAINER_APP : PARTS_EXPLAINER
  );
  control.appendChild(infoBtn);

  const helper = document.createElement('p');
  helper.className = 'row-parts-helper';

  // How this rule fails, on the row rather than behind the info button, and
  // only once the rule exists to fail. An app row is the only one that has
  // this: a site rule is answered from the address bar and either matches or
  // does not, where an app rule is a best-effort reading of somebody else's
  // screen that a single app update can end.
  const degradeNote = document.createElement('p');
  degradeNote.className = 'row-parts-helper row-parts-caveat';
  degradeNote.hidden = true;

  const chips = document.createElement('div');
  chips.className = 'row-parts-chips';
  // The chips currently painted, so a repaint can take exactly them away.
  const chipNodes = [];

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'secondary row-parts-add';
  addBtn.textContent = isApp ? '+ Add a section' : '+ Add a part';

  field.append(helper, degradeNote, chips, addBtn, infoNote);

  const scopeButtons = PARTS_SCOPE_CHOICES.map(choice => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-mode-btn row-scope-btn';
    btn.textContent = choice.text;
    btn.addEventListener('click', () => chooseScope(choice.value));
    group.appendChild(btn);
    return { choice, btn };
  });

  // Paints, never saves — same contract as the timeline widget above, and for
  // the same reason: a change the coach refuses has to be able to put the
  // control back exactly as it was.
  function paint() {
    for (const { choice, btn } of scopeButtons) {
      const on = choice.value === draftScope;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('selected', on);
    }
    const copy = scopeCopy[draftScope];
    helper.hidden = !copy;
    addBtn.hidden = !copy;
    chips.hidden = !copy;
    const degrade = isApp ? PARTS_APP_DEGRADE[draftScope] : null;
    degradeNote.hidden = !degrade;
    degradeNote.textContent = degrade ? degrade(label) : '';
    if (!copy) {
      helper.textContent = '';
      return;
    }
    helper.textContent = parts.length ? copy.helper(label) : copy.empty(label);
    for (const node of chipNodes.splice(0)) node.remove();
    for (const id of parts) {
      const chip = document.createElement('span');
      chip.className = 'row-part-chip';
      const text = document.createElement('span');
      text.textContent = partLabel(id) || id;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'row-part-chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Stop treating ${partLabel(id) || id} as a part of ${label}`);
      remove.addEventListener('click', () => commit(draftScope, parts.filter(p => p !== id)));
      chipNodes.push(chip);
      chip.append(text, remove);
      chips.appendChild(chip);
    }
  }

  const revert = () => {
    draftScope = stored.scope;
    parts = stored.parts.slice();
    paint();
  };

  const persist = async (rule) => {
    const state = await getConfig();
    const currentLimits = state[kind.persistKey] || {};
    if (!currentLimits[target]) currentLimits[target] = { maxGrants: 3 };
    // Written as the two keys, or as neither of them: background.js's
    // saveSettings runs the same sanitiser over this on the way in, and an
    // entry with no rule has to stay byte-identical to what shipped before
    // this feature existed.
    if (hasPartRule(rule)) {
      currentLimits[target].scope = rule.scope;
      currentLimits[target].parts = rule.parts;
    } else {
      delete currentLimits[target].scope;
      delete currentLimits[target].parts;
    }
    await sendBg({ action: 'saveSettings', config: { [kind.persistKey]: currentLimits } });
    stored = rule;
    await rerender();
  };

  // The one decision this control makes, and it makes it by asking parts.js.
  async function commit(nextScope, nextParts) {
    const after = sanitizePartRule({ scope: nextScope, parts: nextParts });
    // Nothing to save yet: the scope has been chosen but names nothing, so the
    // rule is unchanged and the site is still blocked in full. Paint the
    // half-made decision and wait for a part.
    if (!hasPartRule(after) && !hasPartRule(stored)) {
      draftScope = nextScope;
      parts = nextParts.slice();
      paint();
      return;
    }
    if (!partEditIsLoosening(stored, after)) {
      draftScope = after.scope === 'all' ? nextScope : after.scope;
      parts = after.parts.slice();
      paint();
      await persist(after);
      return;
    }
    revert(); // until/unless the coach approves it
    applyOrGate({
      // Part rules bind in simple mode too, but there is no coach there to
      // argue with, so the change applies outright — the same escape every
      // other loosening on a simple row takes.
      isSimple: effectiveModeFor(limitInfo, globalMode) === 'simple',
      isApp: kind.isApp,
      appLabel: kind.isApp ? label : undefined,
      changeType: kind.narrowScope,
      domain: target,
      // Both values are whole rules, not numbers. background.js renders them
      // into the sentence the coach reads (describeScopeForHuman) so that the
      // gate and this row describe the same rule in the same words.
      currentValue: stored,
      newValue: after,
      title: `Block less of ${label}?`,
      subtitle: `Right now ${describeScopeForHuman(stored, label)}. You're asking for ${describeScopeForHuman(after, label)}. ` +
        `That leaves part of ${label} open to you without ever talking to me again. Convince your coach.`,
      onApproved: rerender
    });
  }

  function chooseScope(value) {
    if (value === draftScope) return undefined;
    return commit(value, parts);
  }

  addBtn.addEventListener('click', () => {
    openPartPicker({
      serviceKey,
      label,
      existing: parts,
      // The whole catalogue for a site; for an app, only what the native side
      // can actually recognise inside it (partsAvailabilityFor).
      only: availability.ids || null,
      onPick: (partId) => {
        if (parts.includes(partId)) return undefined;
        return commit(draftScope, parts.concat([partId]));
      }
    });
  });

  paint();
  return field;
}

// Everything under the head hairline, for both lists.
//
// The absolute daily max is here in BOTH modes, because it binds in both —
// simpleGrant checks it just as the coach's grant path does, and a cap that
// still stops you but no longer appears is worse than no cap at all.
// Everything else in the band is about the coach: the loose/strict timeline
// and the two answers written for it are coach-only, and a simple row gets its
// pass controls instead.
function buildRowBody({ li, fields, target, label, limitInfo, globalMode, kind, serviceReasons, rerender }) {
  const isSimple = effectiveModeFor(limitInfo, globalMode) === 'simple';
  const stored = limitInfo.maxMinutes !== undefined
    ? limitInfo.maxMinutes
    : (limitInfo.max_minutes_per_day ?? DEFAULT_DAILY_MAX_MINUTES);
  // A non-positive maxMinutes means unlimited; the box still has to show a
  // number you can edit, and the add-default is what every other one here is.
  const currentMins = stored > 0 ? stored : DEFAULT_DAILY_MAX_MINUTES;

  fields.appendChild(buildDailyLimitField(currentMins, label, async (e) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val <= 0) {
      e.target.value = currentMins;
      return;
    }
    const currentlyUnlimited = !(stored > 0);
    const isIncrease = currentlyUnlimited ? true : (val > stored);

    if (!isIncrease) {
      // Decreasing (or unchanged) tightens the rule — apply immediately, free.
      const state = await getConfig();
      const currentLimits = state[kind.persistKey] || {};
      if (!currentLimits[target]) currentLimits[target] = { maxGrants: 3 };
      currentLimits[target].maxMinutes = val;
      await sendBg({ action: 'saveSettings', config: { [kind.persistKey]: currentLimits } });
      await rerender();
      return;
    }

    // Increasing the limit loosens the rule — must be approved by the coach
    // (or applied outright, if this row is in simple mode).
    e.target.value = currentMins; // revert until/unless approved
    applyOrGate({
      isSimple,
      isApp: kind.isApp,
      appLabel: kind.isApp ? label : undefined,
      changeType: kind.increaseLimit,
      domain: target,
      currentValue: currentlyUnlimited ? -1 : stored,
      newValue: val,
      title: `Raise the absolute daily max on ${label}?`,
      subtitle: `Going from ${currentlyUnlimited ? 'unlimited' : stored + 'm/day'} to ${val}m/day gives you more time on ${label}. Convince your coach.`,
      onApproved: rerender
    });
  }, { info: true }));

  // Which parts of the target are blocked, in BOTH modes. A part rule decides
  // whether the block applies at all, which is a question that comes before
  // "and then what happens" — checkFromStorage reaches the part verdict before
  // it resolves a mode, and a simple-mode row that silently ignored the rule
  // would open the very sections the user had shut.
  if (kind.hasParts) {
    li.appendChild(buildRowPartsField(target, label, limitInfo, kind, globalMode, rerender));
  }

  if (isSimple) {
    fields.appendChild(buildSimpleBehaviorField(target, label, limitInfo, kind, rerender));
    return;
  }

  // Coach-only from here down.
  li.appendChild(buildLooseTimelineField(target, label, limitInfo, kind, currentMins, rerender));
  li.appendChild(buildRowReasonFields(target, label, kind, serviceReasons, allBlockedTargets(), rerender));
}

function renderDomains(domains, limits = {}, globalMode = 'coach', serviceReasons = {}) {
  renderSiteRecommendations('sites-recommend-grid', 'sites-recommend-more', domains);
  const list = document.getElementById('domain-list');
  list.innerHTML = '';
  if (!domains.length) {
    renderEmptyList(list, 'No websites blocked yet. Tap "+ Add website" — it suggests a few.');
    return;
  }
  const rerender = async () => {
    const state = await getConfig();
    renderDomains(state.blockedDomains || [], state.domainLimits || {}, state.blockingMode, state.serviceReasons || {});
  };
  for (const d of domains) {
    const limitInfo = limits[d] || { maxGrants: 3, maxMinutes: DEFAULT_DAILY_MAX_MINUTES };

    const { li, fields } = buildBlockedRow({
      target: d,
      label: d,
      headExtra: buildRowModeToggle(d, d, limitInfo, globalMode, 'domainLimits', rerender),
      onRemove: () => removeDomain(d, effectiveModeFor(limitInfo, globalMode) === 'simple')
    });

    buildRowBody({
      li, fields, target: d, label: d, limitInfo, globalMode,
      kind: ROW_KINDS.domain, serviceReasons, rerender
    });
    list.appendChild(li);
  }
}

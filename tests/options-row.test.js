// options.js — the blocked-row controls, and the one rule they all obey.
//
// The settings page runs tighten-free / loosen-gated: a change that makes the
// rules stricter saves itself the moment you make it, and a change that makes
// them looser has to be argued with the coach first. Two of the row's controls
// are new to that rule — the loose -> strict split, where LOWERING is the
// tightening, and the two site-specific answers, where the FIRST write is free
// and every edit after it is not — so both directions are covered here.
//
// options.js is a browser script with no exports and no test-only seams, so it
// is evaluated in a vm against a DOM thin enough to build an element tree in.
// The builders under test only ever create elements, set properties on them
// and attach handlers; nothing here needs layout, selectors or a real event
// loop, and a shim that answers exactly that is smaller and more honest about
// what is being tested than a full jsdom would be.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadSource, filesForContext } from './load.js';

// ---- The DOM shim ---------------------------------------------------------

function makeElement(tagName) {
  const classes = new Set();
  const attrs = {};
  const handlers = {};
  const node = {
    tagName,
    children: [],
    style: {},
    hidden: false,
    _handlers: handlers,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !classes.has(c) : !!on;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      }
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    parentNode: null,
    appendChild: (child) => { child.parentNode = node; node.children.push(child); return child; },
    append: (...kids) => {
      for (const kid of kids) kid.parentNode = node;
      node.children.push(...kids);
    },
    // Enough of a tree to detach from: the part picker closes itself, and the
    // chips repaint by taking away exactly the nodes they put up.
    remove: () => {
      const parent = node.parentNode;
      if (!parent) return;
      parent.children = parent.children.filter(c => c !== node);
      node.parentNode = null;
    },
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
    querySelector: () => null
  };
  return node;
}

// Depth-first, in document order — which is the order the builders append in,
// so "the first .row-reason-input" is the first question on screen.
function findAll(node, className) {
  const out = [];
  const walk = (n) => {
    if (!n || !n.children) return;
    for (const child of n.children) {
      if (typeof child.className === 'string' && child.className.split(' ').includes(className)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

const find = (node, className) => findAll(node, className)[0];

// Handlers here are async; every caller awaits, so a change that persists is
// settled by the time the assertion runs.
const fire = (node, type) =>
  Promise.all((node._handlers[type] || []).map(fn => fn({ target: node })));

// ---- The context ----------------------------------------------------------

let ctx;
let doc;     // the shim document, so a test can answer getElementById itself
let saved;   // every saveSettings config the page wrote, in order
let gates;   // every coach gate it opened instead
let config;  // what getConfig answers with

// `host` is what the page's window looks like: the Android bridge publishes
// window.intentionApps, the iOS one window.intentionScreenTime, and a browser
// neither. The section-rule control asks which of the three it is in, so the
// tests have to be able to say.
function load({ host = {} } = {}) {
  saved = [];
  gates = [];

  const chrome = {
    runtime: {
      getURL: (p) => p,
      lastError: null,
      sendMessage: (msg, cb) => {
        if (msg.action === 'getConfig') return cb(structuredClone(config));
        if (msg.action === 'saveSettings') saved.push(structuredClone(msg.config));
        cb({ ok: true });
      }
    },
    storage: { local: { get: (_k, cb) => cb && cb({}), set: (_o, cb) => cb && cb(), remove: (_k, cb) => cb && cb() } }
  };

  doc = {
    addEventListener() {},
    getElementById: () => null,
    createElement: makeElement,
    body: makeElement('body')
  };
  const document = doc;

  // options.html's own <script> list, minus the two the row builders never
  // touch (billing.js needs a paywall DOM, report.js a real event loop).
  // Stated as an exclusion, so a script added to the page reaches these
  // tests without anybody remembering to add it here.
  ctx = loadSource(filesForContext('options', { except: ['billing.js', 'report.js'] }), {
    chrome,
    extraGlobals: {
      document,
      window: host,
      navigator: { userAgent: 'Chrome/120' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
    }
  });

  // The coach gate is a modal with a chat in it; all these tests need to know
  // is that it was opened, and what it was asked to approve.
  ctx.openGateModal = (args) => { gates.push(args); };
}

const noop = async () => {};

beforeEach(() => {
  config = {
    blockedDomains: ['instagram.com'],
    blockedApps: [],
    appLabels: {},
    blockingMode: 'coach',
    domainLimits: { 'instagram.com': { maxGrants: 3, maxMinutes: 45, looseUntilMinutes: 15 } },
    appLimits: {},
    serviceReasons: {}
  };
  load();
});

// ---------------------------------------------------------------------------

describe('the loose -> strict timeline', () => {
  const build = (limitInfo, max = 45) =>
    ctx.buildLooseTimelineField('instagram.com', 'instagram.com', limitInfo, ctx.ROW_KINDS.domain, max, noop);

  it('is a real range input, so it is keyboard-operable without any ARIA', () => {
    const field = build({ looseUntilMinutes: 15 });
    const range = find(field, 'row-timeline-range');
    expect(range.tagName).toBe('input');
    expect(range.type).toBe('range');
    expect(range.min).toBe('0');
    expect(range.max).toBe('45');
    expect(range.getAttribute('aria-label')).toContain('before the coach turns strict');
    // A bare "15" doesn't say what it counts.
    expect(range.getAttribute('aria-valuetext')).toBe('15 of 45 minutes lenient, then strict');
  });

  it('hides the painted band from the accessibility tree', () => {
    // The band says the same thing the range already announces. Two voices
    // saying "loose, strict, 15" is one too many.
    const band = find(build({ looseUntilMinutes: 15 }), 'row-timeline-band');
    expect(band.getAttribute('aria-hidden')).toBe('true');
  });

  it('pairs the range with a number box carrying the same value and label', () => {
    const field = build({ looseUntilMinutes: 15 });
    const number = find(field, 'row-timeline-number');
    expect(number.type).toBe('number');
    expect(number.value).toBe('15');
    expect(number.getAttribute('aria-label')).toBe(find(field, 'row-timeline-range').getAttribute('aria-label'));
  });

  // Absent means no split at all, which is lenient all day — so the handle
  // opens at the far right rather than inventing a line the user never drew.
  it('opens at the far right when no split was ever set', () => {
    const field = build({ maxMinutes: 45 });
    expect(find(field, 'row-timeline-number').value).toBe('45');
    expect(find(field, 'row-timeline-range').getAttribute('aria-valuetext'))
      .toBe('lenient all day, no strict phase');
    expect(find(field, 'row-timeline-note').textContent).toContain('never turns strict');
  });

  it('lowering it shortens the lenient window — saved directly, no coach', async () => {
    const field = build({ looseUntilMinutes: 15 });
    const number = find(field, 'row-timeline-number');
    number.value = '5';
    await fire(number, 'change');

    expect(gates).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0].domainLimits['instagram.com'].looseUntilMinutes).toBe(5);
    expect(number.value).toBe('5');
  });

  it('raising it lengthens the window — gated, and not written meanwhile', async () => {
    const field = build({ looseUntilMinutes: 15 });
    const number = find(field, 'row-timeline-number');
    number.value = '30';
    await fire(number, 'change');

    expect(saved).toEqual([]);
    expect(gates).toHaveLength(1);
    expect(gates[0].changeType).toBe('increase_loose_window');
    expect(gates[0].domain).toBe('instagram.com');
    expect(gates[0].currentValue).toBe(15);
    expect(gates[0].newValue).toBe(30);
    // Reverted on screen until the coach says otherwise.
    expect(number.value).toBe('15');
  });

  it('drawing a first split out of "lenient all day" is a tightening', async () => {
    const field = build({ maxMinutes: 45 });
    const number = find(field, 'row-timeline-number');
    number.value = '20';
    await fire(number, 'change');

    expect(gates).toEqual([]);
    expect(saved[0].domainLimits['instagram.com'].looseUntilMinutes).toBe(20);
  });

  it('the range and the number box are two ways into the same field', async () => {
    const field = build({ looseUntilMinutes: 15 });
    const range = find(field, 'row-timeline-range');
    range.value = '4';
    await fire(range, 'change');
    expect(saved[0].domainLimits['instagram.com'].looseUntilMinutes).toBe(4);
    // Dragging repaints the number too, so the two never disagree on screen.
    expect(find(field, 'row-timeline-number').value).toBe('4');
  });

  it('dragging paints but does not save — only letting go commits', async () => {
    const field = build({ looseUntilMinutes: 15 });
    const range = find(field, 'row-timeline-range');
    range.value = '3';
    await fire(range, 'input');
    expect(saved).toEqual([]);
    expect(find(field, 'row-timeline-number').value).toBe('3');
  });

  it('clamps a typed value to the track and ignores an unreadable one', async () => {
    const field = build({ looseUntilMinutes: 15 });
    const number = find(field, 'row-timeline-number');

    number.value = '900';
    await fire(number, 'change');
    // 900 past a 45-minute max is "lenient all day", which is longer: gated.
    expect(gates).toHaveLength(1);
    expect(gates[0].newValue).toBe(45);

    number.value = 'soon';
    await fire(number, 'change');
    expect(saved).toEqual([]);
    expect(number.value).toBe('15');
  });

  it('a split left beyond a since-lowered max reads as lenient all day', () => {
    // Lowering the daily max is a tightening that saves itself, so a stored
    // split can end up past the end of the track.
    const field = build({ looseUntilMinutes: 40 }, 10);
    expect(find(field, 'row-timeline-number').value).toBe('10');
  });

  it('an app row gates through the app change type', async () => {
    const field = ctx.buildLooseTimelineField(
      'com.instagram.android', 'the Instagram app',
      { looseUntilMinutes: 15 }, ctx.ROW_KINDS.app, 45, noop
    );
    const number = find(field, 'row-timeline-number');
    number.value = '30';
    await fire(number, 'change');
    expect(gates[0].changeType).toBe('increase_app_loose_window');
    expect(gates[0].isApp).toBe(true);
  });
});

describe('the two site-specific answers', () => {
  const build = (target = 'instagram.com', label = 'instagram.com', kind = 'domain') =>
    ctx.buildRowReasonFields(target, label, ctx.ROW_KINDS[kind], config.serviceReasons, [], noop);

  it('is two labelled boxes in the row, not a collapsed disclosure', () => {
    const wrap = build();
    const labels = findAll(wrap, 'row-reason-label').map(l => l.textContent);
    expect(labels).toEqual(["Why you're blocking it", 'Why you need it']);
    expect(findAll(wrap, 'row-reason-input')).toHaveLength(2);
    // The visible caption repeats down the page; the accessible one doesn't.
    expect(findAll(wrap, 'row-reason-input')[1].getAttribute('aria-label'))
      .toBe('Why you need it — instagram.com');
  });

  it('says where an answer is shared, because editing here edits there', () => {
    const wrap = ctx.buildRowReasonFields(
      'instagram.com', 'instagram.com', ctx.ROW_KINDS.domain, {},
      [{ target: 'com.instagram.android', label: 'the Instagram app' }], noop
    );
    expect(find(wrap, 'row-reason-shared').textContent)
      .toContain('Shared with the Instagram app');
  });

  // There is no weak moment to guard against before anything exists, which is
  // the same reason the coach-context card's first write is direct.
  it('the first write of a field is direct', async () => {
    const wrap = build();
    const purpose = findAll(wrap, 'row-reason-input')[0];
    purpose.value = 'It eats my evenings.';
    await fire(purpose, 'change');

    expect(gates).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0].serviceReasons['instagram.com'].purpose).toBe('It eats my evenings.');
  });

  it('every edit after that goes through the coach', async () => {
    config.serviceReasons = { 'instagram.com': { purpose: 'It eats my evenings.', updatedAt: 1 } };
    load();
    ctx.openGateModal = (args) => { gates.push(args); };

    const wrap = ctx.buildRowReasonFields(
      'instagram.com', 'instagram.com', ctx.ROW_KINDS.domain, config.serviceReasons, [], noop
    );
    const purpose = findAll(wrap, 'row-reason-input')[0];
    expect(purpose.value).toBe('It eats my evenings.');

    purpose.value = 'Actually it is fine.';
    await fire(purpose, 'change');

    expect(saved).toEqual([]);
    expect(gates).toHaveLength(1);
    expect(gates[0].changeType).toBe('edit_site_purpose');
    expect(gates[0].currentValue).toBe('It eats my evenings.');
    expect(gates[0].newValue).toBe('Actually it is fine.');
    // Reverted on screen until the coach says otherwise.
    expect(purpose.value).toBe('It eats my evenings.');
  });

  // The two fields are independent: an answered "why you're blocking it" must
  // not put a gate in front of a blank "why you need it".
  it('the two fields count their first write separately', async () => {
    config.serviceReasons = { 'instagram.com': { purpose: 'It eats my evenings.', updatedAt: 1 } };
    load();
    ctx.openGateModal = (args) => { gates.push(args); };

    const wrap = ctx.buildRowReasonFields(
      'instagram.com', 'instagram.com', ctx.ROW_KINDS.domain, config.serviceReasons, [], noop
    );
    const legitimate = findAll(wrap, 'row-reason-input')[1];
    legitimate.value = 'One specific DM.';
    await fire(legitimate, 'change');

    expect(gates).toEqual([]);
    expect(saved[0].serviceReasons['instagram.com']).toEqual({
      purpose: 'It eats my evenings.',
      legitimateUse: 'One specific DM.',
      updatedAt: expect.any(Number)
    });
  });

  it('does nothing at all when the text comes back unchanged', async () => {
    config.serviceReasons = { 'instagram.com': { purpose: 'It eats my evenings.', updatedAt: 1 } };
    load();
    ctx.openGateModal = (args) => { gates.push(args); };

    const wrap = ctx.buildRowReasonFields(
      'instagram.com', 'instagram.com', ctx.ROW_KINDS.domain, config.serviceReasons, [], noop
    );
    const purpose = findAll(wrap, 'row-reason-input')[0];
    purpose.value = '  It eats my evenings.  ';
    await fire(purpose, 'change');

    expect(gates).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('reads the stored answer through the service key, not the target', () => {
    config.serviceReasons = { 'instagram.com': { legitimateUse: 'One specific DM.', updatedAt: 1 } };
    load();
    // serviceKeyFor folds the app onto the site's answer — same service.
    const wrap = ctx.buildRowReasonFields(
      'com.instagram.android', 'the Instagram app', ctx.ROW_KINDS.app,
      config.serviceReasons, [], noop
    );
    expect(findAll(wrap, 'row-reason-input')[1].value).toBe('One specific DM.');
  });
});

describe('the Coach / Simple toggle', () => {
  const build = (limitInfo, globalMode = 'coach') =>
    ctx.buildRowModeToggle('instagram.com', 'instagram.com', limitInfo, globalMode, 'domainLimits', noop);

  it('shows the mode that is in force, and announces which is chosen', () => {
    // No override, global is coach: the row is a coach row.
    const [coach, simple] = findAll(build({}), 'row-mode-btn');
    expect(coach.getAttribute('aria-pressed')).toBe('true');
    expect(simple.getAttribute('aria-pressed')).toBe('false');
    expect(coach.classList.contains('selected')).toBe(true);
  });

  it('follows a per-row override over the global default', () => {
    const [coach, simple] = findAll(build({ mode: 'simple' }), 'row-mode-btn');
    expect(coach.getAttribute('aria-pressed')).toBe('false');
    expect(simple.getAttribute('aria-pressed')).toBe('true');
  });

  it('names the row it belongs to, so ten of them are not ten bare "Coach"es', () => {
    expect(build({}).getAttribute('aria-label')).toBe('How instagram.com is blocked');
    expect(build({}).getAttribute('role')).toBe('group');
  });

  it('writes an override when the choice disagrees with the global', async () => {
    const [, simple] = findAll(build({}), 'row-mode-btn');
    await fire(simple, 'click');
    expect(saved[0].domainLimits['instagram.com'].mode).toBe('simple');
    // The simple-only fields come with it, defaulted.
    expect(saved[0].domainLimits['instagram.com'].behavior).toBe('pass');
    expect(saved[0].domainLimits['instagram.com'].passMinutes).toBe(10);
  });

  // Two buttons, three stored states. Choosing the mode that already matches
  // the global drops the override rather than freezing it, so the row goes
  // back to following the global blocking-mode card.
  it('drops the override when the choice matches the global again', async () => {
    config.domainLimits['instagram.com'].mode = 'simple';
    load();
    const [coach] = findAll(build({ mode: 'simple' }), 'row-mode-btn');
    await fire(coach, 'click');
    expect('mode' in saved[0].domainLimits['instagram.com']).toBe(false);
  });

  it('clears the simple-only fields on the way back to coach', async () => {
    config.domainLimits['instagram.com'] = { maxGrants: 3, mode: 'simple', behavior: 'hard', passMinutes: 25 };
    load();
    const [coach] = findAll(build({ mode: 'simple', behavior: 'hard', passMinutes: 25 }), 'row-mode-btn');
    await fire(coach, 'click');
    const entry = saved[0].domainLimits['instagram.com'];
    expect('behavior' in entry).toBe(false);
    expect('passMinutes' in entry).toBe(false);
  });

  it('saves nothing when you pick the mode already in force', async () => {
    const [coach] = findAll(build({}), 'row-mode-btn');
    await fire(coach, 'click');
    expect(saved).toEqual([]);
  });
});

describe('the absolute daily max', () => {
  it('is named for what it is, and explains itself on request', () => {
    const field = ctx.buildDailyLimitField(45, 'instagram.com', () => {}, { info: true });
    expect(find(field, 'micro-label').textContent).toBe('Absolute daily max');
    const info = find(field, 'row-info-btn');
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(info.getAttribute('aria-controls')).toBe(find(field, 'row-info-note').id);
    expect(find(field, 'row-info-note').textContent).toContain('a ceiling, not a target');
  });

  it('the explanation is a disclosure, not a hover', async () => {
    const field = ctx.buildDailyLimitField(45, 'instagram.com', () => {}, { info: true });
    const info = find(field, 'row-info-btn');
    const note = find(field, 'row-info-note');
    expect(note.hidden).toBe(true);
    await fire(info, 'click');
    expect(note.hidden).toBe(false);
    expect(info.getAttribute('aria-expanded')).toBe('true');
  });

  it('the wizard rows get the field without a second explanation', () => {
    const field = ctx.buildDailyLimitField(10, 'instagram.com', () => {});
    expect(find(field, 'row-info-btn')).toBeUndefined();
  });
});

// The suggestion chips live in the add dialog now, but the wizard's site and
// app steps have always had a chip grid inline under their "+ Add" button — so
// opening the dialog from the wizard drew the same twelve suggestions on top
// of the twelve already on screen.
describe('the add dialog and the wizard do not both show suggestions', () => {
  function openFrom({ inWizard }) {
    const setupView = makeElement('main');
    setupView.hidden = !inWizard;
    const suggestions = makeElement('div');
    const modal = makeElement('div');
    modal.hidden = true;
    modal.querySelector = (sel) => (sel === '.add-modal-suggestions' ? suggestions : null);
    const input = makeElement('input');
    input.focus = () => {};

    doc.getElementById = (id) => ({
      'setup-view': setupView,
      'add-site-modal': modal,
      'domain-input': input
    }[id] || null);
    doc.activeElement = null;

    ctx.openAddModal('add-site-modal', 'domain-input');
    return { modal, suggestions };
  }

  it('hides the dialog copy while the wizard is on screen', () => {
    const { modal, suggestions } = openFrom({ inWizard: true });
    expect(modal.hidden).toBe(false);
    expect(suggestions.hidden).toBe(true);
  });

  it('shows them in settings, where the dialog is the only place they are', () => {
    const { suggestions } = openFrom({ inWizard: false });
    expect(suggestions.hidden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parts of the site.
//
// The scope toggle and the chips under it. Everything here is about the row's
// one rule applied to a control where the DIRECTION of an edit is not obvious
// from the gesture: adding a part to an 'only' list blocks MORE, and adding
// the same part to an 'except' list blocks LESS. parts.js answers that
// (partEditIsLoosening) and these assert that the row asks it rather than
// guessing.
// ---------------------------------------------------------------------------

describe('the parts-of-the-site control', () => {
  const build = (entry, label = 'instagram.com') =>
    ctx.buildRowPartsField('instagram.com', label, entry, ctx.ROW_KINDS.domain, 'coach', noop);

  const scopeButtons = (field) => findAll(field, 'row-scope-btn');
  const pressed = (field) => scopeButtons(field)
    .filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => b.textContent);
  const helperText = (field) => find(field, 'row-parts-helper').textContent;
  const chipLabels = (field) => findAll(field, 'row-part-chip')
    .map(c => c.children[0].textContent);

  it('offers the three scopes as a named group with the stored one pressed', () => {
    const field = build({ scope: 'only', parts: ['instagram:reels'] });
    const group = find(field, 'row-scope-toggle');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Which parts of instagram.com are blocked');
    expect(scopeButtons(field).map(b => b.textContent))
      .toEqual(['All of it', 'Only some parts', 'All except']);
    expect(pressed(field)).toEqual(['Only some parts']);
  });

  it('opens on "All of it" for every row written before this existed', () => {
    const field = build({ maxGrants: 3, maxMinutes: 45 });
    expect(pressed(field)).toEqual(['All of it']);
    // Nothing to list and nothing to explain until a scope is chosen.
    expect(find(field, 'row-parts-helper').hidden).toBe(true);
  });

  it('lists the stored parts by the names parts.js gives them', () => {
    const field = build({ scope: 'except', parts: ['reddit:sub:rust', 'path:/reels/*'] });
    expect(chipLabels(field)).toEqual(['r/rust', 'address /reels/*']);
  });

  // THE copy fix. An empty 'only' list fails CLOSED — resolvePartVerdict gates
  // everything and hasPartRule answers false, so the host keeps its redirect
  // rule. The first draft of this line said "nothing on instagram.com is
  // blocked at all", which is the exact opposite of what the code does, and a
  // blocker that lies about which way it failed is worse than one that fails.
  it('tells the truth about an empty list: the site is still blocked', async () => {
    const field = build({ maxGrants: 3 });
    await fire(scopeButtons(field)[1], 'click');
    expect(helperText(field)).toBe(
      'Nothing listed yet, so all of instagram.com is still blocked. Add a part to say which bit you mean.'
    );
    // The other empty scope says the same thing, because it means the same
    // thing: nothing is carved out, so nothing is open.
    const other = build({ maxGrants: 3 });
    await fire(scopeButtons(other)[2], 'click');
    expect(helperText(other)).toBe('Nothing listed yet, so all of instagram.com is blocked.');
  });

  // Choosing a scope with nothing in it changes nothing about what is blocked,
  // so there is nothing to save and nothing to argue with the coach about.
  it('writes nothing, and asks nothing, until the scope names a part', async () => {
    const field = build({ maxGrants: 3 });
    await fire(scopeButtons(field)[1], 'click');
    expect(saved).toEqual([]);
    expect(gates).toEqual([]);
    expect(pressed(field)).toEqual(['Only some parts']);
  });

  it('explains what each scope means once it has something to act on', () => {
    expect(helperText(build({ scope: 'only', parts: ['instagram:reels'] })))
      .toBe('Only the parts below are blocked. Everything else on instagram.com stays open.');
    expect(helperText(build({ scope: 'except', parts: ['instagram:dms'] })))
      .toBe('All of instagram.com is blocked except the parts below.');
  });

  describe('the direction of an edit', () => {
    // Every one of these is the same sentence applied four ways: any edit that
    // leaves LESS of the site blocked goes through the coach, and every other
    // edit saves itself.
    it('gates the first carve-out out of a fully blocked site', async () => {
      const field = build({ maxGrants: 3 });
      await fire(scopeButtons(field)[1], 'click');
      await fire(find(field, 'row-parts-add'), 'click');
      const picker = doc.body.children.at(-1);
      await fire(findAll(picker, 'part-picker-option')[0], 'click');
      // The picker closes behind the pick — it is the row's control, not a
      // panel that stays up.
      expect(doc.body.children).not.toContain(picker);

      expect(saved).toEqual([]);
      expect(gates).toHaveLength(1);
      expect(gates[0].changeType).toBe('narrow_block_scope');
      expect(gates[0].newValue).toEqual({ scope: 'only', parts: ['instagram:reels'] });
      expect(gates[0].currentValue).toEqual({ scope: 'all', parts: [] });
      expect(gates[0].title).toBe('Block less of instagram.com?');
      expect(gates[0].subtitle).toContain('Right now all of instagram.com');
      expect(gates[0].subtitle).toContain("You're asking for only Reels on instagram.com");
    });

    it('saves a part ADDED to an only list, because it blocks more', async () => {
      const field = build({ maxGrants: 3, scope: 'only', parts: ['instagram:reels'] });
      await fire(find(field, 'row-parts-add'), 'click');
      const picker = doc.body.children.at(-1);
      const explore = findAll(picker, 'part-picker-option').find(b => b.textContent === 'Explore');
      await fire(explore, 'click');

      expect(gates).toEqual([]);
      expect(saved).toHaveLength(1);
      expect(saved[0].domainLimits['instagram.com'].parts)
        .toEqual(['instagram:reels', 'instagram:explore']);
    });

    it('gates a part REMOVED from an only list, because it blocks less', async () => {
      const field = build({ maxGrants: 3, scope: 'only', parts: ['instagram:reels', 'instagram:explore'] });
      await fire(find(field, 'row-part-chip-remove'), 'click');
      expect(saved).toEqual([]);
      expect(gates).toHaveLength(1);
      expect(gates[0].newValue).toEqual({ scope: 'only', parts: ['instagram:explore'] });
      // Reverted meanwhile: nothing changes until the coach agrees.
      expect(chipLabels(field)).toEqual(['Reels', 'Explore']);
    });

    it('gates a part ADDED to an except list, and saves one removed from it', async () => {
      const added = build({ maxGrants: 3, scope: 'except', parts: ['instagram:dms'] });
      await fire(find(added, 'row-parts-add'), 'click');
      await fire(findAll(doc.body.children.at(-1), 'part-picker-option')[0], 'click');
      expect(gates).toHaveLength(1);
      expect(saved).toEqual([]);

      gates.length = 0;
      const removed = build({ maxGrants: 3, scope: 'except', parts: ['instagram:dms', 'instagram:reels'] });
      await fire(find(removed, 'row-part-chip-remove'), 'click');
      expect(gates).toEqual([]);
      expect(saved).toHaveLength(1);
      expect(saved[0].domainLimits['instagram.com'].parts).toEqual(['instagram:reels']);
    });

    // Going back to "block all of it" is the tightening every other control on
    // the row treats the same way: free, immediate, no conversation.
    it('saves a return to "All of it" and deletes both keys', async () => {
      const field = build({ maxGrants: 3, scope: 'only', parts: ['instagram:reels'] });
      await fire(scopeButtons(field)[0], 'click');
      expect(gates).toEqual([]);
      expect(saved).toHaveLength(1);
      const entry = saved[0].domainLimits['instagram.com'];
      expect('scope' in entry).toBe(false);
      expect('parts' in entry).toBe(false);
    });

    // 'only' and 'except' cannot be compared by list membership — the same two
    // ids mean opposite things on either side of the switch — so parts.js
    // answers "unprovable" and the row asks.
    it('gates a switch between only and except', async () => {
      const field = build({ maxGrants: 3, scope: 'only', parts: ['instagram:reels'] });
      await fire(scopeButtons(field)[2], 'click');
      expect(saved).toEqual([]);
      expect(gates).toHaveLength(1);
      expect(gates[0].newValue).toEqual({ scope: 'except', parts: ['instagram:reels'] });
    });
  });

  describe('the picker', () => {
    // A scope with nothing under it is not a state storage can hold — an empty
    // list collapses to no rule — so a fresh row reaches it the way the user
    // does, by choosing the scope first.
    const open = async (entry = { maxGrants: 3 }) => {
      const field = build(entry);
      if (pressed(field)[0] === 'All of it') await fire(scopeButtons(field)[1], 'click');
      find(field, 'row-parts-add')._handlers.click[0]({});
      return { field, picker: doc.body.children.at(-1) };
    };

    // The corollary, and the reason the picker can assume a scope: there is no
    // way to open it while the whole site is blocked.
    it('cannot be opened at all while the scope is "All of it"', () => {
      const field = build({ maxGrants: 3 });
      expect(find(field, 'row-parts-add').hidden).toBe(true);
    });

    it('offers the catalogue for the service the row is for', async () => {
      const { picker } = await open();
      const labels = findAll(picker, 'part-picker-option').map(b => b.textContent);
      expect(labels).toContain('Reels');
      expect(labels).toContain('Direct messages');
      // A parameterised part is offered under its picker name, not under a
      // label that needs an argument it does not have yet.
      expect(labels).not.toContain('undefined');
    });

    it('shows a part already on the list, disabled rather than missing', async () => {
      const { picker } = await open({ maxGrants: 3, scope: 'only', parts: ['instagram:reels'] });
      const reels = findAll(picker, 'part-picker-option').find(b => b.textContent === 'Reels');
      expect(reels.disabled).toBe(true);
      expect(reels.getAttribute('aria-disabled')).toBe('true');
    });

    it('accepts a hand-written address, and refuses something that is not one', async () => {
      const { picker } = await open();
      const custom = findAll(picker, 'input-group')[0];
      const input = custom.children.find(c => c.tagName === 'input');
      const addBtn = custom.children.find(c => c.tagName === 'button');

      input.value = 'not an address';
      await fire(addBtn, 'click');
      expect(gates).toEqual([]);
      expect(saved).toEqual([]);
      expect(doc.body.children).toContain(picker); // still open, with an error

      input.value = '/reels/*';
      await fire(addBtn, 'click');
      expect(gates).toHaveLength(1);
      expect(gates[0].newValue).toEqual({ scope: 'only', parts: ['path:/reels/*'] });
    });

    // X serves "For You" and "Following" from the same /home, so they are not
    // separate parts. Saying so in the picker is the only honest place: the
    // alternative is a part that silently never matches.
    it('says outright what X cannot distinguish', async () => {
      const field = ctx.buildRowPartsField('x.com', 'x.com', { maxGrants: 3 }, ctx.ROW_KINDS.domain, 'coach', noop);
      await fire(findAll(field, 'row-scope-btn')[1], 'click');
      find(field, 'row-parts-add')._handlers.click[0]({});
      const picker = doc.body.children.at(-1);
      const note = find(picker, 'part-picker-note');
      expect(note.textContent).toContain("can't tell them apart");
    });
  });

  it('is offered on both kinds of row', () => {
    expect(ctx.ROW_KINDS.app.hasParts).toBe(true);
    expect(ctx.ROW_KINDS.domain.hasParts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The same control on an app row
// ---------------------------------------------------------------------------
//
// The feature the user asked for by name ("removal of reels from the instagram
// app") and the reason it needs its own suite: the answer comes from reading
// somebody else's screen rather than from the address bar, so it exists on
// Android, only for the packages AppParts.kt has a table for, and never on
// iOS — and every one of those three has to be true in the UI as well as in
// the Kotlin, or the row is describing a rule that does not bind.

const ANDROID = { intentionApps: {} };
const IOS = { intentionScreenTime: {} };

// The Kotlin table, read from the file that ships it. The JS mirror in
// options-rows.js exists because the APK's table cannot be asked anything from
// a web page; this test is what stops the duplicate from drifting, which is the
// only thing that makes duplicating it acceptable at all.
function kotlinAppParts() {
  const src = readFileSync(
    new URL('../Intention Android/app/src/main/java/uk/co/maybeitssoftware/intention/AppParts.kt', import.meta.url),
    'utf8'
  );
  const table = src.slice(src.indexOf('APP_PARTS: Map<String, List<PartSignal>>'));
  const out = {};
  let current = null;
  for (const line of table.split('\n')) {
    const pkg = /^\s*"([a-z0-9_.]+)" to listOf\(/.exec(line);
    if (pkg) { current = pkg[1]; out[current] = out[current] || []; continue; }
    const part = /partId = "([^"]+)"/.exec(line);
    if (part && current && !out[current].includes(part[1])) out[current].push(part[1]);
  }
  return out;
}

// What AppParts.verdict() answers for a screen it could not name, read out of
// the file that ships that decision.
//
// The row's degradation copy is that answer written in the user's words, and
// words are the only half of it this page can hold — the behaviour itself is
// in the APK. So the sentence is checked against the behaviour rather than
// against a previous version of itself: a string pin cannot tell a sentence
// that is RIGHT from one that is merely UNCHANGED, and this table has already
// been wrong in exactly that way. It promised an unrecognised screen would let
// you through on an 'only' rule; the Kotlin stopped doing that; the test that
// pinned the promise is what kept it on screen, pointing someone at the option
// they thought was the cautious one and handing them a wholly blocked app.
//
// Returns the tail of verdict() — everything after the branch that handles a
// screen we DID recognise, which is case 4, "could not tell" — parsed for the
// two things the copy depends on: whether it gates, and whether it looks at
// the scope at all before deciding.
function kotlinUnrecognisedVerdict() {
  const src = readFileSync(
    new URL('../Intention Android/app/src/main/java/uk/co/maybeitssoftware/intention/AppParts.kt', import.meta.url),
    'utf8'
  );
  const closeOf = (text, from) => {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return i;
    }
    return -1;
  };
  const start = src.indexOf('fun verdict(rule: PartRule');
  if (start < 0) throw new Error('AppParts.kt no longer declares fun verdict(rule: PartRule ...)');
  const open = src.indexOf('{', start);
  const body = src.slice(open + 1, closeOf(src, open));
  const recognised = body.indexOf('if (detected != null)');
  if (recognised < 0) throw new Error('AppParts.kt verdict() no longer branches on a recognised screen');
  const afterRecognised = closeOf(body, body.indexOf('{', recognised));
  // Comments are prose about the decision, not the decision — and this test is
  // reading Kotlin with a regex, so it gets to look at as little of it as
  // possible.
  const tail = body
    .slice(afterRecognised + 1)
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
  return {
    gated: /gated\s*=\s*true/.test(tail),
    // Whether the answer depends on which scope was chosen. One return, no
    // branch, no scope constant: both scopes get the same answer.
    perScope: /\bif\b/.test(tail) || /SCOPE_(ONLY|EXCEPT)/.test(tail)
  };
}

describe('section rules on an app row', () => {
  const build = (target, label, entry = { maxGrants: 3 }) =>
    ctx.buildRowPartsField(target, label, entry, ctx.ROW_KINDS.app, 'coach', noop);

  const scopeButtons = (field) => findAll(field, 'row-scope-btn');
  const helperText = (field) => find(field, 'row-parts-helper').textContent;

  it('offers the same three scopes for a package Android can see inside', () => {
    load({ host: ANDROID });
    const field = build('com.instagram.android', 'Instagram');
    expect(scopeButtons(field).map(b => b.textContent))
      .toEqual(['All of it', 'Only some parts', 'All except']);
    expect(find(field, 'row-parts-unavailable')).toBeUndefined();
  });

  // The picker resolves a package onto its website (serviceKeyFor), so the
  // vocabulary is one list shared with the browser — "only Reels" means the
  // same thing in Chrome and in the app.
  it('offers only the sections the shipped table can actually recognise', async () => {
    load({ host: ANDROID });
    const field = build('com.instagram.android', 'Instagram');
    await fire(scopeButtons(field)[1], 'click');
    find(field, 'row-parts-add')._handlers.click[0]({});
    const picker = doc.body.children.at(-1);
    const labels = findAll(picker, 'part-picker-option').map(b => b.textContent);
    expect(labels).toEqual(['Reels', 'Explore', 'Stories', 'Direct messages', 'Home feed']);
    // Posts is in the web catalogue and NOT in the Kotlin table: nothing in
    // the app would ever answer with it, so a rule naming it could only ever
    // block the whole app.
    expect(labels).not.toContain('Posts');
  });

  // An address rule is a match against a URL, and there are no URLs inside an
  // app. Offering the box would be offering a way to blank the rule.
  it('does not offer the hand-written address box', async () => {
    load({ host: ANDROID });
    const field = build('com.instagram.android', 'Instagram');
    await fire(scopeButtons(field)[1], 'click');
    find(field, 'row-parts-add')._handlers.click[0]({});
    const picker = doc.body.children.at(-1);
    const captions = findAll(picker, 'micro-label').map(p => p.textContent);
    expect(captions).not.toContain('Or match an address yourself');
    expect(findAll(picker, 'input-group')).toHaveLength(0);
  });

  it('saves a tightening and gates a loosening, exactly as a site row does', async () => {
    load({ host: ANDROID });
    const field = build('com.instagram.android', 'Instagram', { maxGrants: 3, scope: 'only', parts: ['instagram:reels'] });
    await fire(find(field, 'row-parts-add'), 'click');
    const explore = findAll(doc.body.children.at(-1), 'part-picker-option')
      .find(b => b.textContent === 'Explore');
    await fire(explore, 'click');
    expect(gates).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0].appLimits['com.instagram.android'].parts)
      .toEqual(['instagram:reels', 'instagram:explore']);

    await fire(find(field, 'row-part-chip-remove'), 'click');
    expect(gates).toHaveLength(1);
    expect(gates[0].changeType).toBe('narrow_app_block_scope');
    expect(gates[0].isApp).toBe(true);
    expect(gates[0].appLabel).toBe('Instagram');
  });

  // The copy has to match what the native side does on the day the app ships a
  // release we cannot read, and the two scopes degrade in opposite directions.
  describe('what it says about failing', () => {
    it('promises nothing an app update cannot take away', async () => {
      load({ host: ANDROID });
      const field = build('com.instagram.android', 'Instagram');
      const note = find(field, 'row-info-note');
      expect(note.textContent).toContain('best-effort');
      expect(note.textContent).toContain('depends on the version of the app');
      // The fail-closed half, in the user's words: a section this build cannot
      // recognise blocks the whole app rather than opening it.
      expect(note.textContent).toContain('blocks the whole app rather than opening it');
    });

    // Both scopes, because they used to fail in OPPOSITE directions and this
    // row said so. AppParts.verdict() now gates for either one when it cannot
    // recognise the screen, so a caveat still promising "it lets you through"
    // on an `only` rule would send someone to the softer-looking option and
    // hand them a wholly blocked app. Neither sentence may say that again, and
    // both have to name the way out — a gated app still opens the coach.
    it('says which way each scope fails, once that scope is chosen', async () => {
      load({ host: ANDROID });
      for (const [scope, parts] of [['except', ['instagram:dms']], ['only', ['instagram:reels']]]) {
        const field = build('com.instagram.android', 'Instagram', { maxGrants: 3, scope, parts });
        const caveat = find(field, 'row-parts-caveat').textContent;
        expect(caveat).toContain('the whole app stays blocked');
        expect(caveat).toContain('Your coach still opens');
        expect(caveat).not.toContain('lets you through');
        expect(caveat).not.toContain('softer');
      }
    });

    // The same claim, checked against the thing that makes it true rather than
    // against itself. verdict()'s "could not tell what this screen is" answer
    // is one return with no scope in it — both scopes gate — so both sentences
    // have to describe a blocked app, and neither may offer a way through the
    // app will not give. Fails if the copy goes back to promising one, and
    // fails if the Kotlin goes back to fail-open under copy that says
    // otherwise: either way the row would be describing a rule that does not
    // bind.
    it('agrees with what AppParts.kt does on a screen it cannot name', () => {
      const answer = kotlinUnrecognisedVerdict();
      expect(answer.gated).toBe(true);
      expect(answer.perScope).toBe(false);

      load({ host: ANDROID });
      for (const [scope, parts] of [['only', ['instagram:reels']], ['except', ['instagram:dms']]]) {
        const field = build('com.instagram.android', 'Instagram', { maxGrants: 3, scope, parts });
        const caveat = find(field, 'row-parts-caveat').textContent;
        expect(caveat).toMatch(/the whole app stays blocked/);
        expect(caveat).not.toMatch(/lets you through|stays open|opens anyway/);
      }
    });

    it('says nothing of the sort on a site row, where the address is exact', () => {
      load({ host: ANDROID });
      const field = ctx.buildRowPartsField(
        'instagram.com', 'instagram.com', { maxGrants: 3, scope: 'only', parts: ['instagram:reels'] },
        ctx.ROW_KINDS.domain, 'coach', noop
      );
      expect(find(field, 'row-parts-caveat').hidden).toBe(true);
    });

    it('speaks about an app rather than a website throughout', async () => {
      load({ host: ANDROID });
      const field = build('com.google.android.youtube', 'YouTube', { maxGrants: 3, scope: 'except', parts: ['youtube:subs'] });
      expect(find(field, 'micro-label').textContent).toBe('Parts of the app');
      expect(helperText(field)).toBe('All of YouTube is blocked except the sections below.');
      expect(find(field, 'row-parts-add').textContent).toBe('+ Add a section');
    });
  });

  // The two refusals. Both say why, in the field where the control would have
  // been: a control that is simply missing teaches nobody anything, and one
  // that is present and cannot bind is worse.
  it('refuses a package the shipped table cannot see inside, and says so', () => {
    load({ host: ANDROID });
    const field = build('com.zhiliaoapp.musically', 'TikTok');
    expect(scopeButtons(field)).toHaveLength(0);
    const note = find(field, 'row-parts-unavailable');
    expect(note.textContent).toContain('Sections are not available for TikTok yet');
    expect(note.textContent).toContain('All of TikTok is blocked, as before.');
  });

  // No bridge at all is the same answer as a package we cannot see inside of,
  // and deliberately so: the table is read by the Android accessibility
  // service, so without that host there is nothing on the other end of the
  // rule. An offered control that cannot bind is the one thing this field must
  // never be.
  it('refuses it with no native host at all', () => {
    load();
    const field = build('com.instagram.android', 'Instagram');
    expect(scopeButtons(field)).toHaveLength(0);
    expect(find(field, 'row-parts-unavailable')).toBeDefined();
  });

  it('never offers it on iOS, and explains that it is Screen Time, not a gap', () => {
    load({ host: IOS });
    const field = build('com.instagram.android', 'Instagram');
    expect(scopeButtons(field)).toHaveLength(0);
    const note = find(field, 'row-parts-unavailable');
    expect(note.textContent).toContain('Screen Time');
    expect(note.textContent).toContain('not possible here');
  });

  // The duplicate, kept honest. If the Kotlin grows an app or a signal and this
  // list does not, the settings page either hides a rule that would work or
  // offers one that cannot — and nothing else in the repo would notice.
  it('offers exactly what AppParts.kt can detect, package for package', () => {
    load({ host: ANDROID });
    const kotlin = kotlinAppParts();
    expect(Object.keys(kotlin).length).toBeGreaterThan(0);
    expect(Object.keys(ctx.APP_PART_IDS).sort()).toEqual(Object.keys(kotlin).sort());
    for (const [pkg, ids] of Object.entries(kotlin)) {
      expect([...ctx.APP_PART_IDS[pkg]].sort()).toEqual([...new Set(ids)].sort());
    }
  });
});

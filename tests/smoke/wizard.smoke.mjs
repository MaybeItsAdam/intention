// End-to-end smoke test: walking the real setup wizard in a real Chromium,
// against the real unpacked extension.
//
// The vm tests in tests/ can tell you computeStepOrder returns the right list.
// They cannot tell you that showStep reveals the right section, that a section
// reused for N services actually repaints between them, that a draft written
// on step 6 comes back to step 6, or that the answers survive Finish and reach
// storage. Those are the questions this answers, by clicking Next.
//
// Run: node tests/smoke/wizard.smoke.mjs [--headed]

import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXTENSION_DIR = join(REPO_ROOT, 'Intention Chrome');
const HEADED = process.argv.includes('--headed');

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  const mark = pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${mark} ${name}${detail && !pass ? `\n    ${detail}` : ''}`);
};

// Which section is actually on screen, and what the counter claims. Read
// together because the bug worth catching is them disagreeing.
const visibleStep = (page) => page.evaluate(() => {
  const shown = [...document.querySelectorAll('.setup-step')].filter(s => !s.hidden);
  return {
    ids: shown.map(s => s.id),
    title: shown[0]?.querySelector('h3')?.textContent || '',
    label: document.getElementById('setup-progress-label').textContent
  };
});

const next = async (page) => {
  await page.click('#setup-next-btn');
  await page.waitForTimeout(60);
};

async function main() {
  const profile = await mkdtemp(join(tmpdir(), 'intention-wizard-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: !HEADED,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`
    ]
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;

    const page = await context.newPage();
    await page.goto(optionsUrl);
    await page.evaluate(() => chrome.storage.local.clear());
    await page.reload();
    await page.waitForSelector('#setup-view:not([hidden])');

    // ── The wizard opens on welcome, and announces the per-service run.
    let step = await visibleStep(page);
    record('opens on the welcome step', step.ids.join() === 'setup-step-welcome', JSON.stringify(step));

    const agenda = await page.textContent('#setup-welcome-checklist');
    record('the welcome agenda promises ONE screen for the questions',
      /one screen for what each one is for/i.test(agenda), agenda.slice(0, 200));

    // ── Pick two sites. This is a browser build, so there is no apps step.
    await next(page);
    step = await visibleStep(page);
    record('reaches the sites step', step.ids.join() === 'setup-step-sites', JSON.stringify(step));

    await page.evaluate(async () => {
      await addDomainToBlocklist('instagram.com', 10);
      await addDomainToBlocklist('some-blog.example', 10);
    });
    await page.waitForTimeout(60);

    // ── The lenient/strict slider is now settable here, not only in settings.
    // It shares its markup with the settings row but not its rule: there is no
    // coach to argue past yet, so a drag in either direction just takes.
    const sliders = await page.locator('#setup-websites-list .row-timeline-range').count();
    record('every setup row carries the loose/strict slider', sliders === 2, `found ${sliders}`);

    const sliderMax = await page.locator('#setup-websites-list .row-timeline-range').first().getAttribute('max');
    record('the slider spans the row\'s own daily max', sliderMax === '10', sliderMax);

    // Lengthening the window is the direction settings makes you argue for.
    // Here it must simply apply, and survive into the draft.
    await page.locator('#setup-websites-list .row-timeline-number').first().fill('3');
    await page.locator('#setup-websites-list .row-timeline-number').first().dispatchEvent('change');
    await page.waitForTimeout(80);
    const drafted = await page.evaluate(() => setupDomainLimits['instagram.com']?.looseUntilMinutes);
    record('a change on it lands in the draft with no coach gate', drafted === 3, String(drafted));

    // ── The counter must NOT move when the list does. This is the inverse of
    // what this test used to assert: the per-service questions were one step
    // each, so two sites made seven steps and a third made eight — the
    // denominator moving under the finger of the person adding them. A browser
    // build is welcome + sites + purpose + mode + access + done, always six.
    step = await visibleStep(page);
    record('the step count is a constant six on a browser build',
      step.label === 'Step 2 of 6', step.label);

    await page.evaluate(() => addDomainToBlocklist('example.org', 10));
    await page.waitForTimeout(80);
    step = await visibleStep(page);
    record('and adding a third site does not move it',
      step.label === 'Step 2 of 6', step.label);

    // Back to two, through the row's own Remove button.
    await page.click('#setup-websites-list li:last-child .delete-btn');
    await page.waitForTimeout(80);
    const remaining = await page.locator('#setup-websites-list li').count();
    record('removing it leaves the other two', remaining === 2, `found ${remaining}`);

    // ── One screen, one card per service.
    await next(page);
    step = await visibleStep(page);
    record('reaches the single purpose step',
      step.ids.join() === 'setup-step-purpose', JSON.stringify(step));

    const stack = () => page.evaluate(() => [...document.querySelectorAll('#setup-purpose-stack .setup-service')]
      .map(li => ({
        service: li.dataset.service,
        name: li.querySelector('.setup-service-name').textContent,
        open: li.querySelector('.setup-service-head').getAttribute('aria-expanded') === 'true',
        state: li.querySelector('.setup-service-state').textContent,
        preview: li.querySelector('.setup-service-preview').textContent,
        next: li.querySelector('.setup-service-next').textContent
      })));

    let cards = await stack();
    record('one card per service, named from the catalogue',
      cards.length === 2 && cards[0].name === 'Instagram' && cards[1].name === 'some-blog.example',
      JSON.stringify(cards.map(c => c.name)));
    record('the first is open and the rest are collapsed',
      cards[0].open === true && cards[1].open === false, JSON.stringify(cards.map(c => c.open)));
    record('the last card does not pretend there is another one after it',
      cards[0].next === 'Next: some-blog.example' && /that's all of them/.test(cards[1].next),
      JSON.stringify(cards.map(c => c.next)));

    const counter = () => page.textContent('#setup-purpose-count');
    record('the run says how long it is, in its own counter',
      (await counter()) === '0 of 2 answered', await counter());

    // ── A tap is the whole interaction, and the preview is what makes it read
    // as a consequence rather than a form field.
    const chip = (service, bucket, id) =>
      page.locator(`[data-service="${service}"] [data-bucket="${bucket}"][data-chip="${id}"]`);

    await chip('instagram.com', 'needs', 'dm').click();
    await page.waitForTimeout(60);
    cards = await stack();
    record('tapping a chip presses it',
      (await chip('instagram.com', 'needs', 'dm').getAttribute('aria-pressed')) === 'true');
    record('and rewrites the preview into what the coach will do',
      cards[0].preview === 'Your coach will hear you out for a DM reply — and push back on the feed, Reels and Explore.',
      cards[0].preview);
    record('and marks the card answered', cards[0].state === 'Answered', cards[0].state);
    record('and moves the stack counter', (await counter()) === '1 of 2 answered', await counter());

    await chip('instagram.com', 'needs', 'sent').click();
    await page.waitForTimeout(60);
    cards = await stack();
    record('a second chip joins the first in the preview',
      cards[0].preview.includes('a DM reply or a link someone sent you'), cards[0].preview);

    // The free text is a refinement under the chips, not the main event: it
    // has to be revealed before it can be typed into.
    const noteToggle = (service, i) =>
      page.locator(`[data-service="${service}"] .setup-service-note-toggle`).nth(i);
    const note = (service, i) =>
      page.locator(`[data-service="${service}"] .setup-service-note`).nth(i);

    // ── The phone case, and the one that used to lose the answer outright.
    //
    // Every chip click repaints the card, and the repaint syncs each textarea
    // back from the stored answer. On a phone the textarea has not blurred
    // when that happens: iOS Safari and the Android WebView do not reliably
    // move focus to a <button> on tap, so no 'change' event has fired and the
    // stored answer is still empty — which is what the repaint wrote over the
    // half-typed sentence. A dispatched click reproduces exactly that here: it
    // runs the chip's handler without moving focus, which a real Playwright
    // click (Chromium DOES focus a button) would not.
    await noteToggle('instagram.com', 0).click();
    await note('instagram.com', 0).click();
    await note('instagram.com', 0).pressSequentially('Only my sister messages, never the feed');
    await chip('instagram.com', 'costs', 'hours').dispatchEvent('click');
    await page.waitForTimeout(60);
    const stillFocused = await page.evaluate(() =>
      document.activeElement?.classList.contains('setup-service-note'));
    record('a tap that does not move focus is what the repro needs', stillFocused === true,
      String(stillFocused));
    const survived = await note('instagram.com', 0).inputValue();
    record('a chip tapped with the keyboard still up does not wipe the note',
      survived === 'Only my sister messages, never the feed', JSON.stringify(survived));

    // ...and the keystrokes reached the answer object, so Finish would save
    // them even if this textarea never blurs at all.
    const banked = await page.evaluate(() => setupServiceAnswers['instagram.com']?.needsNote);
    record('and the typed sentence is already banked in the draft answers',
      banked === 'Only my sister messages, never the feed', JSON.stringify(banked));

    await chip('instagram.com', 'costs', 'hours').dispatchEvent('click');
    await page.waitForTimeout(60);

    await note('instagram.com', 0).fill('A specific reply. Never the feed.');
    await note('instagram.com', 0).blur();
    await page.waitForTimeout(60);

    // The cost side's own note. Left as free text here so the tail of this
    // file — the settings row, the app pairing, the gated second write — reads
    // exactly the same prose it always did, which is the proof that the
    // storage shape did not move when the input did.
    await noteToggle('instagram.com', 1).click();
    await note('instagram.com', 1).fill('DMs from my sister.');
    await note('instagram.com', 1).blur();
    await page.waitForTimeout(60);

    // ── The footer button moves the accordion on, and it is the thing a phone
    // user actually presses.
    await page.click('[data-service="instagram.com"] .setup-service-next');
    await page.waitForTimeout(60);
    cards = await stack();
    record('Next collapses the card and opens the following one',
      cards[0].open === false && cards[1].open === true, JSON.stringify(cards.map(c => c.open)));

    // ── The draft round-trip. This is where the old per-service index bug
    // lived: the step is stored, and so is which card was open.
    await page.reload();
    await page.waitForSelector('#setup-view:not([hidden])');
    await page.waitForTimeout(150);
    step = await visibleStep(page);
    cards = await stack();
    record('a reload returns to the purpose step, not to step 1',
      step.ids.join() === 'setup-step-purpose', JSON.stringify(step));
    record('the denominator is the same six it was before the reload',
      step.label === 'Step 3 of 6', step.label);
    record('the chip tapped before the reload is still pressed',
      (await chip('instagram.com', 'needs', 'dm').getAttribute('aria-pressed')) === 'true');
    record('and the card that was open is still the open one',
      cards[1].open === true, JSON.stringify(cards.map(c => c.open)));

    // ── "Nothing — I just want it gone" is exclusive in both directions.
    await chip('some-blog.example', 'needs', 'sent').click();
    await page.waitForTimeout(60);
    await chip('some-blog.example', 'needs', 'none').click();
    await page.waitForTimeout(60);
    cards = await stack();
    record('the "nothing" chip clears the reasons beside it',
      (await chip('some-blog.example', 'needs', 'sent').getAttribute('aria-pressed')) === 'false');
    record('and swaps the preview to starting from no',
      /start every visit from no/.test(cards[1].preview), cards[1].preview);
    record('and says so on the collapsed head', cards[1].state === 'Blocked outright', cards[1].state);

    await chip('some-blog.example', 'needs', 'none').click();
    await page.waitForTimeout(60);

    await noteToggle('some-blog.example', 1).click();
    await note('some-blog.example', 1).fill('Reading one author.');
    await note('some-blog.example', 1).blur();
    await page.waitForTimeout(60);

    // ── Skip is the way past the whole step, and it must not be the way past
    // the wizard.
    await page.click('#setup-purpose-skip-btn');
    await page.waitForTimeout(60);
    step = await visibleStep(page);
    record('Skip leaves the questions behind and lands on the mode step',
      step.ids.join() === 'setup-step-mode', JSON.stringify(step));

    // ── Simple mode must not change the denominator (the bug the access step
    // is unconditionally in the order to avoid).
    const beforeToggle = (await visibleStep(page)).label;
    await page.click('#setup-mode-simple-btn');
    await page.waitForTimeout(60);
    const afterToggle = (await visibleStep(page)).label;
    record('toggling to Simple does not move the step count',
      beforeToggle === afterToggle, `${beforeToggle} -> ${afterToggle}`);
    await page.click('#setup-mode-coach-btn');
    await page.waitForTimeout(60);

    // ── Finish, and check what actually landed in storage.
    await next(page);
    await next(page);
    step = await visibleStep(page);
    record('ends on the done step', step.ids.join() === 'setup-step-done', JSON.stringify(step));

    await page.click('#setup-save-btn');
    await page.waitForSelector('#settings-view:not([hidden])', { timeout: 5000 });

    const stored = await page.evaluate(() => new Promise(done =>
      chrome.storage.local.get(['serviceReasons', 'setupDraft'], done)));

    record('the answers reached storage under the service key',
      stored.serviceReasons?.['instagram.com']?.purpose === 'DMs from my sister.',
      JSON.stringify(stored.serviceReasons));
    record('both halves of the answer survived',
      stored.serviceReasons?.['instagram.com']?.legitimateUse?.includes('Never the feed'));
    record('the hand-typed domain kept its own answer',
      stored.serviceReasons?.['some-blog.example']?.purpose === 'Reading one author.');
    record('the draft was cleared on finish', stored.setupDraft === undefined);

    // ── The settings row shows it back, and says nothing false about sharing.
    await page.waitForTimeout(200);
    const rowSummary = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#domain-list li')];
      return rows.map(li => ({
        name: li.querySelector('.domain-name')?.textContent,
        value: li.querySelector('.row-reason-input')?.value,
        shared: li.querySelector('.row-reason-shared')?.textContent || null
      }));
    });
    const insta = rowSummary.find(r => r.name === 'instagram.com');
    record('the settings row offers the same two questions back',
      insta?.value === 'DMs from my sister.', JSON.stringify(rowSummary));
    record('and does not claim to be shared when only the site is blocked',
      insta?.shared === null, JSON.stringify(insta));

    // ── Now block the Instagram app too. The two rows must read as one
    // service: the same answer in both, and each saying the edit reaches the
    // other.
    //
    // The apps card only renders where a native bridge exists, so Chrome never
    // calls renderApps on its own — it is driven directly here. Still the real
    // function against the real DOM; only the platform gate is bypassed.
    await page.evaluate(() => new Promise(done => chrome.runtime.sendMessage({
      action: 'saveSettings',
      config: {
        blockedApps: ['com.instagram.android'],
        appLimits: { 'com.instagram.android': { maxGrants: 3, maxMinutes: 10 } },
        appLabels: { 'com.instagram.android': 'Instagram' }
      }
    }, done)));

    const paired = await page.evaluate(async () => {
      const s = await getConfig();
      renderApps(s.blockedApps, s.appLimits, s.appLabels, s.blockingMode, s.serviceReasons);
      renderDomains(s.blockedDomains, s.domainLimits, s.blockingMode, s.serviceReasons);
      const read = (sel) => [...document.querySelectorAll(sel)].map(li => ({
        value: li.querySelector('.row-reason-input')?.value,
        shared: li.querySelector('.row-reason-shared')?.textContent || null
      }));
      return { sites: read('#domain-list li'), apps: read('#app-list li') };
    });

    const appRow = paired.apps[0];
    record('the Instagram app row inherits the website\'s answer',
      appRow?.value === 'DMs from my sister.', JSON.stringify(paired.apps));
    record('and tells the user the edit reaches both',
      /same service/i.test(appRow?.shared || ''), JSON.stringify(appRow?.shared));
    record('the website row now names the app as its pair',
      /Instagram app/.test(paired.sites.find(r => r.value === 'DMs from my sister.')?.shared || ''),
      JSON.stringify(paired.sites));

    const blogRow = paired.sites.find(r => r.value === 'Reading one author.');
    record('an unrelated site is not dragged into the pairing',
      blogRow?.shared === null, JSON.stringify(blogRow));

    // ── Writing from the app row must land on the website's answer, or the
    // "shared" line above is a lie. Blank one half first, so the box being
    // typed into is a FIRST write: those go straight in, exactly as the
    // coach-context card's first write does — there is no weak moment to
    // guard against before an answer exists.
    await page.evaluate(() => new Promise(done => chrome.runtime.sendMessage({
      action: 'saveSettings',
      config: { serviceReasons: { 'instagram.com': { purpose: 'DMs from my sister.' } } }
    }, done)));
    await page.evaluate(async () => {
      const s = await getConfig();
      renderApps(s.blockedApps, s.appLimits, s.appLabels, s.blockingMode, s.serviceReasons);
      const area = [...document.querySelectorAll('#app-list li .row-reason-input')][1];
      area.value = 'Only to reply, never to browse.';
      area.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);
    const afterFirst = await page.evaluate(() => new Promise(done =>
      chrome.storage.local.get('serviceReasons', r => done(r.serviceReasons))));
    record('a first answer typed on the app row lands on the shared key, not a second copy',
      afterFirst['instagram.com']?.legitimateUse === 'Only to reply, never to browse.'
        && afterFirst['com.instagram.android'] === undefined,
      JSON.stringify(afterFirst));

    // ── Every edit AFTER that is a rule the coach already reasons from, so it
    // costs a conversation. Nothing may reach storage until one is had, and
    // the box reverts to the stored wording meanwhile.
    const afterSecond = await page.evaluate(async () => {
      const area = [...document.querySelectorAll('#app-list li .row-reason-input')][1];
      area.value = 'Anything I feel like, actually.';
      area.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 300));
      const stored = await new Promise(done =>
        chrome.storage.local.get('serviceReasons', r => done(r.serviceReasons)));
      return { stored, shown: area.value };
    });
    record('editing an answer that already exists does not write silently',
      afterSecond.stored['instagram.com']?.legitimateUse === 'Only to reply, never to browse.',
      JSON.stringify(afterSecond.stored));
    record('and the box reverts until the coach agrees',
      afterSecond.shown === 'Only to reply, never to browse.', afterSecond.shown);

    if (HEADED) await page.waitForTimeout(5000);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('wizard smoke test crashed:', err);
  process.exit(1);
});

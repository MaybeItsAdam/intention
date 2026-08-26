// The two native store clients, read as source text.
//
// Nothing in this suite can run Swift or Kotlin — CI's `validate` job is Linux
// and has neither toolchain — so these are textual assertions, the same shape
// as the backend-URL check in parity.test.js and for the same reason. Both
// defects pinned here were comments asserting a property the code underneath
// did not have, on the one code path that no browser test can ever reach: the
// native half of a paid balance surviving a reinstall. A comment cannot hold
// that. This can.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, loadBilling } from './load.js';

const SWIFT = join(REPO_ROOT, 'Intention Apple', 'Shared (App)', 'IntentionStore.swift');
const KOTLIN = join(REPO_ROOT, 'Intention Android', 'app', 'src', 'main', 'java',
  'uk', 'co', 'maybeitssoftware', 'intention', 'BillingManager.kt');
const OPTIONS_ACCESS = join(REPO_ROOT, 'shared', 'options-access.js');
const BILLING = join(REPO_ROOT, 'shared', 'billing.js');

// Pull one Swift/Kotlin function — signature and body — out of a source file by
// name, brace-counting to the close. Matching on the whole function rather than
// grepping the file means "there is no `return true` here" is a claim about
// THAT function, not about the eight hundred lines around it.
function functionBody(source, name) {
  const start = source.search(new RegExp(`(func|fun) ${name}\\s*\\(`));
  if (start < 0) return null;
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; seenBrace = true; }
    else if (source[i] === '}') {
      depth--;
      if (seenBrace && depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

describe('Apple recovery does not spend a request on a launch with nothing to recover', () => {
  const swift = readFileSync(SWIFT, 'utf8');

  // The defect this replaced: the guard was "no entitlement token in the App
  // Group", which the comment above it called a cold install. It is not one.
  // Nobody who has never bought credit ever has a token, so recoverBalance()
  // ran on every process launch for the life of the install — and iOS jetsams
  // backgrounded apps often enough to make that ten launches an hour. Ten
  // misses is exactly RECOVER_FAILS in server/src/app.js, after which that IP
  // is answered 429 and a genuine reinstall behind the same NAT cannot recover
  // the balance it paid for.
  it('gates recovery on a throttle marker, not merely on the absence of a token', () => {
    const guard = functionBody(swift, 'shouldAttemptRecovery');
    expect(guard, 'shouldAttemptRecovery() not found in IntentionStore.swift').toBeTruthy();
    expect(guard).toContain('"token"');
    expect(guard).toContain('"recoveryCheckedAt"');
  });

  it('calls that guard from start(), and nothing else', () => {
    const start = functionBody(swift, 'start');
    expect(start).toContain('await shouldAttemptRecovery()');
    // The old token-only predicate must not survive alongside the new one:
    // two guards would be two answers to one question.
    expect(swift).not.toContain('appGroupHasEntitlementToken');
  });

  it('writes the marker once the server has actually answered', () => {
    const recover = functionBody(swift, 'recoverBalance');
    expect(recover).toContain('await stampRecoveryChecked()');
    // A 429 or a 5xx means the question never got put. Suppressing the next
    // day of launches over an outage would strand a real balance for a day.
    expect(recover).toMatch(/status == 200 \|\| status == 404/);

    const stamp = functionBody(swift, 'stampRecoveryChecked');
    expect(stamp, 'stampRecoveryChecked() not found').toBeTruthy();
    expect(stamp).toContain('entitlement["recoveryCheckedAt"]');
    expect(stamp).toContain('AppGroupStorage.mergeConfig');
    // Merged onto whatever is already stored, never written as a fresh
    // entitlement: a miss must not be able to conjure `active` or a token.
    expect(stamp).toContain('"active": false');
  });

  it('does not drop the marker the next time an entitlement is persisted', () => {
    const persist = functionBody(swift, 'persistEntitlement');
    expect(persist).toContain('"recoveryCheckedAt": existing?["recoveryCheckedAt"]');
  });

  // The marker is the JS layer's field, in the JS layer's units, in the object
  // both layers already pass through the App Group — deliberately, because
  // there are two recovery paths and with a marker each they both fired on the
  // same launch, each spending a request the other had just proved pointless.
  it('uses the same field name the web layer writes', () => {
    const billing = readFileSync(BILLING, 'utf8');
    const field = /(\w+): Number\(raw\.recoveryCheckedAt \|\| 0\)/.exec(billing);
    expect(field, 'normalizeEntitlement no longer normalises recoveryCheckedAt').toBeTruthy();
    expect(field[1]).toBe('recoveryCheckedAt');
    expect(swift).toContain('"recoveryCheckedAt"');
  });

  it('waits the same 24 hours the web layer waits', () => {
    const js = /const RECOVERY_RECHECK_MS = ([^;]+);/.exec(readFileSync(OPTIONS_ACCESS, 'utf8'));
    expect(js, 'RECOVERY_RECHECK_MS not found in options-access.js').toBeTruthy();

    const sw = /recoveryRecheckMs: Double = ([^\n]+)/.exec(swift);
    expect(sw, 'recoveryRecheckMs not found in IntentionStore.swift').toBeTruthy();

    // Both are plain arithmetic over integer literals in both languages.
    const evalArith = (src) => {
      expect(src.trim()).toMatch(/^[\d\s*+]+$/);
      return Function(`return (${src})`)();
    };
    expect(evalArith(sw[1])).toBe(evalArith(js[1]));
    expect(evalArith(sw[1])).toBe(24 * 60 * 60 * 1000);
  });

  // The marker only crosses between the app and the Safari extension because
  // `entitlement` is a synced config key; drop it from that list and the two
  // layers go back to throttling each other's requests not at all.
  it('rides on a key the App Group actually syncs', () => {
    const config = readFileSync(
      join(REPO_ROOT, 'Intention Apple', 'Shared (iOS)', 'AppGroupConfig.swift'), 'utf8');
    expect(/configKeys[\s\S]*?"entitlement"/.test(config)).toBe(true);
  });
});

describe('Android answers "was this account id restored?" as the tri-state it is', () => {
  const kotlin = readFileSync(KOTLIN, 'utf8');
  const restored = functionBody(kotlin, 'accountTokenRestored');

  it('finds the function', () => {
    expect(restored, 'accountTokenRestored() not found in BillingManager.kt').toBeTruthy();
  });

  // shared/billing.js is explicit: `undefined` means "this build cannot tell"
  // and every caller must treat it as "say nothing" rather than as false.
  // Answering a three-valued question with a Boolean forced "cannot tell" to
  // pick a side, and it picked `true` — so every install predating the
  // minted-at stamp claimed forever that its id had come back from a backup.
  it('returns a nullable Boolean', () => {
    expect(kotlin).toMatch(/fun accountTokenRestored\(\)\s*:\s*Boolean\?/);
  });

  it('never asserts "restored" when it cannot tell', () => {
    // The only true this function may produce is the timestamp comparison
    // itself. Every "cannot tell" branch — no context, no minted-at stamp
    // because the id predates the field, PackageManager refusing to answer —
    // has to be null.
    expect(restored).not.toMatch(/\breturn true\b/);
    expect(restored).toContain('appContext ?: return null');
    expect(restored).toContain('if (mintedAt <= 0L) return null');
    expect(restored).toContain('mintedAt < info.firstInstallTime');

    const catchArm = restored.slice(restored.indexOf('catch'));
    expect(catchArm).toContain('null');
    expect(catchArm).not.toMatch(/(^|\s)true(\s|$)/);
  });

  // Nothing back-fills the stamp, and that is correct — back-filling would set
  // it to "now" for someone who has held the same id for months and so call
  // their perfectly good account freshly minted forever after. Which is
  // precisely why "no stamp" has to stay unanswerable rather than become a
  // claim in either direction.
  it('still stamps only on mint, so "no stamp" keeps meaning "cannot tell"', () => {
    const mint = functionBody(kotlin, 'stableAccountId');
    expect(mint).toContain('account_id_minted_at');
    const others = kotlin.split('account_id_minted_at').length - 1;
    const inMint = mint.split('account_id_minted_at').length - 1;
    const inRestored = restored.split('account_id_minted_at').length - 1;
    expect(others).toBe(inMint + inRestored);
  });
});

// The other half of the contract, on the side that reads it. An absent key and
// a `false` are different answers, and the web layer has to keep telling them
// apart — this is what the Kotlin above is shaped to satisfy.
describe('storeAccountRestored() keeps all three answers distinct', () => {
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';

  const ask = (payload) => {
    const { ctx } = loadBilling({
      window: { intentionBilling: { accountToken: (cb) => cb(payload) } },
      userAgent: ANDROID_UA
    });
    return ctx.storeAccountRestored();
  };

  it('reads an omitted field as "cannot tell", not as "not restored"', async () => {
    // The wire shape Apple has always sent, and the one Android now sends for
    // an install that predates the minted-at stamp.
    await expect(ask({ token: 'abc' })).resolves.toBeUndefined();
  });

  it('reads an explicit false as "minted here"', async () => {
    await expect(ask({ token: 'abc', restored: false })).resolves.toBe(false);
  });

  it('reads an explicit true as "something put it back"', async () => {
    await expect(ask({ token: 'abc', restored: true })).resolves.toBe(true);
  });
});

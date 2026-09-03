// Guards on the two hand-kept lists that decide what an Apple or Android build
// actually contains. Neither is derived from anything, so both can disagree
// with the code that depends on them while every other check stays green.
//
// This is the check CI was missing when Apple rejected 0.22.1 under guideline
// 2.1(a): "the app launched to a blank page" on an iPad Air 11-inch. The iOS
// app target was missing the eight files options.html loads, showSetupView()
// lives in options-wizard.js, and so the DOMContentLoaded handler threw
// ReferenceError before unhiding either <main>. A blank page is the exact
// symptom of a missing bundle resource, because nothing about it fails loudly:
// the build succeeds, the app launches, and the page just never renders.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './load.js';

// Xcode target membership is per target, and the failure mode is per target:
// the same eight files were missing from the extension targets (4dde53c) and
// then from the app target. The parsing lives in a python script because
// build.sh's preflight runs the identical check before a release build --
// better one implementation both callers share than two that drift.
describe('Xcode targets bundle every file their own pages load', () => {
  it('scripts/check-xcode-bundle.py passes', () => {
    let output;
    try {
      output = execFileSync('python3', [join(REPO_ROOT, 'scripts', 'check-xcode-bundle.py')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      throw new Error(`${err.stdout || ''}${err.stderr || ''}`);
    }
    expect(output).toMatch(/^OK: /);
  });
});

// background.js runs in three places. In the extension it is a background
// script and the browser loads its siblings from the manifest. In the iOS app
// and in the Android app it runs inside a plain hidden WebView, where its own
// importScripts() call is a no-op -- importScripts only exists in a worker, and
// the call sits in a try/catch that swallows the ReferenceError. So in those
// two hosts the <script> tags in background.html are the ONLY thing that loads
// its dependencies, and anything missing is an undefined global the first time
// a message handler reaches for it.
//
// The iOS host was loading four of the eight. background.js calls
// extractPageContextFromUrl (page_context.js), resolveBlockConfig (rules.js),
// pageScopeFor (parts.js) and serviceKeyFor (sites.js), so four of its
// dependencies were simply absent.
describe('WebView hosts load every background script the manifest declares', () => {
  // manifest.base.json has no background block -- MV3 Chrome gets a service
  // worker and only the Firefox/Safari overlays carry a scripts array. The
  // Apple overlay is the right authority for both WebView hosts: they are
  // running the non-worker flavour of background.js.
  const declared = JSON.parse(
    readFileSync(join(REPO_ROOT, 'shared', 'manifest.apple.json'), 'utf8')
  ).background.scripts;

  const hosts = {
    'iOS app': join(REPO_ROOT, 'Intention Apple', 'Shared (App)', 'Resources', 'background.html'),
    android: join(REPO_ROOT, 'Intention Android', 'app', 'src', 'main', 'assets', 'background.html')
  };

  it('reads the list from the manifest rather than a hand-kept copy', () => {
    expect(declared).toContain('background.js');
    expect(declared.length).toBeGreaterThan(4);
  });

  it.each(Object.keys(hosts))('%s background.html loads them all, in order', (host) => {
    const html = readFileSync(hosts[host], 'utf8');
    const loaded = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    expect(loaded).toEqual(declared);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTimeline, extractStyle } from '../bin/pr-timeline.mjs';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

// A tiny repo exercising the diff-tree parser: modify, add, rename, binary.
function fixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'prtl-test-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@e.st');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD').trim();

  writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  writeFileSync(path.join(repo, 'b.js'), 'export const x = 1;\nexport const y = 2;\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'edit a, add b');

  git(repo, 'mv', 'a.txt', 'a2.txt');                       // 100% rename
  writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255, 3]));
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'rename a, add binary');

  return { repo, base };
}

test('loadTimeline parses status, numstat, renames, and binary', () => {
  const { repo, base } = fixture();
  const { commits } = loadTimeline(repo, base, 'main');
  assert.equal(commits.length, 2, 'base is excluded; two commits remain');

  const byPath = (c) => Object.fromEntries(c.files.map((f) => [f.path, f]));
  const [c2, c3] = commits;

  const f2 = byPath(c2);
  assert.equal(f2['a.txt'].status, 'M');
  assert.ok(f2['a.txt'].additions >= 1);
  assert.equal(f2['b.js'].status, 'A');
  assert.equal(f2['b.js'].additions, 2);
  assert.equal(f2['b.js'].deletions, 0);
  assert.equal(f2['b.js'].binary, false);

  const f3 = byPath(c3);
  assert.equal(f3['a2.txt'].status, 'R');
  assert.equal(f3['a2.txt'].oldPath, 'a.txt');
  assert.equal(f3['bin.dat'].status, 'A');
  assert.equal(f3['bin.dat'].binary, true);
});

test('extractStyle lifts the trailer and strips it from the body', () => {
  const commits = [{ body: 'do a thing\n\nNarrative-Style: wishful-api' }];
  assert.equal(extractStyle(commits), 'wishful-api');
  assert.equal(commits[0].body, 'do a thing');

  assert.equal(extractStyle([{ body: 'no trailer here' }]), null);
});

// A branch that merged main mid-flight: the merge itself has no single-parent
// diff, so it must not become an empty, unenterable step.
test('loadTimeline skips merge commits', () => {
  const { repo, base } = fixture();
  git(repo, 'switch', '-q', '-c', 'feature');
  writeFileSync(path.join(repo, 'feat.txt'), 'feature work\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'add feature');

  git(repo, 'switch', '-q', 'main');
  writeFileSync(path.join(repo, 'other.txt'), 'unrelated\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'unrelated main work');

  git(repo, 'switch', '-q', 'feature');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge main into feature', 'main');
  const mergeBase = git(repo, 'merge-base', 'main', 'feature').trim();

  const { commits } = loadTimeline(repo, mergeBase, 'feature');
  assert.ok(!commits.some((c) => c.subject.startsWith('Merge ')), 'no merge commits');
  assert.ok(commits.every((c) => c.files.length > 0), 'every step has files to show');
  assert.ok(commits.some((c) => c.subject === 'add feature'), 'branch work is kept');
});

// Representations under .pr-timeline/reps/ travel with the commits but never
// show up as code; reps already on base don't leak into the range.
test('loadTimeline lists reps per step and keeps them out of files', () => {
  const { repo, base } = fixture();
  const repsDir = path.join(repo, '.pr-timeline', 'reps');
  mkdirSync(repsDir, { recursive: true });
  writeFileSync(path.join(repsDir, 'old.txt'), 'on base already\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'rep on base');
  const repBase = git(repo, 'rev-parse', 'HEAD').trim();

  writeFileSync(path.join(repo, 'c.js'), 'call();\n');
  writeFileSync(path.join(repsDir, 'x.mmd'), 'graph TD\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'code plus rep');

  writeFileSync(path.join(repsDir, 'x.mmd'), 'graph TD\n  a --> b\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'rep only');

  writeFileSync(path.join(repo, 'c.js'), 'call();\ncall();\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'code only');

  const { commits } = loadTimeline(repo, repBase, 'main');
  assert.deepEqual(commits.map((c) => c.subject), ['code plus rep', 'code only'], 'a rep-only commit is no step');
  const [withRep, codeOnly] = commits;
  assert.deepEqual(withRep.files.map((f) => f.path), ['c.js']);
  assert.deepEqual(withRep.reps, [{ path: '.pr-timeline/reps/x.mmd', name: 'x.mmd', changed: true }]);
  // the rep-only edit lands on the next step, measured from the previous step
  assert.deepEqual(codeOnly.reps, [{ path: '.pr-timeline/reps/x.mmd', name: 'x.mmd', changed: true }]);
  assert.equal(codeOnly.repsSince, withRep.sha);
  assert.equal(withRep.repsSince, repBase);

  // asked for, a rep-only commit is a view step of its own
  const { commits: withViews } = loadTimeline(repo, repBase, 'main', { viewSteps: true });
  assert.deepEqual(withViews.map((c) => c.subject), ['code plus rep', 'rep only', 'code only']);
  assert.equal(withViews[1].viewOnly, true);
  assert.deepEqual(withViews[1].files, []);
  assert.equal(withViews[1].reps[0].changed, true);
  assert.equal(withViews[2].reps[0].changed, false, 'the view step already showed it');

  const { commits: plain } = loadTimeline(repo, base, 'main~4');
  assert.ok(plain.every((c) => c.reps.length === 0), 'a rep-less range lists no reps');
});

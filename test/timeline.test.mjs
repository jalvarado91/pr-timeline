import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

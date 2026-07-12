#!/usr/bin/env node
// pr-timeline: serve an editor-grade replay viewer for an atomized commit branch.
// Zero runtime deps — reads everything live from git, serves Monaco from node_modules.

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VIEWER_DIR = path.join(ROOT, 'viewer');
const MONACO_DIR = path.join(ROOT, 'node_modules', 'monaco-editor', 'min', 'vs');

function usage(code = 0) {
  console.log(`usage: pr-timeline serve [options]

options:
  --repo <path>     git repository to read (default: cwd)
  --branch <name>   replay branch to show (default: current branch if replay/*,
                    else most recently committed replay/* branch)
  --base <ref>      commit the replay starts from (default: merge-base with the
                    default branch)
  --port <n>        port to listen on (default: 4820)
  --open            open the viewer in a browser`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), port: 4820, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = path.resolve(argv[++i]);
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--open') args.open = true;
    else if (a === '-h' || a === '--help') usage();
    else usage(1);
  }
  return args;
}

function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}

function gitText(repo, args) {
  return git(repo, args, { encoding: 'utf8' });
}

function tryGit(repo, args) {
  try {
    return git(repo, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function resolveBranch(repo, requested) {
  if (requested) return requested;
  const head = tryGit(repo, ['symbolic-ref', '--short', 'HEAD']);
  if (head && head.startsWith('replay/')) return head;
  const newest = tryGit(repo, [
    'for-each-ref', '--sort=-committerdate', '--count=1',
    '--format=%(refname:short)', 'refs/heads/replay/',
  ]);
  if (newest) return newest;
  console.error('no replay/* branch found; pass --branch');
  process.exit(1);
}

function resolveBase(repo, branch, requested) {
  if (requested) return tryGit(repo, ['rev-parse', requested]) ?? fail(`bad --base: ${requested}`);
  const originHead = tryGit(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const candidates = [originHead, 'main', 'master'].filter(Boolean);
  for (const c of candidates) {
    if (tryGit(repo, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`]) === null) continue;
    const mb = tryGit(repo, ['merge-base', c, branch]);
    if (mb) return mb;
  }
  fail('could not determine base commit; pass --base');
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function loadTimeline(repo, base, branch) {
  const log = gitText(repo, [
    'log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${base}..${branch}`,
  ]);
  const commits = log.split('\x1e').map(s => s.replace(/^\n/, '')).filter(s => s.trim()).map(rec => {
    const [sha, subject, body] = rec.split('\x1f');
    return { sha, subject, body: (body ?? '').trim(), files: [] };
  });
  // The first commit may carry a `Narrative-Style: <id>` trailer (see atomize
  // SKILL §4). Lift it to a branch-level field and strip it from the body.
  const style = extractStyle(commits);
  for (const commit of commits) {
    const nameStatus = gitText(repo, [
      'diff-tree', '-r', '--no-commit-id', '-M', '--name-status', '-z', commit.sha,
    ]).split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i < nameStatus.length; ) {
      const status = nameStatus[i++];
      if (status.startsWith('R') || status.startsWith('C')) {
        const oldPath = nameStatus[i++];
        const newPath = nameStatus[i++];
        files.push({ status: status[0], path: newPath, oldPath });
      } else {
        files.push({ status: status[0], path: nameStatus[i++] });
      }
    }
    const numstat = gitText(repo, [
      'diff-tree', '-r', '--no-commit-id', '-M', '--numstat', '-z', commit.sha,
    ]);
    // -z numstat: "adds\tdels\tpath\0" or, for renames, "adds\tdels\t\0old\0new\0"
    const stats = new Map();
    const parts = numstat.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i].match(/^(\S+)\t(\S+)\t(.*)$/);
      if (!m) continue;
      let filePath = m[3];
      if (filePath === '') { i++; filePath = parts[++i]; }
      stats.set(filePath, {
        additions: m[1] === '-' ? null : Number(m[1]),
        deletions: m[2] === '-' ? null : Number(m[2]),
        binary: m[1] === '-',
      });
    }
    for (const f of files) {
      const s = stats.get(f.path) ?? { additions: 0, deletions: 0, binary: false };
      Object.assign(f, s);
    }
    commit.files = files;
  }
  return { commits, style };
}

// Pull a trailing `Narrative-Style: <id>` line off a commit body, mutating the
// body to drop the trailer and the blank line before it. Returns the id or null.
function extractStyle(commits) {
  for (const commit of commits) {
    const lines = commit.body.split('\n');
    const m = lines[lines.length - 1]?.match(/^Narrative-Style:[ \t]*(.+?)[ \t]*$/);
    if (!m) continue;
    lines.pop();
    commit.body = lines.join('\n').trimEnd();
    return m[1];
  }
  return null;
}

function showFile(repo, ref, filePath) {
  try {
    const buf = git(repo, ['show', `${ref}:${filePath}`]);
    if (buf.subarray(0, 8000).includes(0)) return { binary: true };
    return { content: buf.toString('utf8') };
  } catch {
    return null;
  }
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.woff2': 'font/woff2',
};

function serveStatic(res, filePath, cacheControl = 'no-cache') {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    'cache-control': cacheControl,
  });
  res.end(readFileSync(filePath));
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'serve') usage(cmd ? 1 : 0);
  const args = parseArgs(rest);

  if (tryGit(args.repo, ['rev-parse', '--git-dir']) === null) fail(`not a git repository: ${args.repo}`);
  const branch = resolveBranch(args.repo, args.branch);
  if (tryGit(args.repo, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]) === null) {
    fail(`branch not found: ${branch}`);
  }
  const base = resolveBase(args.repo, branch, args.base);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/timeline') {
        const { commits, style } = loadTimeline(args.repo, base, branch);
        sendJSON(res, {
          repo: path.basename(args.repo), branch, base,
          baseShort: base.slice(0, 7), style, commits,
        });
      } else if (url.pathname === '/api/file') {
        const sha = url.searchParams.get('sha');
        const filePath = url.searchParams.get('path');
        const oldPath = url.searchParams.get('oldPath') || filePath;
        const status = url.searchParams.get('status');
        if (!/^[0-9a-f]{4,40}$/.test(sha ?? '') || !filePath) {
          return sendJSON(res, { error: 'bad request' }, 400);
        }
        const after = status === 'D' ? null : showFile(args.repo, sha, filePath);
        const before = status === 'A' ? null : showFile(args.repo, `${sha}^`, oldPath);
        sendJSON(res, {
          before: before?.content ?? '',
          after: after?.content ?? '',
          binary: Boolean(before?.binary || after?.binary),
          deleted: status === 'D',
          added: status === 'A',
        });
      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        serveStatic(res, path.join(VIEWER_DIR, 'index.html'));
      } else if (url.pathname.startsWith('/vs/')) {
        const rel = path.normalize(url.pathname.slice(4));
        if (rel.startsWith('..')) { res.writeHead(403); return res.end(); }
        serveStatic(res, path.join(MONACO_DIR, rel), 'public, max-age=86400');
      } else {
        const rel = path.normalize(url.pathname.slice(1));
        if (rel.startsWith('..')) { res.writeHead(403); return res.end(); }
        serveStatic(res, path.join(VIEWER_DIR, rel));
      }
    } catch (err) {
      sendJSON(res, { error: String(err.message ?? err) }, 500);
    }
  });

  server.listen(args.port, '127.0.0.1', () => {
    const addr = `http://127.0.0.1:${args.port}`;
    console.log(`pr-timeline: replaying ${branch} (${base.slice(0, 7)}..) from ${args.repo}`);
    console.log(`  ${addr}`);
    if (args.open) {
      const opener = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start' : 'xdg-open';
      try { execFileSync(opener, [addr]); } catch { /* best effort */ }
    }
  });
}

main();

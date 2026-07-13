#!/usr/bin/env node
// pr-timeline: serve an editor-grade replay viewer for an atomized commit branch.
// Zero runtime deps — reads everything live from git, serves Monaco from node_modules.

import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, openSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
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
  --host <addr>     interface to bind (default: 127.0.0.1; use 0.0.0.0 to
                    expose on your LAN)
  --daemon          detach into the background, print the URL, and return
  --exit-after <h>  hard self-exit after this many hours (default: 12)
  --open            open the viewer in a browser`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), port: 4820, host: '127.0.0.1', open: false, daemon: false, exitAfter: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = path.resolve(argv[++i]);
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--daemon') args.daemon = true;
    else if (a === '--exit-after') args.exitAfter = Number(argv[++i]);
    else if (a === '--open') args.open = true;
    else if (a === '-h' || a === '--help') usage();
    else usage(1);
  }
  return args;
}

function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30000,   // bound a hung git (credential prompt, dead mount) — every call is synchronous
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

// DNS-rebinding guard. On the loopback default, a malicious page can rebind a
// hostname it controls to 127.0.0.1 and read the API from the user's browser;
// requiring an IP-literal or localhost Host defeats that (direct access always
// uses one). When the user explicitly binds a non-loopback --host they've opted
// into network exposure, so we allow any Host (e.g. Tailscale MagicDNS names).
function hostAllowed(bindHost, hostHeader) {
  const loopbackBind = ['127.0.0.1', 'localhost', '::1'].includes(bindHost);
  if (!loopbackBind) return true;
  if (!hostHeader) return true;
  const name = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '::1' || name.startsWith('[')
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A wildcard bind is reachable on loopback; a specific bind must be probed on
// its own address. Used for both status probing and the URL we print.
const reachHost = (host) => (['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host);
const displayHost = (host) => {
  const h = reachHost(host);
  return h.includes(':') ? `[${h}]` : h;   // bracket IPv6 literals for URLs
};

// GET /api/status; resolves the JSON when it's one of ours, null otherwise
// (stranger on the port, or nothing there).
function probeStatus(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: '/api/status', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { const j = JSON.parse(body); resolve(j.app === 'pr-timeline' ? j : null); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// If a previous pr-timeline holds the port, ask it to exit and wait for the
// port to free — so a fresh replay reclaims the same URL instead of hunting for
// a new port and leaving the old process running.
async function takeoverPort(host, port) {
  const probeHost = reachHost(host);
  const st = await probeStatus(probeHost, port).catch(() => null);
  if (!st || !st.pid || st.pid === process.pid) return;
  try { process.kill(st.pid, 'SIGTERM'); } catch { /* already gone */ }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!(await probeStatus(probeHost, port).catch(() => null))) return;
    await sleep(100);
  }
}

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try { execFileSync(cmd, cmdArgs, { stdio: 'ignore', timeout: 5000 }); } catch { /* best effort */ }
}

// --daemon: spawn a detached copy that actually serves, wait for it to answer,
// print the URL, and exit — so the launcher isn't a long-lived background task
// the agent/session has to babysit.
async function daemonize(args, branch, base) {
  const logPath = path.join(tmpdir(), `pr-timeline-${args.port}.log`);
  const logFd = openSync(logPath, 'a');   // capture the detached child's stderr for diagnosis
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url), 'serve',
    '--repo', args.repo, '--branch', branch, '--base', base,
    '--port', String(args.port), '--host', args.host,
    '--exit-after', String(args.exitAfter),
  ], { detached: true, stdio: ['ignore', 'ignore', logFd] });
  child.unref();

  const probeHost = reachHost(args.host);
  const url = `http://${displayHost(args.host)}:${args.port}`;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { process.kill(child.pid, 0); }
    catch { fail(`server failed to start (see ${logPath}) — is port ${args.port} held by another program? try --port <n>`); }
    const st = await probeStatus(probeHost, args.port).catch(() => null);
    if (st && st.pid === child.pid) {
      console.log(`pr-timeline: replaying ${branch} (${base.slice(0, 7)}..) from ${args.repo}`);
      console.log(`  ${url}`);
      if (args.open) openBrowser(url);
      process.exit(0);
    }
    await sleep(150);
  }
  try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }   // don't orphan a slow starter
  fail(`server did not come up on ${url} within 12s (see ${logPath})`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'serve') usage(cmd ? 1 : 0);
  const args = parseArgs(rest);

  if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) {
    fail(`invalid --port: ${args.port} (expected 1–65535)`);
  }
  if (!Number.isFinite(args.exitAfter) || args.exitAfter <= 0 || args.exitAfter > 500) {
    fail(`invalid --exit-after: ${args.exitAfter} (hours, 0 < h ≤ 500)`);
  }
  if (tryGit(args.repo, ['rev-parse', '--git-dir']) === null) fail(`not a git repository: ${args.repo}`);
  const branch = resolveBranch(args.repo, args.branch);
  if (tryGit(args.repo, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]) === null) {
    fail(`branch not found: ${branch}`);
  }
  const base = resolveBase(args.repo, branch, args.base);

  if (!existsSync(MONACO_DIR)) {
    fail(`monaco-editor is not installed — the viewer can't render.\n  install it with: npm install --prefix "${ROOT}"`);
  }

  if (args.daemon) return daemonize(args, branch, base);

  await takeoverPort(args.host, args.port);
  startServer(args, branch, base);
}

function startServer(args, branch, base) {
  let lastActivity = Date.now();
  const sseClients = new Set();

  const server = http.createServer((req, res) => {
    try {
      if (!hostAllowed(args.host, req.headers.host)) {
        res.writeHead(403); return res.end('forbidden host');
      }
      lastActivity = Date.now();   // after the 403, so scanners/rebinding probes don't keep it alive
      const url = new URL(req.url, 'http://localhost');   // may throw on odd targets
      if (url.pathname === '/api/status') {
        return sendJSON(res, { app: 'pr-timeline', pid: process.pid, branch });
      } else if (url.pathname === '/api/events') {
        // SSE keep-alive: while a viewer tab holds this open the server stays up;
        // when the last one drops, the idle reaper can retire it.
        if (sseClients.size >= 64) { res.writeHead(503); return res.end(); }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        res.on('error', () => {});   // a torn-down socket errors asynchronously; swallow it
        const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch { /* dead */ } }, 25000);
        res.on('close', () => { clearInterval(ping); sseClients.delete(res); lastActivity = Date.now(); });
        return;
      } else if (url.pathname === '/api/timeline') {
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
      if (res.headersSent) return res.end();   // a response already started; don't double-send
      sendJSON(res, { error: String(err.message ?? err) }, 500);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') fail(`port ${args.port} is in use — retry with --port <n>`);
    fail(String(err.message ?? err));
  });

  server.listen(args.port, args.host, () => {
    const addr = `http://${displayHost(args.host)}:${args.port}`;
    console.log(`pr-timeline: replaying ${branch} (${base.slice(0, 7)}..) from ${args.repo}`);
    console.log(`  ${addr}`);
    if (args.open) openBrowser(addr);
  });

  // Never orphan: exit once no viewer is connected and it's been idle a while,
  // with a hard max-lifetime backstop regardless (--exit-after is validated).
  const IDLE_GRACE_MS = 15 * 60_000;
  setInterval(() => {
    if (sseClients.size === 0 && Date.now() - lastActivity > IDLE_GRACE_MS) process.exit(0);
  }, 30_000).unref();
  setTimeout(() => process.exit(0), args.exitAfter * 3600_000).unref();
}

// Run the server only when invoked directly, so tests can import the parsers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => fail(String(err?.message ?? err)));
}

export { loadTimeline, extractStyle };

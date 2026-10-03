---
name: view
description: Open any diff in the pr-timeline viewer and step through it change by change — a PR, a branch, a commit, a ref range, a variant or worktree branch, or an atomized replay/<name> branch. Use when the user wants to see, review, walk through, step through, or replay a change in the browser.
---

# View a change in pr-timeline

Serve the pr-timeline viewer for a range of commits in a local repo. The viewer
steps one change location at a time through `BASE..HEAD`, in place in the files,
with full context around every change.

Both ends are plain git revs, so anything git can name works — a branch, a tag,
a SHA, a fetched PR head, a worktree's branch. Nothing here is specific to
`replay/*` branches; those are just one target among many.

Argument: `$ARGUMENTS` names what to show, or is empty for the current branch.

## 1. Resolve REPO, BASE, HEAD

`REPO` is the current repo unless the user named a worktree or another checkout,
in which case it is that path — pass it as `--repo`.

Resolve `HEAD` and `BASE` by what you were given. Prefer a *ref name* over a SHA
for `HEAD` when one exists: the viewer displays it.

- **Nothing** — HEAD = the current branch. BASE = `git merge-base HEAD <default>`,
  where default comes from `git symbolic-ref --short refs/remotes/origin/HEAD`
  (fallback `main`, then `master`). If HEAD *is* the default branch, say so and
  ask what to show rather than replaying the whole history.
- **A branch name** — HEAD = that branch, BASE = its merge-base with the default
  branch. A `replay/<name>` branch is this case; so is a variant branch.
- **PR number or URL** — read the ends, then fetch both (works for forks):

  ```
  gh pr view <n> --json baseRefOid,title
  git fetch origin "+pull/<n>/head:refs/pr-timeline/<n>" <baseRefOid>
  ```

  HEAD = `refs/pr-timeline/<n>`, BASE = `git merge-base <baseRefOid> refs/pr-timeline/<n>`.
  `baseRefOid` is the base branch as the PR saw it, so a merged PR still has its
  commits; against today's base branch they are already ancestors and the range
  comes up empty. The fetch writes a namespaced ref, not a branch, so it stays
  out of `git branch`; the `+` lets a re-fetch follow a force-pushed PR.
- **A range `a..b`** — BASE = `a`, HEAD = `b`, as written.
- **A single SHA** — HEAD = the SHA, BASE = `<sha>^`. For a root commit, BASE =
  `git hash-object -t tree /dev/null` (the empty tree).
- **Two things to compare** ("this variant against that one") — HEAD = the second,
  BASE = `git merge-base <first> <second>`. Using the first directly as BASE
  shows only what the second added, which is rarely what was meant.

Verify both resolve before launching:

```
git -C <REPO> rev-parse --verify --quiet "<ref>^{commit}"
```

If HEAD has no commits over BASE, there is nothing to step through — report that
instead of starting a server.

## 2. Ensure the viewer's dependency is installed

First run only:

```
test -d "${CLAUDE_PLUGIN_ROOT}/node_modules/monaco-editor" \
  || npm install --prefix "${CLAUDE_PLUGIN_ROOT}" --no-audit --no-fund
```

## 3. Start the server

Use `--daemon` — a normal foreground command that detaches, prints the URL, and
returns in about a second (do **not** use run_in_background). Always pass
`--branch` and `--base` explicitly; the bare defaults look for a `replay/*`
branch and will pick the wrong thing.

```
node "${CLAUDE_PLUGIN_ROOT}/bin/pr-timeline.mjs" serve \
  --repo <REPO> --branch <HEAD> --base <BASE> --port 4820 --daemon --open
```

A previous pr-timeline on port 4820 is taken over automatically; only if the
command reports the port is held by *another* program should you retry with
`--port 4821`, `4822`, …

## 4. Report

Give the URL the command printed (`http://127.0.0.1:<port>`) and the essentials:
`←`/`→` step through every change, `⇧←`/`⇧→` jump commits, `t` toggles the rail,
`?` shows all keys. The server retires itself about 15 minutes after the last
viewer tab closes (and after 12h regardless), so there is nothing to clean up.

## What the viewer will and won't show

- **Merge commits are skipped.** A merge has no single-parent diff, so it would
  be a step you can't enter. A branch that merged the default branch mid-flight
  shows the commits authored on it, not what the merge dragged in.
- **Uncommitted work isn't shown** — every step comes from a commit. If the
  interesting change is still in the working tree, commit or stash it first.
- **One squashed commit is one step.** When the target is a single large commit
  and the user wants to read it as it was written rather than all at once, that
  is what `/pr-timeline:atomize` is for — offer it, don't run it unasked. It
  writes a new branch, so it is always the user's call.

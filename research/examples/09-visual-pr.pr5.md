<!--
Entry 9: a PR description in the shape of HumanLayer's visual-pr skill
(references/pr_description_template.md), written for PR #5 (99feee1..da9a69c).
Hand-written by an agent after the fact; this is not the PR's real description.
-->

## Why the change

The viewer could only replay `replay/*` branches and went silent when its server retired; now any PR, branch, commit or range can be viewed, and a dead server shows a banner instead of a dead button.

## Special things to note

- `skills/replay` is gone; `skills/view` replaces it. Anything that names `/pr-timeline:replay` must move to `/pr-timeline:view`.
- Merge commits are no longer steps. A range that brought changes in through a merge shows only the commits authored on the branch.
- A root commit can't be shown, and the skill now says so instead of suggesting the empty tree.

## Change outline

The view skill turns any target into a `BASE..HEAD` range, checks it isn't empty, then starts the same server as before.

```diff
-/pr-timeline:replay [name]
-  newest replay/* branch
-  serve --daemon
+/pr-timeline:view <target>
+  resolve HEAD, BASE   (nothing | branch | origin/branch | PR | a..b | sha | X vs Y | worktree path)
+  git rev-parse --verify   (both ends)
+  git rev-list --count --no-merges BASE..HEAD   → 0: report, offer the PR if merged through one
+  serve --daemon
```

A PR's base is now the base commit the PR saw, so a merged PR still has its commits.

```diff
 resolve(PR n)
-  BASE = merge-base(origin/<baseRefName>, PR head)
+  BASE = merge-base(<baseRefOid>, PR head)
```

The server leaves merges out of the timeline, so no step is empty.

```diff
 loadTimeline
-  git log --reverse <base>..<branch>
+  git log --reverse --no-merges <base>..<branch>
```

The viewer probes its server and re-opens the heartbeat; when the server is gone it says so.

```diff
 keepServerAlive
-  new EventSource('/api/events')
+  openLiveness                     # re-openable heartbeat
+  verifyConnection on refocus, online, every 5 min, failed load, retry
+    GET /api/status → app = 'pr-timeline' ? hide banner : show #conn-banner
```

Files:

```diff
 skills/
-├── replay/SKILL.md
+├── view/SKILL.md          # any target → BASE..HEAD
~└── atomize/SKILL.md       # hands off to view
 bin/pr-timeline.mjs        # --no-merges; help text says "range"
 test/timeline.test.mjs     # + merges are skipped
 viewer/{app.js,index.html,style.css}   # disconnected banner, probes
```

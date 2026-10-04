<!--
Entry 12: a HumanLayer-style plan (humanlayer/humanlayer .claude/commands/create_plan.md
template), reconstructed for PR #5 AFTER the fact from its commits. The real work
had no such plan; this shows what one would have looked like, and how its phases
map onto the PR's steps, so a replay viewer could show "plan item ↔ steps".
Phases are vertical slices in the sense of Dex's "Why Software Factories Fail".
-->

# View any range in pr-timeline: Implementation Plan

## Overview

Generalize the `replay` skill into a `view` skill that shows any `BASE..HEAD`, and make the viewer survive and explain a retired server.

## Current State Analysis

- `skills/replay/SKILL.md` only finds the newest `replay/*` branch and serves it.
- `loadTimeline` in `bin/pr-timeline.mjs` runs `git log --reverse <base>..<branch>`; a merge commit becomes a step with no files.
- `viewer/app.js` opens one `EventSource('/api/events')` and never checks it again.

## Desired End State

`/pr-timeline:view <anything>` opens the viewer on the right range or says plainly why it can't. Every step in the viewer can be entered. A dead server shows a banner.

## What We're NOT Doing

- Changing the server to show root commits (ba53054: "outside this branch").
- Changing the `replay/*`-seeking defaults of the CLI.
- Running atomize on the user's behalf.

## Phase 1: The viewer notices a dead server  → step 1 (2ddcce6)

- `viewer/app.js`: `openLiveness`, `verifyConnection`, `showDisconnected`; probe on refocus, online, every 5 min, failed load.
- `viewer/index.html`, `style.css`: `#conn-banner` with retry.

Success criteria — manual: kill the server with a tab open; the banner shows within 5 min or on refocus; relaunch and retry reloads the step.

## Phase 2: No empty steps  → steps 2, 9 (83a4743, 7610e8e)

- `loadTimeline`: `--no-merges`.
- Test: a branch that merged main yields no merge step and every step has files.

Success criteria — automated: `npm test`.

## Phase 3: The view skill  → steps 3, 4, 5, 6, 7, 8 (b61f4f0 … 30c3196)

- Replace `skills/replay` with `skills/view`: resolve nothing, branch, PR, range, SHA, two things, a worktree path.
- PR base from `baseRefOid`; forced fetch.
- Count with `--no-merges`; stop on 0.
- Point atomize and the README at view.

Success criteria — manual: view PR #4 (merged) shows 7 commits; view a merged branch reports 0.

## Phase 4: Words match the new scope  → steps 10, 11, 12, 13 (da25b11 … 5df2837)

- Plugin, marketplace, package descriptions lead with the viewer.
- CLI help and viewer messages say "range", not "replay".
- Empty merged branch → offer its PR; a merge SHA shows the commits it merged.

## References

- PR #5: `99feee1..da9a69c`

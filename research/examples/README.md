# Representation examples on one change

Every file here shows the same change: **PR #5, "view-skill"**, the range
`99feee1..da9a69c` on `main`. These files are fixtures for the replay viewer.
Each one is one representation from the research page "How others show an
agent's change", drawn on this PR so the representations can be compared.

All of them were written by hand, by an agent reading the commits, except the
`03-calldiff*` files, which are real `calldiff` output on this repo (listed in the table below; the
comparison is in the research page's "calldiff on PR #5" section).

One example uses a second subject: `01-component-tree.soulector-c3677a2.diff`
is from `~/Code/soulector-next` (read only), because pr-timeline has no UI
components to draw a real component tree of.

`replay/lens-demo` (built by the lens team) is the same PR atomized into 7
steps. It shares step 1 (2ddcce6) with these files; its later steps regroup the
PR's commits, so step numbers here are PR #5's own 13, not lens-demo's 7.

## The change

PR #5 has 13 non-merge commits (the viewer skips merges, so these are its 13
steps):

| step | sha | subject |
|---|---|---|
| 1 | 2ddcce6 | surface backend disconnects and re-establish the viewer heartbeat |
| 2 | 83a4743 | Skip merge commits in the timeline |
| 3 | b61f4f0 | Grow the replay launcher into a general view skill |
| 4 | 1621525 | Point atomize and the README at view |
| 5 | fa718bf | Resolve a PR's base from the PR, and follow force-pushes |
| 6 | ba53054 | Say the viewer can't show a root commit |
| 7 | ef00662 | Give the empty-range check a command that matches the viewer |
| 8 | 30c3196 | Resolve worktree paths and remote-only branches in view |
| 9 | 7610e8e | Trim the --no-merges comment to what the line needs |
| 10 | da25b11 | Lead the plugin description with the viewer |
| 11 | 0cb56d0 | Describe the CLI and viewer in terms of ranges, not replays |
| 12 | ecb94da | Point an empty merged branch at its PR |
| 13 | 5df2837 | Say what a merge commit's SHA shows |

The PR does two things:

- **Code (steps 1, 2, 9, 11):** the viewer notices when its server has gone
  away, and the server leaves merge commits out of the timeline.
- **The view skill (steps 3–8, 12, 13):** it replaces the `replay` skill and
  spells out how an agent turns "show me X" into a `BASE..HEAD` range.

## Per-step windows

A per-step representation is drawn for consecutive steps, so you can see how
it changes as you step:

- **Steps 1–2** for the code shapes: component tree, call tree, sequence and
  state diagrams.
- **Steps 5–7** for the skill shapes: pseudocode, and the call tree of what
  the agent runs.

File names carry the step and the sha: `05-pseudocode.step05-fa718bf.diff`.
A per-PR file carries `pr5`.

## Files

| entry | file | scope |
|---|---|---|
| 1 component tree | `01-component-tree.step01-2ddcce6.diff`, `01-component-tree.step02-83a4743.txt`, `01-component-tree.soulector-c3677a2.diff` | per-step |
| 2 call tree | `02-call-tree.pr5-view-skill.txt`, `02-call-tree.step02-83a4743.txt` (Production / Tests) | per-PR + per-step |
| 3 shape diff (hand-written) | `03-call-tree-diff.step01-2ddcce6.diff`, `.step02-83a4743.diff`, `.step05-fa718bf.diff`, `.step06-ba53054.diff`, `.step07-ef00662.diff` | per-step |
| 3 shape diff (calldiff 0.5.0, npm) | `03-calldiff.step01-2ddcce6.keepServerAlive.txt`, `.loadFrame.txt`, `.all-entries.txt`; `03-calldiff.step02/05/06/07-*.txt` ("No callstack changes") | per-step |
| 3 shape diff (calldiff 0.6.0, unreleased, built from GitHub 2086f6e) | `03-calldiff-0.6.step01-2ddcce6.keepServerAlive.txt`, `.all-entries.txt` | per-step |
| 4 file tree | `04-file-tree.pr5.diff`, `04-file-tree.step01..03-*.diff` | per-PR + per-step |
| 5 pseudocode | `05-pseudocode.step05..07-*.diff`, `05-pseudocode.pr5-head.txt` | per-step + per-PR |
| 6 types and contracts | `06-contracts.step01-2ddcce6.diff`, `06-contracts.step11-0cb56d0.diff` | per-step |
| 7 Mermaid | `07-sequence.step00-before.mmd`, `07-sequence.step01-2ddcce6.mmd`, `07-state.step01-2ddcce6.mmd` | per-step (before/after) |
| 8 HTML explainer | `08-html-explainer.pr5.html` | per-PR |
| 9 visual PR description | `09-visual-pr.pr5.md` | per-PR |
| 10 clickable state machine | `10-state-machine.step01-2ddcce6.html` | per-step |
| 11 process-flow table | `11-process-flow.pr5-head.json`, `11-process-flow.pr5-head.html` | per-PR |
| 12 phased plan | `12-plan.pr5.md` | per-PR |
| 13 plain restate (/bro) | `13-bro.steps05-07.txt` | per-step |
| 14 Litt | `14-literate-diff.steps05-07.html`, `14-quiz.pr5.html` | per-step range + per-PR |

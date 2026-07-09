# pr-timeline

Take a PR (or any large diff) and re-tell it as a sequence of atomic commits —
ordered the way the code would plausibly have been written — then step through
those commits in an editor-grade viewer, change by change, in place in the
files.

Two halves:

- **`/pr-timeline:atomize`** — a Claude Code skill that studies a PR, commit,
  or ref range, plans a "how this was written" narrative, and materializes it
  as real commits on a `replay/<name>` branch (built in a throwaway worktree,
  verified byte-identical to the source head).
- **`/pr-timeline:replay`** — serves the viewer for that branch. A tiny
  zero-dependency Node server reads everything live from git and renders it
  with Monaco.

## The viewer

- Inline diff in a real editor: insertions green, deletions ghosted in place,
  full file context around every change.
- `←`/`→` (or `j`/`k`) steps through **every change location** across the whole
  branch, auto-advancing through files and commits. `⇧←`/`⇧→` jump whole
  commits, `g`/`G` first/last, `?` for the rest.
- A filmstrip scrubber up top — one segment per commit, sized by churn, one
  tick per file. Click anywhere to seek.
- A sidebar with the commit list and the current commit's files (`t`, or the
  `sidebar` button).
- `x` (or `fold`) folds unchanged regions when you want just the deltas.
- Two looks, cycled with `v` (remembered across sessions):
  - **player** (default) — mac-flavored: edge-to-edge code under a glass menu
    bar, a floating commit card with traffic-dot controls (minimize to a chip,
    cycle corners — also `m` / `c`), a floating timeline pill with the scrubber
    and transport, and a slim status bar with file info and shortcuts
  - **clean** — quiet docked editor-native chrome

## Install

As a Claude Code plugin:

```
/plugin marketplace add jalvarado91/pr-timeline
/plugin install pr-timeline@pr-timeline
```

(For local development, point the marketplace at a checkout instead:
`/plugin marketplace add /path/to/pr-timeline`.)

The viewer's only dependency (monaco-editor) is installed automatically the
first time `/pr-timeline:replay` runs, or manually with `npm install`.

## Standalone use

The viewer works on any branch whose commits you want to walk, not just
generated ones:

```
node bin/pr-timeline.mjs serve --repo <path> --branch <name> [--base <ref>] [--port 4820] [--open]
```

`--branch` defaults to the newest `replay/*` branch; `--base` defaults to the
merge-base with the default branch.

## Layout

```
bin/pr-timeline.mjs    server + CLI (node ≥ 18, zero runtime deps)
viewer/                vanilla JS + Monaco frontend
skills/atomize/        the diff → atomic commits skill
skills/replay/         the launch-the-viewer skill
```

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

## Narrative styles

`atomize` re-tells the same diff in a chosen *narrative style* — the order the
story is told and its coherence rules. Three are built in:

| id | summary |
|----|---------|
| `foundations-first` | Bottom-up: definitions before use, tests last. The default. |
| `wishful-api` | Top-down: entry point first against APIs you wish existed, then descend and make each real. |
| `mvp-refine` | A crude end-to-end slice first (hardcoding named as such), then edge cases, errors, cleanup. |

Pick one by naming it in the invocation — `/pr-timeline:atomize 42 wishful-api` — or in
prose ("atomize this top-down"). No style named → `foundations-first`. Not sure?
Ask "what styles are there?" and atomize lists them.

Only the final commit is guaranteed byte-identical to the source head — the
intermediate commits are a narrative, not a CI-green history. Some styles (e.g.
`wishful-api`) deliberately produce mid-replay trees that don't compile.

### Add your own

Drop a markdown file in `.pr-timeline/styles/<id>.md` in the repo you atomize.
It uses the same format as the built-ins and is discovered automatically; a
custom `id` matching a built-in shadows it. Minimal template:

````markdown
---
id: docs-first
name: Docs first
summary: One line for the picker — the gist of the ordering.
when-to-use: When this story reads better than the defaults.
---

## Ordering principles

1. The rule that decides what lands before what.
2. (3–6 total.)

## Test placement

Where tests fall in the sequence.

## Coherence promise

What every commit guarantees about the ones before it (e.g. no forward
references, or every imagined call is made real before the end).

## Example commit-list shape

```
first commit subject
second commit subject
```

## Smells

- A sign the story was told in the wrong style.
````

## The viewer

- Inline diff in a real editor: insertions green, deletions ghosted in place,
  full file context around every change.
- `←`/`→` (or `j`/`k`) steps through **every change location** across the whole
  branch, auto-advancing through files and commits. `⇧←`/`⇧→` jump whole
  commits, `g`/`G` first/last, `?` for the rest.
- A filmstrip scrubber up top — one segment per commit, sized by churn, one
  tick per file. Click anywhere to seek.
- A sidebar with the commit list and the current commit's files (`t`, or the
  `sidebar` button) — it docks beside the editor, pushing it over.
- `x` (or `fold`) folds unchanged regions when you want just the deltas.
- Mac-flavored chrome: a slim menu bar and status bar; the commit card floats
  in glass with traffic-dot controls (minimize to a chip, cycle corners —
  also `m` / `c`); the scrubber rides in a floating timeline pill with the
  prev/next transport.

## Install

As a Claude Code plugin:

```
/plugin marketplace add jalvarado91/pr-timeline
/plugin install pr-timeline@pr-timeline
```

(For local development, point the marketplace at a checkout instead:
`/plugin marketplace add /path/to/pr-timeline`.)

**Requirements:** `node ≥ 18` and `git` on your `PATH`. The viewer's only
dependency (monaco-editor) is installed automatically the first time
`/pr-timeline:replay` runs, or manually with `npm install`.

### Updating

This repo is its own marketplace, so pr-timeline is distributed straight from
GitHub. Third-party marketplaces don't auto-update — when a new version lands,
pull it explicitly:

```
/plugin marketplace update pr-timeline
/plugin update pr-timeline@pr-timeline
```

then restart Claude Code. (CLI equivalents: `claude plugin marketplace update
pr-timeline` and `claude plugin update pr-timeline@pr-timeline`.)

## Standalone use

The viewer works on any branch whose commits you want to walk, not just
generated ones:

```
node bin/pr-timeline.mjs serve --repo <path> --branch <name> [--base <ref>] [--port 4820] [--host <addr>] [--open]
```

`--branch` defaults to the newest `replay/*` branch; `--base` defaults to the
merge-base with the default branch.

> **`--host` exposes the whole repo, unauthenticated.** By default the server
> binds `127.0.0.1` (loopback only). Passing `--host 0.0.0.0` (or a specific
> interface) makes it reachable from your network — and it serves **read-only
> access to every file in the repository's git history**, with no authentication,
> to anyone who can reach the port. Only use it on networks you trust, and stop
> the server when you're done.

## Layout

```
bin/pr-timeline.mjs    server + CLI (node ≥ 18, zero runtime deps)
viewer/                vanilla JS + Monaco frontend
skills/atomize/        the diff → atomic commits skill
skills/replay/         the launch-the-viewer skill
```

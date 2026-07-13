---
name: replay
description: Launch the pr-timeline viewer to step through a replay/<name> branch change-by-change in the browser. Use after atomize, or whenever the user wants to replay or walk through a replay branch.
---

# Replay an atomized branch

Serve the pr-timeline viewer for a `replay/*` branch of the current repo.

Argument: `$ARGUMENTS` may name a branch (with or without the `replay/`
prefix); empty means the newest `replay/*` branch.

## Steps

1. **Ensure the viewer's dependency is installed** (first run only):

   ```
   test -d "${CLAUDE_PLUGIN_ROOT}/node_modules/monaco-editor" \
     || npm install --prefix "${CLAUDE_PLUGIN_ROOT}" --no-audit --no-fund
   ```

2. **Resolve the branch.** If no argument, list candidates:

   ```
   git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads/replay/
   ```

   Use the newest; if there are none, tell the user to run
   `/pr-timeline:atomize` first.

3. **Start the server** with `--daemon` — a normal foreground command that
   detaches, prints the URL, and returns in about a second (do **not** use
   run_in_background):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/pr-timeline.mjs" serve \
     --repo <repo path> --branch <branch> [--base <sha>] --port 4820 --daemon --open
   ```

   Pass `--base` when you know the exact base commit (e.g. atomize just
   reported it); otherwise the server auto-detects via merge-base with the
   default branch. A previous pr-timeline on port 4820 is taken over
   automatically; only if the command reports the port is held by *another*
   program should you retry with `--port 4821`, `4822`, …

4. **Report** the URL the command printed (`http://127.0.0.1:<port>`) and the
   essentials: `←`/`→` step through every change, `⇧←`/`⇧→` jump commits, `t`
   toggles the rail, `?` shows all keys. The server retires itself about 15
   minutes after the last viewer tab closes (and after 12h regardless), so
   there's nothing to clean up.

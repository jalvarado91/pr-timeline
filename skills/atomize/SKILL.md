---
name: atomize
description: Break a PR, large commit, or ref range into atomic commits on a replay/<name> branch — ordered as the code would plausibly have been written, with terse commit messages. Use when the user wants to atomize, decompose, split, or "make replayable" a large diff.
---

# Atomize a diff into replayable commits

Take one large diff and re-tell it as a sequence of small commits that reads like
the code being written: foundations first, then logic, then integration, then
tests. The result is a real branch named `replay/<name>` whose final tree is
**byte-identical** to the source head. The user replays it with
`/pr-timeline:replay`.

Argument: `$ARGUMENTS` may be a PR number/URL, a commit SHA, a ref range
(`base..head`), or empty (use the current branch against the default branch).

## 1. Resolve BASE and HEAD

Both must be real commits in the local repo.

- **PR number/URL**: `gh pr view <n> --json baseRefName,headRefName,title`, then
  `git fetch origin <headRefName> <baseRefName>`. HEAD = the fetched head,
  BASE = `git merge-base` of the two.
- **Single commit SHA**: BASE = `<sha>^`, HEAD = `<sha>`.
- **Range `a..b`**: BASE = `a`, HEAD = `b`.
- **Nothing**: HEAD = current `HEAD`, BASE = `git merge-base HEAD <default>`
  where default comes from `git symbolic-ref refs/remotes/origin/HEAD`
  (fallback `main`, then `master`).

Record both full SHAs. Pick a short kebab-case `<name>` from the PR title or
commit subject. If `replay/<name>` already exists, ask before overwriting
(`git branch -D`) or pick a suffix.

## 2. Study the diff

```
git diff --stat BASE HEAD
git diff BASE HEAD
```

For anything non-trivial also read the final versions of the key changed files
(`git show HEAD:<path>`) — you are about to reconstruct their intermediate
states, so you need the destination in full, not just hunks.

## 3. Plan the story

Partition the diff into ordered steps. Each step is one commit. Ordering
principles, in priority order:

1. **Definitions before use.** Types, interfaces, schemas, constants, config →
   helpers → core logic → call sites / wiring → cleanup of what was replaced →
   tests and docs last (unless the work was visibly test-driven).
2. **One idea per commit.** A reviewer should be able to say what the commit
   does in one short sentence. If your draft message contains "and", split it.
3. **Files may evolve across steps.** A file appearing in several commits with
   partial content is the point — e.g. a module gains its types in step 1, its
   core function in step 3, an edge case in step 5.
4. **Don't over-split.** A mechanical rename, a lockfile, or a formatting sweep
   is one commit no matter how many files it touches. Typical output is 5–15
   commits; a small PR may honestly be 3.
5. Every step's tree should be *conceptually* coherent (would plausibly
   compile). Perfection is not required, but never reference a symbol that a
   later commit introduces.

Commit message style — terse but load-bearing:

- Subject: imperative, ≤ 60 chars, no trailing period. "define retry policy
  shape", not "Added the RetryPolicy interface".
- Body (optional, 1–2 sentences): the *why* or the decision taken, never a
  restatement of the diff. No Co-Authored-By or generated-with footers —
  these commits narrate the original author's work.

Show the user the planned commit list (subjects only) before materializing if
the plan is surprising in any way (reordering that changes meaning, dropped
whitespace-only noise, etc.). Otherwise proceed.

## 4. Materialize in a throwaway worktree

Never build on the user's working tree. Use the scratchpad directory:

```
git worktree add <scratchpad>/replay-build BASE
cd <scratchpad>/replay-build
git switch -c replay/<name>
```

For each planned step, bring files to their intermediate state with Write/Edit,
then:

```
git add -A && git commit --no-verify -m "<subject>" [-m "<body>"]
```

Rules while editing intermediate states:

- Copy final content **exactly** for every region that has reached its final
  form — reconstruct from `git show HEAD:<path>`, don't retype from memory.
- Renames: `git mv` in the step that renames; binary files:
  `git checkout HEAD -- <path>` in the step where they belong.
- Deletions of replaced code get their own step near the end ("retire X") when
  meaningful, or ride along with the commit that replaces them.

## 5. Verify exactness, then hand off

After the last step:

```
git diff --stat replay/<name> HEAD
```

This **must be empty**. If it isn't, sync the remainder — `git checkout HEAD -- .`
— and either amend it into the final commit (if it belongs there) or add one
more terse commit. Re-run the check. Never leave the branch differing from HEAD.

Cleanup and report:

```
cd <original repo> && git worktree remove <scratchpad>/replay-build
git log --oneline BASE..replay/<name>
```

Tell the user the branch name and the commit list, and offer to launch the
viewer with `/pr-timeline:replay`.

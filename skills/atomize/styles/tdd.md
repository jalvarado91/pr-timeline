---
id: tdd
name: Test-driven (red-green-refactor)
summary: Per behavior, a failing test leads, then the minimal code to pass it, then optional refactor. Tests never trail.
when-to-use: Best when the change is a set of distinct observable behaviors with clear pass/fail criteria. Reads like disciplined red-green-refactor, one behavior slice at a time.
---

# Test-driven (red-green-refactor)

Tell the diff as a sequence of behavior slices. Each slice opens with a failing
test, is closed by the minimal implementation that passes it, and may end with a
refactor. Tests lead every slice — they never accumulate at the end.

## Ordering principles

1. **Slice by behavior.** Pick one observable behavior; its whole
   red-green-refactor cycle completes before the next behavior starts.
2. **Red before green.** Each slice opens with a commit that adds a failing test
   for that behavior — failing because the behavior isn't implemented yet.
3. **Green next.** The following commit adds the minimal implementation that
   passes the test — no more than the test demands.
4. **Refactor last, and optional.** Only after green, a commit may clean up with
   all tests staying green. Skip it when there's nothing to clean.
5. **Repeat per slice.** The next behavior starts its own red commit; every
   earlier test stays passing from its green commit onward.

## Test placement

Tests **lead** every slice — one failing-test commit before each implementation
commit. They are never batched into a single trailing commit.

## Coherence promise

Relaxed only for red commits: a failing-test commit may reference
implementation that doesn't exist or doesn't work yet — that is the failing
state, and it compiles far enough to run and fail. (In module systems where
importing a missing export is a load error rather than a test failure — e.g.
ESM named imports — the load error *is* the red; it still counts.) Every green
commit leaves all tests passing. No test is left failing across a slice
boundary.

## Example commit-list shape

For a small "add retry to the API client" feature:

```
test: request retries on a transient failure
add retry wrapper around the request loop
test: backoff delay grows between attempts
add backoff helper
test: give up after max attempts
implement give-up on max attempts
refactor retry policy into a typed shape
```

Note the typed shape emerges as a refactor at the *end*, once tests pin the
behavior — not defined up front.

## Smells you got the style wrong

- **All tests in one commit at the end.** Then you wrote foundations-first with
  extra steps. Tests must lead each slice, interleaved with implementation.
- **A green commit with no preceding red.** That behavior wasn't test-driven —
  every implementation commit needs the failing test that motivated it landing
  first.

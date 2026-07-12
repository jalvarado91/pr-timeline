---
id: mvp-refine
name: Make it work, then refine
summary: A crude end-to-end slice first (hardcoding allowed and named as such), then edge cases, errors, and cleanup.
when-to-use: Best for exploratory or product-shaped work where getting the whole path running early matters more than getting each layer right. Reads like a rough draft made progressively honest.
---

# Make it work, then refine

Tell the diff worst-first. The opening commits make the whole path run end to
end however crudely — hardcoded values, happy path only, shortcuts welcome — and
each later commit makes the crude thing more honest: edge cases, error handling,
then naming and cleanup.

## Ordering principles

1. **Working end-to-end first.** The first commit(s) make the entire path run
   start to finish, however roughly. Correctness for the happy path only.
2. **Name the shortcuts.** Every hardcoded value, fake, or omission is stated in
   the commit message — "hardcode 3 tries", "happy path only" — so later
   commits have something explicit to undo.
3. **Refine outward from working.** Later commits replace shortcuts with the
   real thing: edge cases first, then error handling.
4. **Polish last.** Naming, extraction, config surface, and cleanup come after
   behavior is correct — never before.
5. **Files evolve heavily.** Expect the same file rewritten across many commits
   as it goes crude → correct → clean. That churn is the point.

## Test placement

Tests arrive once behavior stabilizes — typically while hardening edge cases and
errors, after the crude slice runs — not up front (nothing stable to pin) and
not necessarily all at the very end.

## Coherence promise

No forward references — every commit runs end to end, and the crude version is
genuinely correct for the happy path even while hardcoded. Unlike
foundations-first, quality and generality arrive late: a reviewer watches a
working-but-ugly system get progressively honest rather than built up in
finished layers.

## Example commit-list shape

For a small "add retry to the API client" feature:

```
retry failed requests end-to-end (hardcoded 3 tries, fixed 1s delay)
handle the non-retryable error case
replace the fixed delay with real exponential backoff
give up cleanly after max attempts
extract the retry policy into a typed shape
surface retry config in client options
test retry backoff and give-up paths
```

The first commit is deliberately crude and says so; the typed shape and config
surface are the last things to land.

## Smells you got the style wrong

- **The first commit is already clean and general** — types, config, no
  hardcoding. Then you wrote foundations-first; the opening slice should be
  crude and end-to-end.
- **The messages don't admit the shortcuts.** Refinement commits then have
  nothing to point back at. Name the hardcoding at the moment you introduce it.

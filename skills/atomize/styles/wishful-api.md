---
id: wishful-api
name: Wishful API
summary: Top-down — start at the entry point, call the API you wish existed, then descend and make each imagined piece real.
when-to-use: Best when the change is driven by a desired interface — a new client, command, or public function whose shape matters more than its internals. Reads like designing from the caller's seat inward.
---

# Wishful API

Tell the diff top-down. The first commit writes the outermost call site against
functions and types that **don't exist yet** — the code you wish you had. Each
later commit descends one level and makes an imagined piece real, until nothing
is imagined anymore.

## Ordering principles

1. **Entry point first.** Start at the outermost call site — the command, route,
   or public function — and write it against the cleanest API you can imagine,
   whether or not it exists.
2. **Forward references are the method.** A commit deliberately calls functions
   and names types that no earlier commit introduced. Each such reference is a
   promise to be kept by a later commit.
3. **Descend to make it real.** Each following commit implements exactly one
   previously-imagined symbol, moving from the outer layers inward.
4. **Acknowledge the gap in the message.** A commit that introduces an imagined
   API says so in its body — e.g. "sketches the client we wish we had;
   implemented next" — so a reader knows the reference is intentional.
5. **Close every promise before the end.** The final descent commit leaves no
   imagined symbol unimplemented. The last tree is whole; the middle is not.

## Test placement

Tests come last, once every imagined symbol is real. If the story should be
test-led, that's a different style — use `tdd`.

## Docs and ride-alongs

User-facing docs that *describe the wished-for interface* may open the story —
they are the outermost wish of all. Reference docs and changelogs land at the
end with the tests. Unrelated ride-along changes (a drive-by fix, housekeeping)
sit outside the wish/descent chain entirely: give each its own terse commit
near its file's other commits, and don't dress it up as a promise or a descent.

## Coherence promise

Inverted from foundations-first. A commit **may** reference symbols introduced
by a later commit — that is the whole point. Two guarantees replace strict
coherence: (a) every imagined symbol is made real before the final commit, so
the last tree compiles; and (b) each commit that references a not-yet-real
symbol admits it in its body. Intermediate trees are expected not to compile.

## Example commit-list shape

For a small "add retry to the API client" feature:

```
call a wished-for retry wrapper from the request loop
add the retry-policy shape the wrapper takes
make the backoff helper real
implement the give-up decision the wrapper assumed
surface retry config in client options
test retry backoff and give-up paths
```

The first commit's body acknowledges the gap ("`withRetry` doesn't exist yet;
made real over the next commits"); the descent commits close it.

## Smells you got the style wrong

- **No commit ever references a symbol introduced later.** Then you wrote
  foundations-first, not wishful — the entry point must land before the pieces
  it calls.
- **The story ends with something still imagined.** A promise went unkept and
  the final tree won't compile. Every wished-for symbol must be made real
  before the last commit.

---
id: foundations-first
name: Foundations first
summary: Bottom-up — definitions before use, tests last. The default story.
when-to-use: Default. Best for changes with a clear dependency spine (types → helpers → logic → wiring). Reads like careful, layer-by-layer construction.
---

# Foundations first

Tell the diff bottom-up: everything a later step needs already exists when it
lands. The story climbs from definitions to the call sites that use them.

## Ordering principles

1. **Definitions before use.** Types, interfaces, schemas, constants, config →
   helpers → core logic → call sites / wiring → cleanup of what was replaced →
   tests and docs last.
2. **Strict coherence.** Never reference a symbol that a later commit
   introduces. Each step's tree should plausibly compile on its own; a call
   always lands after the thing it calls.

## Test placement

Tests and docs come last, after the code they exercise.

## Coherence promise

Every commit stands on foundations already laid. No forward references: a symbol
is defined before any commit uses it. A reviewer reading top to bottom never
meets a name they haven't seen introduced.

## Example commit-list shape

For a small "add retry to the API client" feature:

```
define retry policy shape
add backoff helper
wire retry into request loop
surface retry config in client options
test retry backoff and give-up paths
```

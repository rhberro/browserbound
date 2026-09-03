# BrowserBound — Agent Instructions

## Verification gate (this phase)

BrowserBound is in a rapid tuning phase: the feel is changing constantly, so
automated tests churn without earning their keep. The only verification is the
build:

```sh
pnpm -r run type-check
pnpm -r run build
```

Run both after every change and make them pass.

**There is no automated test suite in this phase, and none is being added.**
Do not write `*.test.ts` files, test scripts, test configs, or test
dependencies. Any skill or workflow step that says to write or run tests does
not apply in this phase.

# Testing

100% test coverage is the key to great vibe coding. Tests let you move fast, trust
your instincts, and ship with confidence — without them, vibe coding is just yolo
coding. With tests, it's a superpower.

## Framework

[Vitest](https://vitest.dev) 2.x. No DOM/browser environment configured yet —
current tests cover pure logic only.

## Running tests

```bash
npm install
npm test
```

CI runs the same command on every push and PR (`.github/workflows/test.yml`).

## What's covered

`js/app.js`, `js/auth.js`, and `js/db.js` are loaded in the browser as ES
modules (`<script type="module" src="js/app.js">` in `app.html`), but they're
not directly unit-testable as-is: `auth.js`/`db.js` hit Supabase over the
network, and most of `app.js` reads/writes the DOM directly.

The stateless, pure-logic pieces of `app.js` (progression math, rep-counting,
timer formatting) live in `js/lib.js`, which has zero DOM or Supabase
dependencies — `app.js` imports from it rather than duplicating the logic.
`tests/lib.test.js` covers `js/lib.js` directly.

## Test layers

- **Unit tests** (`tests/*.test.js`): pure functions in `js/lib.js`. This is
  the only layer set up today.
- **Integration/E2E**: not set up. Would need a Supabase test project (or a
  mocked client) plus a DOM/browser environment (jsdom or Playwright) to
  exercise `app.js`, `auth.js`, `db.js` for real. Out of scope for now —
  flagged as follow-up work, not attempted here.

## Conventions

- One `describe` block per function, one `it` per behavior (not per input).
- Test real behavior with meaningful assertions — never `expect(x).toBeDefined()`.
- When you move logic into `js/lib.js`, add tests before wiring it back into
  `app.js`.

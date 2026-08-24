# TODOs

## Open

- Fix `~/.codex/config.toml` model pin — stale `gpt-5.1-codex-max` reference causes Codex to fail during ship workflow; update to a current model ID.
- Expand test coverage: `js/app.js` has untested DOM-layer logic (buildWorkoutPrompt, applyLockout); consider extracting more pure logic to `js/lib.js` incrementally.

## Done

- [x] Light-first design system migration (warm sand + white cards + copper)
- [x] WCAG AA contrast verification for all text tokens
- [x] Pill-shaped set buttons, 44px touch targets
- [x] Vitest test framework bootstrap
- [x] `js/lib.js` pure-logic extraction + 24 unit tests
- [x] GitHub Actions CI

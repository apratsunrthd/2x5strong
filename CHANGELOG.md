# Changelog

## [0.1.0.0] — 2026-08-24

### Changed
- **Light-first design system** — migrated from dark to warm sand + white cards + copper accent palette. Full CSS custom property rewrite (`--bg`, `--surface`, `--accent`, `--accent-text`, and semantic tokens). WCAG AA contrast verified for all text/background pairs.
- **Typography** — Fraunces (display/hero, 500 weight), Instrument Sans (body/UI), Geist (numeric data). Applied app-wide in `css/style.css` and `app.html`.
- **Pill-shaped buttons** — set buttons and primary CTAs converted to `border-radius: var(--radius-pill)`, 44px touch target height (WCAG minimum).
- **Accent token split** — introduced `--accent-text: #925B30` for text-color uses; `--accent: #C07840` kept for backgrounds, borders, and icons. Fixes WCAG contrast failure on light surfaces.

### Added
- **Test framework** — Vitest 2.1.9, `package.json`, `npm test` script.
- **`js/lib.js`** — pure-logic module extracted from `app.js` (no DOM/Supabase dependencies): `formatTime`, `roundToIncrement`, `effectiveIncrement`, `deadliftSetsCount`, `deadliftIncrement`, `setFailed`, `setDone`, `consecutiveFails`, `parseMaxReps`, `cycleMovementRep`.
- **`tests/lib.test.js`** — 24 unit tests covering all exported functions with edge cases (empty string, `amrap`, `null` sets, boundary values).
- **GitHub Actions CI** — `.github/workflows/test.yml` runs `npm ci && npm test` on push/PR to main.
- **`TESTING.md`** — documents test philosophy, framework, layers, and conventions.
- **`docs/design/variant-LC.png`** — approved Morning-variant mockup committed to repo.

### Fixed
- `--muted` contrast: `#8A7860` → `#695B49` (3.4:1 → 5.3:1 on light surfaces).
- `--info` contrast: `#8B8FC4` → `#5A60AB` (2.96:1 → 5.46:1 on light surfaces).
- `--muted2` contrast: `#B8A898` → `#756351` (~2.0:1 → ~4.9:1).
- `parseMaxReps('')` returned 0 instead of 10 (`Number('') === 0` bypassed NaN guard — fixed with explicit empty-string check).
- `parseMaxReps('amrap')` returned `-Infinity` (`Math.max(...[])` — fixed by checking `parts.length` before spreading).
- `.lifts` gap: `12px` → `14px` (matches DESIGN.md spec).
- DESIGN.md color doc aligned with shipped CSS values.

## gstack (recommended)

This project uses [gstack](https://github.com/apratsunrthd/gstack) (a fork of
[garrytan/gstack](https://github.com/garrytan/gstack)) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/apratsunrthd/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing. Use ~/.claude/skills/gstack/... for gstack file paths.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Testing
Run with `npm test` (Vitest). Tests live in `tests/`. See TESTING.md for
what's covered and why.

- 100% test coverage is the goal — tests make vibe coding safe.
- When writing new pure logic, prefer putting it in `js/lib.js` (no DOM, no
  Supabase) so it's directly unit-testable, and write a test for it.
- When fixing a bug, write a regression test.
- When adding a conditional (if/else, switch), test both paths.
- Never commit code that makes existing tests fail.

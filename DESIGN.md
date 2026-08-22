# Design System — Never Behind

## Product Context
- **What this is:** A 5×5 barbell strength tracker (static HTML/CSS/JS + Supabase). Two lifting days, four days free for other training.
- **Who it's for:** Serious lifters who want a real training tool, not a gamified habit app — including people returning after a layoff or a rough patch.
- **Space/industry:** Fitness/strength training apps, competing indirectly with StrongLifts, Strong, and Hevy.
- **Project type:** Mobile-first web app (login + daily-use logging screen).

## Naming
Renamed from "2x5strong" to **Never Behind**. Prior name paralleled StrongLifts 5x5's own naming pattern (numbers + "strong"/"5x5") closely enough to carry real trademark-confusion risk, especially once the app's positioning explicitly compares itself to StrongLifts. "Never Behind" was chosen after several rounds of conflict-checking candidate names against existing fitness apps/gyms — see session history for the full elimination process (Setpoint, Baseline, Tempered, Onward, Momentum, Regain, "Pick It Up," and others were all found to collide with real existing products).

## Aesthetic Direction
- **Direction:** Warm light — a premium training journal, not a system alert. Not gym-bravado (StrongLifts/Strong: bold red/navy, oversized "LIFT MORE" headlines, achievement stat-walls), not clinical wellness (Oura: cream, blur, spa-quiet). Sand and white with copper as the single accent.
- **Decoration level:** Minimal. Typography and one accent color carry the whole system. No texture, no gradients, no stat-flexing or streak/gamification chrome anywhere. Exercise icons are optional — if used, they must be simple line-weight icons (Lucide or Phosphor), never illustrative or emoji-style.
- **Mood:** "It doesn't judge me for a bad day." Calm, competent, matter-of-fact — a coach who's seen a thousand off days and isn't rattled by yours.
- **Reference sites:** stronglifts.com, strong.app (category baseline — gym-bravado, explicitly rejected as the register), ouraring.com (adjacent-but-wrong register — too clinical/passive for a barbell tool; informed the "warm, not cold" correction).
- **Approved mockup:** `~/.gstack/projects/apratsunrthd-2x5strong/designs/app-logging-20260822/variant-LC.png` — use this as the visual reference for implementation.

## Typography
- **Display/Hero:** Fraunces — warm old-style serif, **medium weight (500) only, never heavy/black**. A heavy Fraunces reads self-important, which undercuts the whole point.
- **Body/UI/Labels:** Instrument Sans — humanist, warm in the curves, reads well in dense logs without going clinical.
- **Data/Tables (weights, reps):** Geist with tabular-nums. Non-negotiable — the entire app is numbers in columns, and they must align.
- **Loading:** Google Fonts (`fonts.googleapis.com`) — `Fraunces`, `Instrument+Sans`, `Geist`.
- **Current implementation status:** the shared `css/style.css` root stylesheet still uses Barlow Condensed / Barlow (`--font-d` / `--font-b`) — this was a deliberate scope decision during the rebrand session (color/token swap is low-risk; a full font migration touches weight/letter-spacing/uppercase rules throughout `app.html`'s ~2600-line embedded stylesheet and needs its own careful pass, not a blind swap). Fraunces is live today only on the login page's wordmark (`index.html`). **Full font migration across the app is the next design task — run `/design-html` to implement it against this spec.**

## Color
- **Approach:** Restrained — one accent, semantic colors reserved for real meaning.
- **Background:** `#EDE6DC` — warm sand, the page ground.
- **Surface:** `#FDFAF7` (cards, white that pops off the sand) / `#F0E8DC` (secondary/idle set buttons) / `#DDD3C4` (borders).
- **Text:** `#1E1510` primary (very dark warm brown) / `#8A7860` muted / `#B8A898` faint.
- **Accent (brand/interactive):** `#C07840` — copper, slightly deeper than the old dark-mode value for legibility on light. Confident, not gym-red, not SaaS-purple.
- **Success:** `#5A7A5E` — muted moss, no neon/confetti energy.
- **Gentle warning (deload / ramp-back — semantically distinct from real errors):** `#8B8FC4` — dusty slate-periwinkle. **Deliberately outside the entire amber-red "caution" family.** Two independent AI design reviewers (Claude subagent, Codex/GPT-5.1) converged on this same idea unprompted — treat that convergence as a strong signal, not a coincidence. In code this reuses the `--info` / `--info-bg` CSS variables.
- **Failure (individual failed rep/set — a true, immediate technical fact about that one set, not a judgment about the person or the program):** `--danger` stays red (`#C05040`, warmed). This is intentionally NOT unified with the gentle-warning treatment — a 0-rep set genuinely failed; a deload or ramp-back session did not.
- **Light mode:** this is now a light-first system. The previous dark palette (`#161311` background, `#F2EEE8` text) is retired from the shipped app.

## Spacing
- **Base unit:** 8px.
- **Density:** Comfortable, not compact — this app gets used mid-set, in a gym, often one-handed.
- **Scale:** 8 / 16 / 24 / 32 / 48 / 64.

## Layout
- **Approach:** Per-exercise cards on a sand background — white cards pop off the page ground. One card per exercise, generous padding (16px), 14px gap between cards.
- **Sets:** rendered as a horizontal row of pill-shaped buttons below the weight number. Pill buttons are wide (full-width row distributed), 40px tall, rounded-full. Idle = warm off-white `#F0E8DC` with border, done = filled moss, fail = filled red.
- **Ramp-back note:** shown inline as a small italic annotation next to the weight number, in gentle-warning color — **never a banner, never a modal, never red.**
- **No stat-walls, streaks, or achievement badges anywhere** — including any future marketing/landing page. This is a hard rule, not a style preference: a streak counter is structurally a judgment machine (a broken streak is a small public failure event), which is incompatible with "it doesn't judge me for a bad day."

## Motion
- **Approach:** Minimal-functional. One deliberate exception: a quiet fade-to-check on set completion — alive, never a celebration burst.

## Icon / Mark
Two overlapping circles (small `r=13` at `(18,42)`, large `r=21` at `(40,22)` in a 64×64 viewBox), solid copper `#D68B4A`. Reads simultaneously as weight plates seen edge-on, and as an ascending ramp. Hand-built as precise vector geometry (not AI-generated) specifically so it holds up at favicon scale (tested 512px down to 16px) — three-circle and gapped-circle variants were tried first and rejected for degrading into illegible smears at small sizes. Source: `favicon.svg`. Replaces the prior illustrated buffalo mascot, which is fully removed.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-21 | Renamed 2x5strong → Never Behind | Prior name too close to StrongLifts 5x5's own naming pattern; real trademark-confusion risk given the app's positioning explicitly compares itself to StrongLifts |
| 2026-08-21 | Dropped buffalo mascot entirely | Didn't fit a serious/premium, non-judgmental brand; replaced with an abstract geometric mark |
| 2026-08-21 | Dark warm-instrument aesthetic over gym-bravado or clinical-wellness | Category converges on stat-flexing/achievement bravado, which structurally contradicts "it doesn't judge me for a bad day" |
| 2026-08-21 | Gentle-warning color deliberately outside amber-red family | Converged on independently by two AI design reviewers; prevents deload/ramp-back from ever visually reading as an error |
| 2026-08-21 | Root color tokens swapped in `css/style.css`; font migration deferred | Color swap is low-risk (value-only); font swap requires auditing weight/letter-spacing assumptions across a large embedded stylesheet — scoped as follow-up work |
| 2026-08-22 | Switched from dark-first to light-first (warm sand + white cards) | Dark variants tested in /design-shotgun felt too heavy (copper too dominant on dark); light "Morning" variant (LC) selected as the approved direction |
| 2026-08-22 | Pill-shaped set buttons over square set buttons | LC mockup; more tactile and finger-friendly on mobile, consistent with the premium-journal feel |

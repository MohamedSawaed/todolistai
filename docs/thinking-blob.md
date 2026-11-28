# The Thinking Blob — character specification

PlanMind's assistant, shown as a small, intelligent companion. It represents what the
assistant is actually doing, never more. Source of truth for the drawing:
`src/components/mascot/thinking-blob.tsx`. Behaviour: `src/lib/mascot.ts`.

## Identity (never changes between states)

| Element | Specification |
|---|---|
| Silhouette | Drop-shaped head whose tip **curls up and to the left** (the signature), widest at eye level; short body with two small stub arms; two rounded feet with a notch between them. Traced from the official reference on a 1254 × 1254 artboard; rendered from the `180 130 900 900` view box. |
| Proportions | Head ≈ 60 % of the height. Body ≈ ⅔ of the head's width. Arms start just under the head. |
| Eyes | Two large, glossy, dark-violet ovals (left 52 × 56, right 48 × 53 artboard units), deep `#1c0446` top to `#7c22d2` glow at the bottom, one large and one small white highlight. |
| Brows | Soft embossed ridges in the body colour (`#c896fa`) with a violet underside. Default: **left brow low and level, right brow raised**. |
| Default expression | Left eye half-lidded under the low brow, right eye open, small confident smile (`#2a0b5e`). Knowing, calm — never silly. |
| Chest | Three check circles with lines: it organizes. |
| Orbit | A thin glowing ring tilted ≈ 15°, passing behind the body. |
| Spark | One four-point star up and to the right of the head. |

## Colour

| Token | Value |
|---|---|
| Body light → shade | `#f6e6ff` → `#e1bffb` → `#b685f0` → `#7b47c9` (radial, light from the upper right) |
| Rim light | `#e7cbff` |
| Glow / floor light | `#b36cff` / `#b77bff` |
| Eyes | `#1c0446` → `#7c22d2` |
| Mouth, lid lines | `#2a0b5e`, `#6c36b8` |
| Conflict marker | amber `#f5b45a` (small, never flashing) |

Works on the dark theme as designed and on light backgrounds without changes (it carries its
own glow). Never recolour the body or eyes; never place it on busy imagery.

## Sizes and detail levels

| Context | Size | Detail |
|---|---|---|
| Toasts, small markers | 24–30 px | silhouette, face (no orbit/spark/checklist) |
| Chat avatar, card headers | 32–44 px | + orbit, spark, checklist |
| Assistant header (live) | 48 px | full |
| Daily briefing | 58 px | full |
| Empty states, settings | 72–128 px | full |
| Onboarding, first launch | 176–200 px | full |

Minimum size: 24 px. Below 56 px the glow filters are dropped for performance.

## States

| State | Trigger (real events only) | Expression and motion |
|---|---|---|
| idle | Nothing happening | Breathing ≈1 % every 4 s, float every 5–5.5 s, blinks at varied 4–7 s intervals |
| thinking | An AI request is in flight (from start to the server's answer) | Tilts 5°, eyes look up, right brow higher, lavender pulse, spark twinkles (1.9 s loop) |
| listening | Microphone capture active | Upright, focused eyes, side ripples |
| speaking | Assistant audio playing | Gentle nod, soft mouth motion, ripples |
| conflict | The scheduling engine confirmed an overlap | Eyes widen, brows up, tilts toward the card, body still, amber marker pops in (≈320 ms), then stays attentive until resolved |
| suggestion-ready | A validated proposal is shown | Brighter eyes, presenting arm, spark (≈800 ms), then idle. Never implies it's saved. |
| success | The server confirmed a save or completion | Lifts, happy eyes, small nod, checks pop (≈850 ms) |
| goal-completed | A goal reached its completion condition | Lift, three restrained particles and a fading ring (≈1.3 s) |
| resting | Empty day / nothing to do | Lids lowered, slow breathing, no float |
| error | An operation failed | Concerned brows, head down slightly; always paired with an actionable message |

Priority when states overlap: voice → AI processing → conflict/error → short reaction → idle/resting.
Results of an older request never override a newer one.

## Rules

- Every movement means something. No random motion, no constant bouncing, no confetti storms.
- Never show success before the server confirms; never "think" on a timer.
- Meaning is always also given in text; the character is decorative to screen readers except
  where it is the live assistant indicator (then it has a short label).
- Respect `prefers-reduced-motion` and the user's setting (Settings → Assistant character:
  show / animation Subtle · Normal · Off / celebrations). Default: shown, subtle.
- Keep it small on productivity screens; never over calendar blocks, buttons or text;
  `pointer-events: none`.
- Animation pauses when offscreen or the tab is hidden.

## Not yet wired

PlanMind has no voice mode or long-term goals yet, so *listening*, *speaking* and
*goal-completed* are designed, implemented and tested in the state machine but not triggered
anywhere. When voice input or goals are added, send `MICROPHONE_STARTED/STOPPED`,
`AUDIO_PLAYBACK_STARTED/ENDED` and `GOAL_COMPLETED` from those features.

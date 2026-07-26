---
paths:
  - "src/app/**/*.tsx"
  - "src/client/**/*.tsx"
  - "src/**/*.css"
---

# UI constraints

Full spec: `docs/UX-SPEC.md`. Read it before building a new screen or component.

- Tap targets ≥56px, primary actions ≥64px, ≥12px spacing. No exceptions for visual balance.
- Primary actions live in the bottom third. The top of the screen is status only.
- Numbers are entered with steppers, never a keyboard, unless the value can exceed 99.
- No blocking spinner on any log path. Writes are optimistic; the queue is visible.
- Body text ≥7:1 contrast in every theme, including bright-sun mode.
- Use the tokens in `docs/UX-SPEC.md` §2. Do not introduce new colors, radii, or type scales.
- `--arch` means actionable. Flat rectangles are read-only. Don't mix the signal.
- Controls and errors are literal and plain. Warmth belongs in empty states, confirmations,
  and milestones — never in a button label or an error message.
- No milestone, streak, or celebration may add a tap or delay a log by a frame.
- Charm features (milestones, streaks, leaderboard, illustrations) are gated behind
  Phase 2's exit gate. Tokens, type, and the arch land in Phase 1.

/**
 * Lamplight — UX-SPEC §6, the first of the six places warmth is allowed.
 *
 * "A genuinely warm dark mode, not a grey one — system-driven with a header
 * toggle for pre-sunrise chores."
 *
 * The tokens for both themes have existed since Phase 1 and are held to 7:1
 * by tests/unit/contrast.test.ts. What was missing was the switch.
 *
 * The override is deliberately session-scoped: it is not persisted, so the
 * next cold start follows the system again. That matches what the toggle is
 * *for* — the hour before sunrise, when the phone still thinks it is day —
 * and it avoids inventing a settings store. Invariant 6 rules out web
 * storage, and the LocalStore port is atomic domain operations rather than
 * a key-value bag, so persisting a display preference belongs with the
 * SQLite settings table in S5c, not here.
 */

export type Theme = 'daylight' | 'lamplight';

/** What the device is asking for, before any manual override. */
export function systemTheme(prefersDark: boolean): Theme {
  return prefersDark ? 'lamplight' : 'daylight';
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'lamplight' ? 'daylight' : 'lamplight';
}

/**
 * The control names its destination, not its current state.
 *
 * A toggle labelled with where you already are is the single most common way
 * to make someone tap twice to find out what it does, and this one is tapped
 * in the dark with cold hands.
 */
export function toggleLabel(current: Theme): string {
  return current === 'lamplight' ? 'Switch to daylight' : 'Switch to lamplight';
}

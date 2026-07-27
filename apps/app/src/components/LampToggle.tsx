'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { otherTheme, systemTheme, toggleLabel, type Theme } from '../theme';

/**
 * The lamp in the header (UX-SPEC §4 — the `○` beside the sync chip).
 *
 * R3 keeps the top of the screen for status, and this respects that: it is
 * not a primary action, it costs nothing to ignore, and it sits nowhere a
 * thumb reaches for the log path.
 *
 * Appearance is CSS, not React. The page is already themed by the media
 * query before a line of JavaScript runs, so a lamp whose lit state came from
 * state would spend its first frame disagreeing with the wall behind it.
 * Here CSS owns how the glass looks and this component owns only the
 * override and what the control announces.
 */

const DARK = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DARK);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersDark = (): boolean => window.matchMedia(DARK).matches;

/** Server and first hydration render. Daylight is the documented default. */
const prefersDarkOnServer = (): boolean => false;

export function LampToggle(): React.ReactElement {
  const [override, setOverride] = useState<Theme | null>(null);
  const system = useSyncExternalStore(subscribe, prefersDark, prefersDarkOnServer);

  // Until someone overrides it, sunrise while the app is open just happens.
  const theme = override ?? systemTheme(system);

  const flip = useCallback(() => {
    const next = otherTheme(theme);
    // The attribute is what the tokens key off, and it must beat the media
    // query in both directions — hence an explicit value, never a removal.
    document.documentElement.dataset.theme = next;
    setOverride(next);
  }, [theme]);

  return (
    <button
      type="button"
      className="lamp"
      onClick={flip}
      aria-pressed={theme === 'lamplight'}
      aria-label={toggleLabel(theme)}
      title={toggleLabel(theme)}
      data-testid="lamp-toggle"
    >
      <span className="lamp__glass" aria-hidden="true" />
    </button>
  );
}

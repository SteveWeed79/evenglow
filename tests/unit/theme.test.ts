import { describe, expect, it } from 'vitest';
import { otherTheme, systemTheme, toggleLabel } from '@homefarm/core/theme';

describe('lamplight', () => {
  it('follows the system by default', () => {
    expect(systemTheme(true)).toBe('lamplight');
    expect(systemTheme(false)).toBe('daylight');
  });

  it('flips both ways', () => {
    expect(otherTheme('daylight')).toBe('lamplight');
    expect(otherTheme('lamplight')).toBe('daylight');
    expect(otherTheme(otherTheme('daylight'))).toBe('daylight');
  });

  /**
   * A control labelled with where you already are costs a tap to find out
   * what it does, and this one is found in the dark.
   */
  it('names its destination, not its current state', () => {
    expect(toggleLabel('daylight')).toBe('Switch to lamplight');
    expect(toggleLabel('lamplight')).toBe('Switch to daylight');
  });
});

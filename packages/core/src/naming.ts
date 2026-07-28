/**
 * Default names for groups.
 *
 * The name field has always been optional, falling back to the species label
 * — so a keeper who adds two lots of chickens without typing anything gets two
 * groups called "Chickens" and no way to tell them apart on the Today screen.
 *
 * Onboarding is supposed to need "no typing beyond a farm name" (UX-SPEC §5),
 * so requiring one is the wrong fix. Making the default distinct is the right
 * one, and showing that default in the placeholder is what turns the field
 * from decoration into an invitation: the box says what this group is *going*
 * to be called, and typing over it is obviously allowed.
 */

/**
 * The first unused name of the form "Chickens", "Chickens 2", "Chickens 3".
 *
 * Case- and space-insensitive, because "chickens" and "Chickens" are the same
 * flock to everyone except a string comparison.
 */
export function defaultGroupName(label: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));

  if (!taken.has(label.trim().toLowerCase())) return label;

  // At most `existing.length` names are taken, so a free one is guaranteed
  // inside this range — no unbounded loop, and no timestamp to make it unique.
  for (let n = 2; n <= existing.length + 2; n++) {
    const candidate = `${label} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  return `${label} ${existing.length + 2}`;
}

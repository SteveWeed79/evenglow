import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStale, modifiedAt } from '../lib/cxx-stale.mjs';

/**
 * Exits 1 for "the native cache is stale, clear it" and 0 for "leave it".
 *
 * ## Why this is a file rather than a `node -e` one-liner
 *
 * It was one, inside `for /f %%R in ('node -e "..."')`, and on a real machine
 * that line printed:
 *
 *   The system cannot find the drive specified.
 *   The system cannot find the drive specified.
 *
 * twice per run, in the middle of "Start the farm server". Harmless-looking,
 * and not harmless. `for /f` runs its command through a second `cmd /c`, so
 * the snippet was parsed twice — and the JavaScript it carried was made of the
 * characters that survive neither pass: single quotes around `'fs'` inside a
 * single-quoted `for /f` argument, double quotes around the whole `-e` string
 * inside those, and colons in `{statSync:t}` and `?'stale':'ok'` that a
 * mangled fragment reads as a drive letter.
 *
 * **So the check never ran.** `%%R` was never assigned, the `do` block never
 * executed, and the stale `.cxx` this exists to delete survived every time —
 * while the window said nothing was wrong. The guard against AGP bug 255965912
 * has been decorative on Windows since it was written, and the two lines of
 * noise were the only evidence of it.
 *
 * An exit code rather than stdout, so the caller needs no `for /f` at all —
 * `if errorlevel 1` and nothing to quote.
 */

/**
 * Anchored to this file rather than to the working directory.
 *
 * The batch callers `cd` to the repo root first, and one of them was getting
 * that wrong too: `cd apps\mobile` without `/d` is a silent no-op when the
 * current drive is not the repo's. Deriving the root from a path that cannot
 * be anything else removes the question.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

process.exit(
  isStale(
    modifiedAt(join(ROOT, 'node_modules', '.modules.yaml')),
    modifiedAt(join(ROOT, 'apps', 'mobile', 'android', 'app', '.cxx')),
  )
    ? 1
    : 0,
);

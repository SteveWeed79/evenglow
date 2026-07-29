/**
 * Where the engine says something went wrong.
 *
 * The loop runs on a timer, so nothing is awaiting it and there is no caller
 * to throw to. Every failure therefore went to `console.warn` — which on a
 * handset means a line in Metro that nobody watching the app can see, and
 * which for anything thrown outside `tick`'s inner try meant an unhandled
 * rejection reported by React Native's tracker with the origin already
 * discarded: `Uncaught (in promise, id: 0): "TypeError: undefined is not a
 * function"`, and no way to tell which call it was.
 *
 * A reporter is installed by the client at boot. Core keeps the default —
 * `console.warn` — so nothing here depends on a UI existing, and the browser
 * and the tests behave as they always did.
 */

export type EngineReporter = (where: string, error: unknown) => void;

const DEFAULT: EngineReporter = (where, error) => {
  console.warn(`Steading: ${where} failed`, error);
};

let reporter: EngineReporter = DEFAULT;

export function setEngineReporter(next: EngineReporter): void {
  reporter = next;
}

/** Tests only, so one suite's reporter cannot leak into the next. */
export function resetEngineReporter(): void {
  reporter = DEFAULT;
}

/**
 * Never throws, whatever the reporter does.
 *
 * This is called from the loop's own failure path. A reporter that threw
 * would turn a recoverable sync failure into the wedged loop this exists to
 * report on.
 */
export function reportEngineError(where: string, error: unknown): void {
  try {
    reporter(where, error);
  } catch {
    // Nothing useful left to do. The original error is the interesting one and
    // it is already lost if we got here.
  }
}

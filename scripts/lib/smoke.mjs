/**
 * What a launched APK has to show before a build counts as working.
 *
 * Pure, and tested by `tests/unit/smoke.test.ts`, for the reason `apk.mjs`
 * gives: a workflow step is exercised for the first time on the run that
 * matters, and a judgement written inline in YAML cannot be made to fail on
 * purpose beforehand. `scripts/apk-smoke.mjs` drives the emulator and hands
 * what it saw to `judge` below; nothing in here touches a device.
 *
 * ## What it proves, and what it does not
 *
 * A signed APK that installs, whose process is alive after a wait, whose main
 * activity is the one on screen, whose logcat carries no crash, and whose
 * first screen shows a word a farmer would see. That is the floor
 * `CLAUDE.md` says every serious bug so far fell through — "the bundler is
 * not a handset" — and it is the floor the release pipeline never had: the
 * APK was built, verified and published without ever being run.
 *
 * It does not prove the app works. It proves it opens.
 *
 * Every check fails closed: empty input is a failure, not a pass, because an
 * `adb` command that produced nothing is a device that told us nothing.
 */

/** Process ids from `pidof`, which prints them space-separated or nothing. */
export function parsePids(text) {
  return (text ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => /^\d+$/.test(word))
    .map(Number);
}

/**
 * The activity Android says is on top, from `dumpsys activity activities`.
 *
 * Every Android version prints it differently: `mResumedActivity` on older
 * builds, `ResumedActivity` inside a display block on newer ones, and
 * `topResumedActivity=` in the task summary. All three name the component as
 * `package/activity`, which is the part that matters, so all three are read
 * and the first is returned.
 */
export function resumedActivity(dumpsys) {
  const text = dumpsys ?? '';
  const patterns = [
    /mResumedActivity:\s*ActivityRecord\{[^}]*?\s(\S+\/\S+?)\s/,
    /\bResumedActivity:\s*ActivityRecord\{[^}]*?\s(\S+\/\S+?)\s/,
    /topResumedActivity=ActivityRecord\{[^}]*?\s(\S+\/\S+?)\s/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Lines in a logcat dump that mean the app died or hung.
 *
 * `FATAL EXCEPTION` is a Java or native crash; `has died` is the system
 * noticing; `ANR in` is a hang the system gave up on; `Force finishing` is
 * an activity the system killed. All are matched against the package so a
 * crash in some other app on the emulator is not this build's.
 */
export function crashesIn(logcat, pkg) {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const signs = [
    /FATAL EXCEPTION/,
    new RegExp(`Process ${escaped}(?::\\S+)? \\(pid \\d+\\) has died`),
    new RegExp(`ANR in ${escaped}`),
    new RegExp(`Force finishing activity ${escaped}`),
  ];
  return (logcat ?? '')
    .split('\n')
    .filter((line) => signs.some((sign) => sign.test(line)))
    .map((line) => line.trim());
}

/**
 * Every piece of text on screen, from a `uiautomator dump`.
 *
 * Both `text` and `content-desc`: React Native puts a Text component's words
 * in the first and an accessibility label in the second, and a tab bar uses
 * the second. XML entities are undone so an apostrophe in a sentence matches
 * the sentence in the source.
 */
export function textsIn(hierarchy) {
  const found = [];
  for (const match of (hierarchy ?? '').matchAll(/\b(?:text|content-desc)="([^"]*)"/g)) {
    const value = unescapeXml(match[1]);
    if (value.trim() !== '') found.push(value);
  }
  return found;
}

function unescapeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * The verdict, with every problem named rather than the first one.
 *
 * `expectAny` is the words that mean the first screen rendered — any one of
 * them on screen is enough, because the exact word depends on what the farm
 * has and this device has nothing. Case-insensitive, since a tab bar sets
 * its labels in tracked caps and the hierarchy may carry either.
 */
/**
 * @typedef {object} Seen
 * @property {string} pkg
 * @property {number[]} pids
 * @property {string | null} resumed
 * @property {string[]} crashes
 * @property {string[]} texts
 * @property {string[]} expectAny
 */

/**
 * @param {Seen} seen
 * @returns {{ ok: boolean; problems: string[] }}
 */
export function judge({ pkg, pids, resumed, crashes, texts, expectAny }) {
  const problems = [];

  if (pids.length === 0) problems.push(`No process for ${pkg} — the app is not running.`);

  if (resumed === null) {
    problems.push('No resumed activity could be read from dumpsys.');
  } else if (!resumed.startsWith(`${pkg}/`)) {
    problems.push(`The activity on screen is ${resumed}, not one of ${pkg}.`);
  }

  for (const line of crashes) problems.push(`logcat: ${line}`);

  const lowered = texts.map((text) => text.toLowerCase());
  const seen = expectAny.some((word) => lowered.some((text) => text.includes(word.toLowerCase())));
  if (!seen) {
    const sample = texts.slice(0, 12).map((text) => JSON.stringify(text)).join(', ');
    problems.push(
      `None of ${expectAny.map((w) => JSON.stringify(w)).join(', ')} is on screen. ` +
        (texts.length === 0 ? 'The hierarchy had no text at all.' : `On screen: ${sample}.`),
    );
  }

  return { ok: problems.length === 0, problems };
}

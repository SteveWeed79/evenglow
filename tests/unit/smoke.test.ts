import { describe, expect, it } from 'vitest';
import { crashesIn, judge, parsePids, resumedActivity, textsIn } from '../../scripts/lib/smoke.mjs';

/**
 * The verdict a built APK is held to on a device.
 *
 * Same argument as `apk.test.ts`: a workflow step is exercised for the first
 * time on the run that matters, so the judgement lives in a lib and every
 * rule here is made to fail on purpose before it is trusted to pass. The
 * failure mode this guards is the one `CLAUDE.md` names — an app that builds,
 * verifies, publishes, and does not open.
 */

const PKG = 'dev.swbuild.homefarm';

const DUMPSYS_OLD = `
  Stack #1: type=standard mode=fullscreen
    Task id #12
      * ActivityRecord{a1b2c3 u0 dev.swbuild.homefarm/.MainActivity t12}
    mResumedActivity: ActivityRecord{a1b2c3 u0 dev.swbuild.homefarm/.MainActivity t12}
`;

const DUMPSYS_NEW = `
Display #0 (activities from top to bottom):
  * Task{f00 #14 type=standard A=10182:dev.swbuild.homefarm U=0 visible=true}
    topResumedActivity=ActivityRecord{9e8d u0 dev.swbuild.homefarm/.MainActivity t14}
  ResumedActivity: ActivityRecord{9e8d u0 dev.swbuild.homefarm/.MainActivity t14}
`;

const HIERARCHY = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="dev.swbuild.homefarm" content-desc="">
    <node index="0" text="Nothing to log yet" class="android.widget.TextView" content-desc="" />
    <node index="1" text="Add what you keep under Stock, and the morning&apos;s tally lands here." class="android.widget.TextView" content-desc="" />
    <node index="2" text="" class="android.view.ViewGroup" content-desc="Today, tab, 1 of 3" />
  </node>
</hierarchy>`;

interface Seen {
  pkg: string;
  pids: number[];
  resumed: string | null;
  crashes: string[];
  texts: string[];
  expectAny: string[];
}

function seen(over: Partial<Seen> = {}) {
  return judge({
    pkg: PKG,
    pids: [4321],
    resumed: `${PKG}/.MainActivity`,
    crashes: [],
    texts: textsIn(HIERARCHY),
    expectAny: ['Today', 'Nothing to log yet'],
    ...over,
  });
}

describe('reading the device', () => {
  it('reads process ids, and nothing from nothing', () => {
    expect(parsePids('4321 4400\n')).toEqual([4321, 4400]);
    expect(parsePids('')).toEqual([]);
    expect(parsePids(undefined)).toEqual([]);
  });

  it('finds the resumed activity however this Android prints it', () => {
    expect(resumedActivity(DUMPSYS_OLD)).toBe(`${PKG}/.MainActivity`);
    expect(resumedActivity(DUMPSYS_NEW)).toBe(`${PKG}/.MainActivity`);
    expect(resumedActivity('')).toBeNull();
  });

  it('reads every word on screen, entities undone', () => {
    const texts = textsIn(HIERARCHY);
    expect(texts).toContain('Nothing to log yet');
    expect(texts).toContain("Add what you keep under Stock, and the morning's tally lands here.");
    expect(texts).toContain('Today, tab, 1 of 3');
    expect(textsIn('')).toEqual([]);
  });

  it('picks out a crash of this app and ignores another app’s', () => {
    const logcat = [
      '09-29 10:00:01.000  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main',
      `09-29 10:00:02.000   999   999 I ActivityManager: Process ${PKG} (pid 4321) has died`,
      '09-29 10:00:03.000   999   999 I ActivityManager: Process com.android.chrome (pid 77) has died',
      `09-29 10:00:04.000   999   999 E ActivityManager: ANR in ${PKG}`,
    ].join('\n');
    const found = crashesIn(logcat, PKG);
    expect(found).toHaveLength(3);
    expect(found.join('\n')).not.toContain('chrome');
    expect(crashesIn('', PKG)).toEqual([]);
  });
});

describe('the verdict', () => {
  it('passes an app that is up, on top, quiet, and drawn', () => {
    expect(seen()).toEqual({ ok: true, problems: [] });
  });

  it('fails closed on a device that told us nothing', () => {
    const verdict = seen({ pids: [], resumed: null, texts: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toHaveLength(3);
  });

  it('fails when something else is on top', () => {
    const verdict = seen({ resumed: 'com.android.launcher3/.Launcher' });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain('com.android.launcher3');
  });

  it('fails on a crash even when the process was restarted', () => {
    const verdict = seen({ crashes: ['E AndroidRuntime: FATAL EXCEPTION: main'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain('FATAL EXCEPTION');
  });

  it('fails when the first screen never showed a word it should', () => {
    const verdict = seen({ texts: ['Loading…'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain('"Loading…"');
  });

  it('matches the expected word whatever its case, and any one of them', () => {
    expect(seen({ texts: ['TODAY'] }).ok).toBe(true);
    expect(seen({ texts: ['nothing to log yet'] }).ok).toBe(true);
  });
});

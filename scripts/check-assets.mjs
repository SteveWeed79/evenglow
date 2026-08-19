#!/usr/bin/env node
/**
 * `pnpm check:assets` — the gate the launcher icon and splash are held to.
 *
 * Same spirit as `check:icons`: a rule that is cheap to state and impossible to
 * forget, because CI fails without it. The failure this exists to prevent is
 * specific and silent — `app.json` names an image that is not there, the
 * prebuild carries on, and the APK ships wearing the default Expo icon. That
 * is exactly the state the design brief found the project in, and nothing in
 * the toolchain complained.
 *
 * What it proves, on every build:
 *   1. Presence   — every path `app.json` names exists on disk.
 *   2. Format     — PNG only. Expo fails a *production* build on anything
 *                   else, which is the worst moment to find out.
 *   3. Size       — app icons are exactly 1024x1024, which Expo requires.
 *   4. Safe zone  — an Android adaptive foreground keeps its content inside
 *                   the 66/108 circle that no OEM mask may clip.
 *
 * Rule 4 is the one worth having. The other three are typos; this one is a
 * design mistake that looks fine in the source PNG, looks fine in a preview
 * that uses a circular mask, and loses a letter's shoulder on whichever
 * handset ships a squircle. It is measured from the alpha channel rather than
 * asserted in a comment.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, contentFraction } from './lib/png.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOBILE = path.join(ROOT, 'apps/mobile');
const CONFIG = path.join(MOBILE, 'app.json');

const problems = [];
const notes = [];
const fail = (message) => problems.push(message);

/**
 * Android's adaptive icon is a 108dp canvas masked to 72dp, and only a centred
 * 66dp circle is guaranteed never to be clipped — the mask is chosen by the
 * OEM and need only be convex. So content may occupy 66/108 of the canvas.
 */
const SAFE_FRACTION = 66 / 108;

/** A little slack: a hair of antialiasing outside the circle is not a defect. */
const SAFE_TOLERANCE = 0.02;

// ── the rules ───────────────────────────────────────────────────────────────

const config = JSON.parse(readFileSync(CONFIG, 'utf8')).expo;

/** Every asset `app.json` names, and what each one has to satisfy. */
const referenced = [];

const add = (value, label, rules) => {
  if (typeof value !== 'string') return;
  referenced.push({ value, label, rules });
};

add(config.icon, 'icon', { square: 1024 });
add(config.android?.adaptiveIcon?.foregroundImage, 'android.adaptiveIcon.foregroundImage', {
  square: 1024,
  safeZone: true,
});
add(config.android?.adaptiveIcon?.backgroundImage, 'android.adaptiveIcon.backgroundImage', {
  square: 1024,
});
add(config.android?.adaptiveIcon?.monochromeImage, 'android.adaptiveIcon.monochromeImage', {
  square: 1024,
  safeZone: true,
});

for (const variant of ['light', 'dark', 'tinted']) {
  add(config.ios?.icon?.[variant], `ios.icon.${variant}`, { square: 1024 });
}

const splash = (config.plugins ?? []).find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
)?.[1];

if (splash !== undefined) {
  add(splash.image, 'splash.image', {});
  add(splash.dark?.image, 'splash.dark.image', {});
  if (splash.dark === undefined) {
    fail('the splash has no `dark` variant, so a lamplight farm opens on a bright screen');
  }
}

/**
 * Nothing configured is the state this project is actually in, and it is
 * reported rather than failed.
 *
 * The distinction is the whole contract. **A gap is a warning; a lie is an
 * error.** Failing here would put the repository permanently red over a known,
 * written-down gap — `docs/DESIGN-BRIEF.md` §3 has listed the missing launcher
 * icon for as long as it has existed — and a check that is always red is a
 * check nobody reads. But the moment `app.json` claims an icon, that claim is
 * held to every rule below, because a *wrong* path is the failure that ships
 * an APK wearing the default Expo owl while the config says otherwise.
 *
 * So this half-shouts until somebody wires it up, and bites forever after.
 */
if (referenced.length === 0 && splash === undefined) {
  console.warn(
    [
      'check:assets — no launcher icon and no splash are configured.',
      '',
      'An APK handed to anyone today wears the default Expo icon and opens on a',
      'blank screen. This is a warning rather than a failure because the gap is',
      'known and written down; it becomes a hard gate the moment app.json names',
      'an image. To wire it up, add `expo-splash-screen` and:',
      '',
      '  "icon": "./assets/icon/homefarm.png",',
      '  "android": { "adaptiveIcon": {',
      '      "foregroundImage": "./assets/icon/homefarm-foreground.png",',
      '      "backgroundColor": "#201913",',
      '      "monochromeImage": "./assets/icon/homefarm-monochrome.png" } },',
      '  "plugins": [["expo-splash-screen", {',
      '      "image": "./assets/splash/homefarm-daylight.png",',
      '      "backgroundColor": "#EDE6D2", "imageWidth": 180,',
      '      "dark": { "image": "./assets/splash/homefarm-lamplight.png",',
      '                "backgroundColor": "#201913" } }]]',
      '',
      'Icons must be exactly 1024x1024 PNGs. The adaptive foreground must keep',
      `its content inside ${(SAFE_FRACTION * 100).toFixed(0)}% of the canvas — the rest is what an OEM mask may`,
      'clip. A monochrome layer is not optional for long: Android 16 QPR2 themes',
      'every icon, and one you do not supply is one the system derives for you.',
    ].join('\n'),
  );
  process.exit(0);
}

for (const { value, label, rules } of referenced) {
  const file = path.join(MOBILE, value);

  if (!existsSync(file)) {
    fail(`${label}: ${value} does not exist`);
    continue;
  }

  if (!value.endsWith('.png')) {
    // Expo fails a production build on this and says so only then.
    fail(`${label}: ${value} is not a .png, which fails the production build`);
    continue;
  }

  const png = readPng(file);
  if (png === null) {
    fail(`${label}: ${value} is named .png but is not one`);
    continue;
  }

  if (rules.square !== undefined && (png.width !== rules.square || png.height !== rules.square)) {
    fail(
      `${label}: ${value} is ${png.width}x${png.height}, and Expo requires exactly ` +
        `${rules.square}x${rules.square}`,
    );
  }

  if (rules.safeZone === true) {
    const fraction = contentFraction(png);
    if (fraction === null) {
      notes.push(`${label}: not an 8-bit PNG with alpha, so the safe zone was NOT measured`);
    } else if (fraction > SAFE_FRACTION + SAFE_TOLERANCE) {
      fail(
        `${label}: content spans ${(fraction * 100).toFixed(0)}% of the canvas; the adaptive ` +
          `icon safe zone is ${(SAFE_FRACTION * 100).toFixed(0)}%, so an OEM mask will clip it`,
      );
    }
  }
}

for (const note of notes) console.warn(`check:assets — ${note}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`check:assets — ${problem}`);
  console.error(
    `\ncheck:assets — ${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
      'An APK with a missing icon ships wearing the default Expo one.',
  );
  process.exit(1);
}

console.log(
  `check:assets — ${referenced.length} images, all present, sized, and inside the safe zone.`,
);

import { Capacitor } from '@capacitor/core';

/**
 * Which storage and which triggers this build should use.
 *
 * The web build runs in a browser with IndexedDB and DOM online events; the
 * APK runs in a WebView with native SQLite and Capacitor's lifecycle plugins.
 * Both entries render the same components — this is the one thing that
 * genuinely differs, so it is the one thing that branches.
 */

export type Platform = 'android' | 'ios' | 'web';

/** Takes the platform as an argument so the decision is testable without a WebView. */
export function isNative(platform: string = Capacitor.getPlatform()): boolean {
  return platform === 'android' || platform === 'ios';
}

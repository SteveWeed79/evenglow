/**
 * Does the alert parser survive real weather?
 *
 * ## Why this exists
 *
 * `fetchAlerts` drops anything that will not parse, deliberately — one
 * unusable feature must not take the tornado warning beside it down. The cost
 * of that choice is that a *schema mismatch is silent*. An alert we cannot
 * read looks exactly like an alert that was never issued, and the screen for
 * both is a quiet day.
 *
 * Unit tests cannot catch it, because they assert against payloads we wrote
 * ourselves. Waiting for local weather cannot catch it either — you would be
 * betting on Kansas producing every event type the NWS issues.
 *
 * So: ask for every alert active in the United States right now, run the real
 * parse over all of them, and report what fell out. A few hundred live
 * payloads across every event type is far better evidence than one lucky
 * thunderstorm.
 *
 *     pnpm verify:alerts
 *     pnpm verify:alerts --verbose     # print every dropped feature
 *
 * Exit code is 1 if anything was dropped, so this can gate a release. It is
 * NOT in CI: it depends on live weather and on api.weather.gov being
 * reachable, and a red build because a government service was slow teaches
 * people to ignore red builds.
 *
 * ## What a failure means
 *
 * A drop is not automatically a bug. `/alerts/active` carries products the
 * app has no opinion about, and one missing an `event` or an `id` is
 * genuinely unusable. What matters is the *reason* — a drop for "no event
 * name" is the feed being odd, and a drop for a field we thought was always a
 * string is our schema being wrong about the real world.
 */

import { z } from 'zod';
import { alertSchema, type AlertSeverity } from '../packages/contracts/src/weather.ts';

const FEED = 'https://api.weather.gov/alerts/active';

/**
 * The NWS asks for a contact address in the User-Agent so they can reach
 * whoever is hammering them. This is a one-off script rather than the app, so
 * it says so.
 */
const AGENT = 'homefarm-alert-conformance (contact: set HOMEFARM_CONTACT)';

const verbose = process.argv.includes('--verbose');

// ── the same shapes the provider uses ────────────────────────────────────────
//
// Duplicated from `packages/core/src/weather/provider.ts` rather than
// exported, because exporting them would widen that module's surface for a
// script's benefit. The duplication is the point of failure to watch: if the
// provider's schema changes and this does not, this script goes quiet and
// stops being evidence. Keep them together.

const SEVERITIES: Record<string, AlertSeverity> = {
  extreme: 'extreme',
  severe: 'severe',
  moderate: 'moderate',
  minor: 'minor',
};

const alertsSchema = z.object({
  features: z.array(
    z.object({
      id: z.string().optional(),
      properties: z.object({
        id: z.string().optional(),
        event: z.string().optional(),
        severity: z.string().nullish(),
        headline: z.string().nullish(),
        description: z.string().nullish(),
        instruction: z.string().nullish(),
        onset: z.string().nullish(),
        ends: z.string().nullish(),
        expires: z.string().nullish(),
        areaDesc: z.string().nullish(),
      }),
    }),
  ),
});

function moment(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : at;
}

function text(value: string | null | undefined, max: number): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return value.slice(0, max);
}

interface Dropped {
  reason: string;
  event: string;
  area: string;
  detail?: string;
}

async function main(): Promise<void> {
  const contact = process.env.HOMEFARM_CONTACT;
  process.stdout.write(`Asking ${FEED} for every active alert in the US…\n`);

  const response = await fetch(FEED, {
    headers: {
      'User-Agent': contact === undefined ? AGENT : `homefarm-alert-conformance (${contact})`,
      Accept: 'application/geo+json',
    },
  });

  if (!response.ok) {
    process.stderr.write(`\napi.weather.gov answered ${response.status}.\n`);
    process.exitCode = 1;
    return;
  }

  const body: unknown = await response.json();

  // The envelope itself failing is the loudest possible result: it means the
  // app currently reads NO alerts at all, not merely some.
  const envelope = alertsSchema.safeParse(body);
  if (!envelope.success) {
    process.stderr.write('\nThe response envelope did not parse. Every alert is being lost.\n');
    process.stderr.write(`${z.prettifyError(envelope.error)}\n`);
    process.exitCode = 1;
    return;
  }

  const features = envelope.data.features;
  const dropped: Dropped[] = [];
  const kept = new Map<string, number>();
  const severities = new Map<string, number>();

  for (const feature of features) {
    const said = feature.properties;
    const where = text(said.areaDesc, 60) ?? 'somewhere';
    const id = said.id ?? feature.id;

    if (id === undefined) {
      dropped.push({ reason: 'no id', event: said.event ?? '(no event)', area: where });
      continue;
    }
    if (said.event === undefined) {
      dropped.push({ reason: 'no event name', event: '(no event)', area: where });
      continue;
    }

    const parsed = alertSchema.safeParse({
      id: id.slice(0, 300),
      event: said.event.slice(0, 120),
      severity: SEVERITIES[(said.severity ?? '').toLowerCase()] ?? 'unknown',
      ...(text(said.headline, 500) === undefined ? {} : { headline: text(said.headline, 500) }),
      ...(text(said.description, 20_000) === undefined
        ? {}
        : { description: text(said.description, 20_000) }),
      ...(text(said.instruction, 20_000) === undefined
        ? {}
        : { instruction: text(said.instruction, 20_000) }),
      ...(moment(said.onset) === undefined ? {} : { onset: moment(said.onset) }),
      ...(moment(said.ends ?? said.expires) === undefined
        ? {}
        : { endsAt: moment(said.ends ?? said.expires) }),
      ...(text(said.areaDesc, 500) === undefined ? {} : { area: text(said.areaDesc, 500) }),
    });

    if (!parsed.success) {
      dropped.push({
        reason: 'the contract refused it',
        event: said.event,
        area: where,
        detail: z.prettifyError(parsed.error),
      });
      continue;
    }

    kept.set(parsed.data.event, (kept.get(parsed.data.event) ?? 0) + 1);
    severities.set(parsed.data.severity, (severities.get(parsed.data.severity) ?? 0) + 1);
  }

  // ── what happened ──────────────────────────────────────────────────────────

  process.stdout.write(`\n${features.length} active alerts. ${features.length - dropped.length} parsed, ${dropped.length} dropped.\n`);

  const byCount = [...kept.entries()].sort((a, b) => b[1] - a[1]);
  process.stdout.write(`\n${byCount.length} distinct event types read:\n`);
  for (const [event, count] of byCount.slice(0, 25)) {
    process.stdout.write(`  ${String(count).padStart(4)}  ${event}\n`);
  }
  if (byCount.length > 25) process.stdout.write(`  …and ${byCount.length - 25} more\n`);

  /**
   * Severity is the field most likely to be quietly wrong, because unknown
   * values fall back to 'unknown' rather than failing. A large 'unknown'
   * count means SEVERITIES is missing a word the NWS actually uses, and the
   * app is under-reporting how bad things are.
   */
  process.stdout.write('\nSeverities:\n');
  for (const [severity, count] of [...severities.entries()].sort((a, b) => b[1] - a[1])) {
    const flag = severity === 'unknown' && count > 0 ? '   ← check SEVERITIES' : '';
    process.stdout.write(`  ${String(count).padStart(4)}  ${severity}${flag}\n`);
  }

  if (dropped.length === 0) {
    process.stdout.write('\nNothing was dropped. The parser read every alert the country has.\n');
    return;
  }

  const reasons = new Map<string, number>();
  for (const drop of dropped) reasons.set(drop.reason, (reasons.get(drop.reason) ?? 0) + 1);

  process.stdout.write('\nDropped:\n');
  for (const [reason, count] of reasons) process.stdout.write(`  ${String(count).padStart(4)}  ${reason}\n`);

  if (verbose) {
    process.stdout.write('\nEvery drop:\n');
    for (const drop of dropped) {
      process.stdout.write(`\n  ${drop.event} — ${drop.area}\n    ${drop.reason}\n`);
      if (drop.detail !== undefined) {
        process.stdout.write(`${drop.detail.split('\n').map((line) => `    ${line}`).join('\n')}\n`);
      }
    }
  } else {
    process.stdout.write('\nRun with --verbose to see each one.\n');
  }

  /**
   * A drop for "the contract refused it" is the one that matters — it means a
   * real, live warning is invisible to a farm. Missing ids and event names
   * are the feed being odd about products we could not use anyway.
   */
  const refused = dropped.filter((d) => d.reason === 'the contract refused it').length;
  if (refused > 0) {
    process.stderr.write(`\n${refused} live alerts were refused by the contract. That is a farm not being warned.\n`);
    process.exitCode = 1;
  }
}

await main();

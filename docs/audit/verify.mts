/**
 * Runnable evidence for the audit in AUDIT-2026-08.md.
 *
 *   npx tsx docs/audit/verify.mts
 *
 * Deliberately NOT under tests/ — vitest.config.ts includes only
 * `tests/**` , so this cannot turn CI red. It reproduces each finding
 * against the repository's own code and prints REPRODUCED / not reproduced.
 * Every line that says REPRODUCED is a defect still present.
 *
 * Only the findings that are pure functions are here. The ones needing a
 * live MongoDB (H3, H4, H5) or a populated SQLite store (H7, H13, H18)
 * are covered in the report and are not reproducible from this script.
 */
import { activeWithdrawals } from '../../packages/contracts/src/withdrawal';
import { withdrawalDue, birthDue } from '../../packages/contracts/src/due/livestock';
import { serviceDue } from '../../packages/contracts/src/due/iron';
import { todayList, urgencyOf } from '../../packages/contracts/src/due/types';
import { payloadSchemaFor } from '../../packages/contracts/src/entities/index';
import { partitionClears } from '../../packages/contracts/src/clearing';
import { LIBRARY_VARIETIES } from '../../packages/contracts/src/library/varieties';
import { bucketStart, bucketsBack } from '../../packages/core/src/read/trend';

const DAY = 86_400_000;
const results: { id: string; what: string; reproduced: boolean; detail: string }[] = [];
const check = (id: string, what: string, reproduced: boolean, detail: string): void => {
  results.push({ id, what, reproduced, detail });
};

// ── H10: a withdrawal row can never appear on Today ──────────────────────────
{
  const treatment = {
    id: 'M'.repeat(26), name: 'Baytril', flockId: 'F'.repeat(26),
    administeredAt: Date.UTC(2025, 4, 8), treatmentEndsAt: Date.UTC(2025, 4, 13),
    withdrawalDays: { egg: 7 },
  };
  const clearsAt = Date.UTC(2025, 4, 13) + 7 * DAY;
  let exists = 0, onToday = 0;
  for (let h = -48; h <= 48; h += 1) {
    const now = clearsAt + h * 3_600_000;
    const active = activeWithdrawals([treatment], 'egg', [treatment.flockId], now);
    if (active.length === 0) continue;
    exists += 1;
    const row = withdrawalDue(active[0]!, 'The hens');
    if (row && todayList([row], now).length > 0) onToday += 1;
  }
  check('H10', 'withdrawal row reaches Today', onToday === 0,
    `withdrawal exists for ${exists} sampled hours, reaches Today in ${onToday}`);
}

// ── H12: weekly trend buckets go unmatchable across a DST transition ─────────
{
  const now = new Date(2025, 2, 24, 10, 0, 0).getTime(); // after US spring-forward
  const buckets = bucketsBack(6, 'week', now);
  const missed = buckets.filter((b) => bucketStart(b + 2 * DAY + 12 * 3_600_000, 'week') !== b);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // A zone with no DST cannot show this, and saying so is the point: run it
  // under TZ=America/New_York (or any DST zone) or the check is vacuous.
  const jan = new Date(2025, 0, 1).getTimezoneOffset();
  const jul = new Date(2025, 6, 1).getTimezoneOffset();
  const observesDst = jan !== jul;
  check('H12', 'weekly buckets match their own logs', missed.length > 0,
    observesDst
      ? `${missed.length} of ${buckets.length} buckets can never be matched (TZ=${tz})`
      : `INCONCLUSIVE: ${tz} has no DST. Re-run with TZ=America/New_York.`);
}

// ── H9: update schemas inject .default() values ──────────────────────────────
{
  const taskUpdate = payloadSchemaFor('task', 'update')!;
  const parsed = taskUpdate.parse({ completedAt: null }) as Record<string, unknown>;
  const { set, clear } = partitionClears(parsed);
  const stored: Record<string, unknown> = { title: 'Check the water trough', recurrence: 'weekly', completedAt: 1 };
  const after: Record<string, unknown> = { ...stored, ...set };
  for (const key of clear) delete after[key];
  check('H9', 'an update touches only what it names', after.recurrence !== stored.recurrence,
    `recurrence went ${String(stored.recurrence)} -> ${String(after.recurrence)} from a payload of {completedAt:null}`);
}

// ── H17 / M5: overdue births and clips fall outside the warning window ───────
{
  const today = new Date(2025, 10, 15).setHours(0, 0, 0, 0);
  const overdue = birthDue(
    { id: 'B'.repeat(26), species: 'goat', damId: 'D'.repeat(26), bredAt: today - 152 * DAY },
    'Nettle', 'G'.repeat(26),
  );
  const at = overdue?.at ?? 0;
  check('H17', 'an overdue birth is inside the birth-cold window', at < today,
    `doe bred 152d ago (goat gestation 150d) has at=${new Date(at).toDateString()}, which is before today and so filtered out`);
}

// ── M11: an hours-based service can never reach overdue ──────────────────────
{
  const machine = { id: 'E'.repeat(26), name: 'Kubota', hasHourMeter: true, hours: 900, usagePerDay: 2 };
  const interval = { id: 'S'.repeat(26), name: 'Oil change', everyHours: 250 };
  const urgencies = [0, 1, 7, 30, 365].map((d) => {
    const now = Date.now() + d * DAY;
    const due = serviceDue(machine, interval, now);
    return due === null ? 'none' : urgencyOf(due, now);
  });
  check('M11', 'a service 650h past target reaches overdue', !urgencies.includes('overdue'),
    `urgency at +0/+1/+7/+30/+365 days: ${urgencies.join(', ')}`);
}

// ── M15: the bundled library ships varieties twice, with conflicting data ────
{
  const byKey = new Map<string, typeof LIBRARY_VARIETIES[number][]>();
  for (const v of LIBRARY_VARIETIES) {
    const key = `${v.crop.toLowerCase()}|${v.name.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), v]);
  }
  const dups = [...byKey.values()].filter((v) => v.length > 1);
  const conflicting = dups.filter((v) => JSON.stringify({ ...v[0], id: '' }) !== JSON.stringify({ ...v[1], id: '' }));
  check('M15', 'each crop+name appears once', dups.length > 0,
    `${dups.length} duplicate crop+name pairs, ${conflicting.length} of them with differing agronomy`);
}

// ── report ───────────────────────────────────────────────────────────────────
const pad = (s: string, n: number): string => s.padEnd(n);
console.log('');
console.log(pad('FINDING', 8) + pad('STATUS', 16) + 'EVIDENCE');
console.log('-'.repeat(100));
for (const r of results) {
  console.log(pad(r.id, 8) + pad(r.reproduced ? 'REPRODUCED' : 'not reproduced', 16) + r.detail);
}
console.log('');
const n = results.filter((r) => r.reproduced).length;
console.log(`${n} of ${results.length} findings reproduced against the repository's own code.`);
process.exit(0);

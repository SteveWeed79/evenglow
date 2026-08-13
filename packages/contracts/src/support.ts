import { z } from 'zod';

/**
 * A support ticket, shaped for a machine (see `docs/SUPPORT-LOOP.md`).
 *
 * **Human readability is not a goal, and that is S1.** Nobody skim-reads
 * these; they are parsed, diffed against a previous occurrence, and used to
 * locate a line of code. That inverts the usual bug-report advice and it is
 * the right inversion here: the queue depth, the schema version, the migration
 * position and the rejected-mutation reasons are a better artefact than steps
 * to reproduce written by somebody holding a bucket in a coop — and the device
 * already knows all four without anybody typing.
 *
 * One human line survives, which is whatever the farm chose to say.
 *
 * ## Two bundles, and the second is opt-in by name
 *
 * Everything in `supportBundleSchema` is structure and counts — **never
 * content**. No email, no farm name, no coordinates, no record values. That is
 * enough to diagnose most defects, because most defects are about shape rather
 * than about what a hen laid on Tuesday.
 *
 * The farm's records travel separately and only if asked for and agreed to.
 * See `docs/SUPPORT-LOOP.md` S2.
 */

export const SUPPORT_BUNDLE_VERSION = 1;

/**
 * A refused mutation, as a shape rather than as a record.
 *
 * The reason and the entity are what identify a defect; the payload is the
 * farm's data and does not belong in the lean bundle at any price. An entity
 * and a reason are usually enough to find the applier that refused it.
 */
const rejectionSchema = z.object({
  entity: z.string().max(40),
  op: z.string().max(20),
  reason: z.string().max(300),
  count: z.number().int().positive(),
});

/**
 * An error the engine reported, reduced to what identifies it.
 *
 * `where` is the operation that failed — "starting the sync loop", "subscribe"
 * — and `message` is the thrown text. Stack traces are deliberately absent:
 * they are the largest thing in a bundle and the least useful, because a
 * minified Hermes frame names nothing a repository can be searched for.
 */
const engineErrorSchema = z.object({
  where: z.string().max(120),
  message: z.string().max(500),
  count: z.number().int().positive(),
});

export const supportBundleSchema = z
  .object({
    v: z.literal(SUPPORT_BUNDLE_VERSION),
    at: z.number().int(),

    /** Which build. The first question about any report. */
    app: z.object({
      version: z.string().max(40),
      /**
       * The commit, when the build was stamped with one.
       *
       * Beside `version` rather than inside it, because `version` is in the
       * fingerprint: a commit folded into it would give every build its own
       * fingerprint for every defect, which is one issue thread per build and
       * exactly the flood §3 exists to prevent. This answers "which build" and
       * splits nothing.
       */
      build: z.string().max(40).optional(),
      platform: z.string().max(20),
      os: z.string().max(60).optional(),
    }),

    /**
     * Where the local database is on the ladder.
     *
     * A defect that only appears at one schema version is the commonest kind
     * this app can have, because a device asleep for a month arrives at a
     * version the code has moved past.
     */
    store: z.object({
      schemaVersion: z.number().int().nonnegative(),
      integrity: z.string().max(40).optional(),
    }),

    /** What the queue is doing, which is what most reports are actually about. */
    sync: z.object({
      queued: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      quarantined: z.number().int().nonnegative().optional(),
      cleared: z.number().int().nonnegative().optional(),
      lastSyncAt: z.number().int().nullable(),
      lastError: z.string().max(300).nullable(),
      held: z.string().max(40).nullable().optional(),
      online: z.boolean().optional(),
      /**
       * Whether this device has a session at all.
       *
       * **The field the first real ticket needed and did not have.** Issue #125
       * arrived with `lastError: "Sign in again to send your queued work"` and
       * six items waiting, and that sentence has two quite different causes: a
       * device that signed out, or a server refusing a token it ought to
       * accept. The first is a farm doing something; the second is a fault on
       * the box. The bundle could not tell them apart, and the answer only came
       * from the farmer saying out loud what they had pressed.
       *
       * A boolean, deliberately. It says which of two bugs this is and carries
       * nothing about who — no email, no name, no token.
       */
      signedIn: z.boolean().optional(),
    }),

    rejections: z.array(rejectionSchema).max(20),
    errors: z.array(engineErrorSchema).max(20),

    /**
     * The farm, as a correlation key and nothing more.
     *
     * Hashed rather than sent, so two reports can be recognised as the same
     * farm without the ticket naming one. A raw orgId would identify a
     * customer in a repository that may be public when the ticket is filed.
     */
    org: z.string().max(64).optional(),

    /** The one free-text line. Optional, because most people will not use it. */
    said: z.string().max(500).optional(),

    /** See `fingerprintOf`. Computed on the device so the two can be compared. */
    fingerprint: z.string().max(32),
  })
  .strict();

export type SupportBundle = z.infer<typeof supportBundleSchema>;

/**
 * FNV-1a, 64-bit, in base36.
 *
 * **Not cryptographic and does not need to be.** A fingerprint groups repeat
 * reports of one defect; there is nothing to forge and nothing to protect.
 * What it does need is to be identical on a handset and on a server, which
 * rules out `crypto` — Hermes has no such global (the lint guard exists
 * because that exact assumption once shipped) — and rules out anything
 * asynchronous, because this is computed while assembling a bundle on a device
 * that may be about to crash again.
 *
 * Twelve-ish base36 characters, which is short enough to sit in an issue label
 * and long enough that two unrelated defects will not collide.
 */
export function hash64(input: string): string {
  // 64-bit FNV-1a via two 32-bit halves, because Hermes has no BigInt on every
  // version this ships to and a 32-bit space collides too readily at scale.
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    low ^= code & 0xff;
    high ^= (code >>> 8) & 0xff;
    // 16777619, split so the multiply stays inside 32 bits.
    low = Math.imul(low, 0x01000193) >>> 0;
    high = Math.imul(high, 0x01000193) >>> 0;
  }

  return (high.toString(36) + low.toString(36)).slice(0, 16);
}

/**
 * What makes two reports the same defect.
 *
 * **Only the parts that identify it, never the parts that describe this
 * instance.** The error signature, the operation, the entity, the build and
 * the schema version — not the timestamp, not the org, not the queue depth.
 * Including any of those would give every report a unique fingerprint, which
 * is the flood the fingerprint exists to prevent.
 *
 * ## Erring specific is the safe direction
 *
 * Too loose and two unrelated defects merge into one thread and earn one wrong
 * fix. Too specific and there are duplicate issues, which is an annoyance. The
 * build version is in here for exactly that reason: the same message from two
 * releases is plausibly two different bugs, and splitting them costs a
 * duplicate while merging them costs a misdiagnosis.
 *
 * ## Numbers in messages are flattened
 *
 * "Record 01KZ9T… could not be read" and the same sentence about another ULID
 * are one defect, and left alone they would be two thousand issues. Digits and
 * long identifiers are replaced before hashing, which is the single most
 * important line in this function.
 */
export function fingerprintOf(input: {
  appVersion: string;
  schemaVersion: number;
  errors: readonly { where: string; message: string }[];
  rejections: readonly { entity: string; op: string; reason: string }[];
  said?: string | undefined;
}): string {
  const signature = [
    input.appVersion,
    `schema:${input.schemaVersion}`,
    ...input.errors.map((e) => `${e.where}|${generalise(e.message)}`),
    ...input.rejections.map((r) => `${r.entity}.${r.op}|${generalise(r.reason)}`),
  ];

  /**
   * A report with nothing wrong in it still needs a fingerprint.
   *
   * Somebody can raise a ticket because a screen looks odd, with no error and
   * no rejection to key on. Those group on what they said instead — imperfect,
   * and better than every such report becoming one enormous thread.
   */
  if (signature.length === 2 && input.said !== undefined) {
    signature.push(`said:${generalise(input.said).slice(0, 80)}`);
  }

  return hash64(signature.join('\n'));
}

/**
 * Strips the parts of a message that vary between occurrences of one defect.
 *
 * ULIDs, UUIDs, hex digests, timestamps and bare numbers all become a
 * placeholder. Without this, an error naming a record id produces one issue
 * per record — which is one issue per morning, per farm.
 */
function generalise(message: string): string {
  return message
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<id>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .slice(0, 300);
}

/**
 * The ticket as it leaves the device.
 *
 * `records` is the opt-in half (S2) and is absent unless the farm was asked
 * and said yes. It travels as an already-serialised string rather than as a
 * parsed structure, because the server does not read it — it stores it — and
 * parsing a farm's whole database to put it straight back into a string would
 * be work with a failure mode and no purpose.
 */
export const supportTicketSchema = z
  .object({
    bundle: supportBundleSchema,
    records: z.string().max(20_000_000).optional(),
  })
  .strict();

export type SupportTicket = z.infer<typeof supportTicketSchema>;

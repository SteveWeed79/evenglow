import type { Db, IndexDescription } from 'mongodb';
import { COLLECTIONS, type CollectionName } from './scoped';

/**
 * Index definitions live as data so the "every collection has an
 * orgId-leading index" rule (C3) can be asserted by a test without a live
 * server. Applied via `pnpm db:indexes`, never on the request path.
 */

export const INDEXES: Record<CollectionName, IndexDescription[]> = {
  mutations: [
    /**
     * Hydration seeks into this on the (serverTs, _id) cursor pair and walks
     * forward. It replaces the old { orgId, serverTs: -1 }, which it strictly
     * subsumes: with orgId pinned by equality, Mongo walks this index in
     * reverse to serve a serverTs-descending sort, so nothing that read
     * newest-first has lost its index. Carrying both would cost a write on the
     * hottest collection in the schema to buy nothing.
     */
    { key: { orgId: 1, serverTs: 1, _id: 1 } },
    { key: { orgId: 1, deviceId: 1, clientSeq: 1 } },
  ],
  flocks: [{ key: { orgId: 1, _id: 1 } }, { key: { orgId: 1, species: 1, archivedAt: 1 } }],
  animals: [
    { key: { orgId: 1, flockId: 1, archivedAt: 1 } },
    { key: { orgId: 1, tag: 1 } },
  ],
  medications: [
    // The withdrawal banner asks "what is active for this group, now?"
    { key: { orgId: 1, flockId: 1, administeredAt: -1 } },
    { key: { orgId: 1, animalId: 1, administeredAt: -1 } },
  ],
  productionLogs: [
    { key: { orgId: 1, kind: 1, occurredAt: -1 } },
    { key: { orgId: 1, flockId: 1, occurredAt: -1 } },
    { key: { orgId: 1, animalId: 1, occurredAt: -1 } },
  ],
  eggLogs: [
    { key: { orgId: 1, occurredAt: -1 } },
    { key: { orgId: 1, flockId: 1, occurredAt: -1 } },
    { key: { orgId: 1, birdId: 1, occurredAt: -1 } },
  ],
  feedLogs: [{ key: { orgId: 1, occurredAt: -1 } }, { key: { orgId: 1, flockId: 1, occurredAt: -1 } }],
  mortality: [
    { key: { orgId: 1, occurredAt: -1 } },
    { key: { orgId: 1, flockId: 1, occurredAt: -1 } },
    { key: { orgId: 1, animalId: 1, occurredAt: -1 } },
  ],
  predatorLogs: [{ key: { orgId: 1, occurredAt: -1 } }],
  equipment: [{ key: { orgId: 1, _id: 1 } }, { key: { orgId: 1, archivedAt: 1 } }],
  hourReadings: [
    { key: { orgId: 1, equipmentId: 1, occurredAt: -1 } },
    // Usage-rate forecasting (W5) reads the tail of this series per machine.
    { key: { orgId: 1, equipmentId: 1, hours: -1 } },
  ],
  maintenance: [
    { key: { orgId: 1, equipmentId: 1, dueAtHours: 1 } },
    { key: { orgId: 1, dueAtDate: 1 } },
  ],
  tasks: [{ key: { orgId: 1, dueAtDate: 1, completedAt: 1 } }],
  inventory: [{ key: { orgId: 1, _id: 1 } }, { key: { orgId: 1, reorderBelow: 1 } }],
  // By item and newest first, because the only question asked of these is
  // "what happened to this sack" — a shelf-wide chronology is What happened's
  // job and it reads the mutation log, not this.
  stockAdjustments: [
    { key: { orgId: 1, _id: 1 } },
    { key: { orgId: 1, itemId: 1, occurredAt: -1 } },
  ],
  photos: [{ key: { orgId: 1, subjectId: 1 } }, { key: { orgId: 1, uploadedAt: -1 } }],

  // Growing. A farm has one or two sites and a handful of beds, so these are
  // sized for the queries rather than for volume — except plantings and
  // harvests, which accumulate for as long as the farm exists.
  sites: [{ key: { orgId: 1, _id: 1 } }],
  beds: [{ key: { orgId: 1, siteId: 1, archivedAt: 1 } }],
  varieties: [
    { key: { orgId: 1, _id: 1 } },
    // "What can I plant?" filters by crop; "what is due to sow?" needs family
    // only after a bed is chosen, so crop leads.
    { key: { orgId: 1, crop: 1, archivedAt: 1 } },
  ],
  plantings: [
    // The season view: one bed, one year, in date order.
    { key: { orgId: 1, bedId: 1, season: 1 } },
    /**
     * Rotation asks a question no other index answers: what has been in this
     * bed, ever, and from which family. It walks back `rotationYears` seasons,
     * so it must be ordered by season descending within a bed.
     */
    { key: { orgId: 1, bedId: 1, season: -1, varietyId: 1 } },
    // The Today list: what is due next, across every bed.
    { key: { orgId: 1, status: 1, plannedSowAt: 1 } },
  ],
  harvests: [
    { key: { orgId: 1, plantingId: 1, occurredAt: -1 } },
    { key: { orgId: 1, occurredAt: -1 } },
  ],

  // Births and hatches. Both are asked "what is coming up?", which is a scan
  // over open records ordered by the date they started -- the due date is
  // derived, so it cannot be indexed.
  breedings: [
    { key: { orgId: 1, damId: 1, bredAt: -1 } },
    { key: { orgId: 1, bornAt: 1, bredAt: 1 } },
  ],
  incubations: [{ key: { orgId: 1, hatchedAt: 1, setAt: 1 } }],

  // A growth curve is a series, so both of these are read in time order for
  // one subject and almost never singly.
  weights: [
    { key: { orgId: 1, animalId: 1, occurredAt: -1 } },
    { key: { orgId: 1, flockId: 1, occurredAt: -1 } },
  ],
  shearings: [
    { key: { orgId: 1, animalId: 1, occurredAt: -1 } },
    { key: { orgId: 1, flockId: 1, occurredAt: -1 } },
  ],
  // The current ration is the one with no end date, which is the common read.
  feedPlans: [{ key: { orgId: 1, flockId: 1, endedAt: 1 } }],
  /**
   * "When was this last done?" is the only question asked of these, and it is
   * asked per group per kind — so the kind is in the key, not filtered after.
   */
  careLogs: [
    { key: { orgId: 1, flockId: 1, kind: 1, occurredAt: -1 } },
    { key: { orgId: 1, animalId: 1, kind: 1, occurredAt: -1 } },
  ],
  /**
   * The only query anything makes of a note: the thread on one thing, newest
   * first. Compound on both halves of the subject because a `flock` id and an
   * `equipment` id are drawn from the same ULID space — matching on the id
   * alone would work today and be a cross-subject leak the day two entities
   * ever shared one.
   */
  notes: [{ key: { orgId: 1, subjectEntity: 1, subjectId: 1, occurredAt: -1 } }],
};

/** Identity collections are not tenant-scoped; they need their own uniqueness rules. */
const IDENTITY_INDEXES: Record<string, IndexDescription[]> = {
  users: [
    { key: { email: 1 }, unique: true },
    { key: { orgId: 1, role: 1 } },
    /**
     * The other way a person is identified (A2.4).
     *
     * `findUserByGoogleSub` is the **first** query every Google sign-in makes,
     * and it had no index at all — a collection scan on the hot path of one of
     * two ways into the app.
     *
     * Unique, and that is the half that matters more than the speed. A Google
     * subject id is one Google account, and `linkGoogleSub` binds one to an
     * existing user with nothing stopping the same subject being bound to a
     * second — at which point `findOne` returns whichever row the scan reached
     * first and the same Google identity signs into two different farms
     * depending on the wind. The route means to prevent that; this makes it
     * true. Exactly the argument the `playPurchaseToken` index makes below:
     * *a check in a route is a thing somebody can refactor past.*
     *
     * **Partial, not merely sparse**, for the same reason as that one. Most
     * accounts are password-only and have no `googleSub`; a plain unique index
     * would let one of them hold the missing value and refuse every other
     * signup. `disableUser` also moves the field to `formerGoogleSub` on
     * removal, so a removed person's Google account is free to sign up
     * again — the filter is what keeps that true, since the vacated field is
     * `$unset` rather than nulled.
     */
    {
      key: { googleSub: 1 },
      unique: true,
      partialFilterExpression: { googleSub: { $type: 'string' } },
    },
  ],
  orgs: [
    { key: { _id: 1 } },
    /**
     * One Play purchase, one farm.
     *
     * `POST /billing/play` asks Google whether a purchase token is real, which
     * it answers about the *purchase* — Google has no idea which farm is
     * submitting it. Without this, a token that verifies could be posted by any
     * number of orgs and every one of them would be written `active`: one $39
     * subscription entitling unlimited farms. The route refuses that case with a
     * sentence, and this is what makes the refusal true even if the route is
     * ever wrong.
     *
     * **Structural rather than remembered**, which is the argument D15 already
     * makes one field over: a check in a route is a thing somebody can refactor
     * past, and a second claim on a bound token has to fail at the database or
     * it does not really fail.
     *
     * **Partial, not merely sparse.** Almost every org has no
     * `playPurchaseToken` — free farms never will — and a plain unique index
     * would let exactly one of them hold the missing value. `sparse` would
     * cover that too, but a partial filter also keeps the index to the handful
     * of rows that have actually paid, which is the set being protected.
     */
    {
      key: { playPurchaseToken: 1 },
      unique: true,
      partialFilterExpression: { playPurchaseToken: { $type: 'string' } },
    },
  ],
  refreshTokens: [
    // Family revocation touches every row in a family, on the theft path where
    // latency matters least but correctness matters most.
    { key: { familyId: 1 } },
    /**
     * Expired tokens delete themselves. Revocation state is the security
     * control and it lives in the row, so a row that has outlived its own
     * expiry protects nothing — it is just a growing table of dead secrets to
     * lose in a disclosure.
     */
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  invites: [
    // The farm's pending list. orgId leads, as everywhere else.
    { key: { orgId: 1, createdAt: -1 } },
    // Revoking names the invite by its public id, within the farm.
    { key: { orgId: 1, publicId: 1 }, unique: true },
    /**
     * Expired invites delete themselves.
     *
     * An invite that has outlived its own expiry protects nothing and grants
     * nothing — it is a row of dead secrets to lose in a disclosure. Accepted
     * and revoked ones go the same way, since expiresAt is set at creation and
     * neither state extends it.
     */
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  /**
   * Promotion codes are found by their hash, which is the `_id` — so there is
   * nothing to index for the redeem path.
   *
   * **And no TTL, deliberately**, unlike the join codes below. A join code is
   * spent within ten minutes and the row is a receipt worth keeping for a day;
   * a promotion code is a record of a subscription somebody was given, and the
   * question "who did I hand codes to, and which are still live" has no answer
   * if the rows delete themselves. They are few, they are small, and they are
   * the only record that a farm's free year was intended.
   *
   * Listed rather than omitted so nobody has to wonder whether it was
   * forgotten.
   */
  promoCodes: [],
  joinCodes: [
    // Minting replaces the farm's live code, and this is the lookup it does.
    { key: { orgId: 1, expiresAt: -1 } },
    /**
     * A spent or expired code deletes itself after a day.
     *
     * Not immediately: the row is the record of who was let onto the farm and
     * when, and an owner asking "who did I give a code to on Tuesday" is a
     * reasonable question. A day is long enough to answer it and short enough
     * that a six-character secret's hash is not sitting in the database for a
     * season. `expiresAt` is set at creation and redemption does not extend
     * it, so both states age out on the same clock.
     */
    { key: { expiresAt: 1 }, expireAfterSeconds: 86_400 },
  ],
};

/** The first key of an index description, or undefined if it has none. */
export function leadingKey(index: IndexDescription): string | undefined {
  return Object.keys(index.key)[0];
}

/**
 * Every collection that will actually be asked for indexes, and which.
 *
 * A pure function rather than a loop inlined below, because the defect it
 * exists to prevent needed a live MongoDB to find and should not have.
 *
 * **`createIndexes([])` is not a no-op.** Mongo answers *"Must specify at
 * least one index to create"* and the call throws — so `promoCodes: []`, which
 * is empty on purpose because a code is found by its `_id` and there is
 * nothing else to index, broke every route that opens a database. Every
 * DB-backed suite skips without one, so the whole local run stayed green and
 * CI caught it.
 *
 * The empty declaration stays: "listed and empty" says the question was asked,
 * where absent says nothing at all. It is the caller that has to cope, and now
 * a test can say so without a server.
 */
export function indexPlan(): [string, IndexDescription[]][] {
  const planned: [string, IndexDescription[]][] = [
    ...COLLECTIONS.map((name): [string, IndexDescription[]] => [name, INDEXES[name]]),
    ...Object.entries(IDENTITY_INDEXES),
  ];
  return planned.filter(([, indexes]) => indexes.length > 0);
}

export async function applyIndexes(database: Db): Promise<void> {
  for (const [name, indexes] of indexPlan()) {
    await database.collection(name).createIndexes(indexes);
  }
}

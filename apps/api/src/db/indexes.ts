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
  users: [{ key: { email: 1 }, unique: true }, { key: { orgId: 1, role: 1 } }],
  orgs: [{ key: { _id: 1 } }],
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

export async function applyIndexes(database: Db): Promise<void> {
  for (const name of COLLECTIONS) {
    await database.collection(name).createIndexes(INDEXES[name]);
  }
  for (const [name, indexes] of Object.entries(IDENTITY_INDEXES)) {
    await database.collection(name).createIndexes(indexes);
  }
}

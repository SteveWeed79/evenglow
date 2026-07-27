import type { Db, IndexDescription } from 'mongodb';
import { COLLECTIONS, type CollectionName } from './scoped';

/**
 * Index definitions live as data so the "every collection has an
 * orgId-leading index" rule (C3) can be asserted by a test without a live
 * server. Applied via `pnpm db:indexes`, never on the request path.
 */

export const INDEXES: Record<CollectionName, IndexDescription[]> = {
  mutations: [
    { key: { orgId: 1, serverTs: -1 } },
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
};

/** Identity collections are not tenant-scoped; they need their own uniqueness rules. */
export const IDENTITY_INDEXES: Record<string, IndexDescription[]> = {
  users: [{ key: { email: 1 }, unique: true }, { key: { orgId: 1, role: 1 } }],
  orgs: [{ key: { _id: 1 } }],
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

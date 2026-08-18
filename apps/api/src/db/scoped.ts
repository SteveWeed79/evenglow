import type {
  Db,
  DeleteResult,
  Document,
  Filter,
  InsertOneResult,
  OptionalUnlessRequiredId,
  Sort as MongoSort,
  UpdateFilter,
  UpdateResult,
  WithId,
} from 'mongodb';
import { db } from './client';

/** Re-exported so callers do not have to import from the driver directly. */
type Sort<T> = MongoSort & Partial<Record<keyof T & string, 1 | -1>>;

/**
 * The ONLY module that exposes collection handles (D2).
 *
 * Tenancy is a mechanism here, not a policy: every filter is rewritten to
 * carry orgId and every insert has orgId stamped. There is deliberately no
 * escape hatch and no "unsafe" variant — an opt-out would put us back to
 * "remember to include orgId", which is the thing this layer exists to
 * make impossible.
 */

export const COLLECTIONS = [
  'mutations',
  'flocks',
  'animals',
  'medications',
  'eggLogs',
  'productionLogs',
  'feedLogs',
  'mortality',
  'predatorLogs',
  'equipment',
  'hourReadings',
  'maintenance',
  'tasks',
  'inventory',
  'stockAdjustments',
  'photos',
  'sites',
  'beds',
  'varieties',
  'plantings',
  'harvests',
  'breedings',
  'incubations',
  'weights',
  'shearings',
  'feedPlans',
  'careLogs',
  'notes',
  'taskCompletions',
  'serviceCompletions',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

/** Every document in a scoped collection carries a client-minted ULID _id (D1) and an orgId. */
export interface Tenanted extends Document {
  _id: string;
  orgId: string;
}

/** Fields a caller may never write through an update operator. */
const IMMUTABLE_FIELDS = new Set(['orgId', '_id']);

export class TenancyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenancyViolationError';
  }
}

/**
 * ANDs orgId onto a caller-supplied filter.
 *
 * orgId is spread last so a caller-supplied orgId cannot win — passing one is
 * pointless rather than dangerous. Top-level $and/$or/$nor branches do not
 * need rewriting: the top-level orgId equality is ANDed with whatever the
 * caller wrote, so no branch can widen the result set beyond this org.
 */
export function guardFilter<T extends Tenanted>(orgId: string, filter: Filter<T> = {}): Filter<T> {
  return { ...filter, orgId } as Filter<T>;
}

/** The first path segment of a dotted field, which is what the guard judges. */
function root(field: string): string | undefined {
  return field.split('.')[0];
}

/**
 * Rejects updates that would move a document between tenants or rewrite its
 * identity. guardFilter stops you from *reaching* another org's document;
 * this stops you from *pushing* one of yours into another org, which the
 * filter guard alone does not cover.
 *
 * ## Both halves of a `$rename`, and the second half was missing
 *
 * Every other operator names the fields it writes in its **keys**, so checking
 * keys was checking everything — until `$rename`, whose keys are the fields it
 * reads and whose *values* are the fields it writes. `{ $rename: { name:
 * 'orgId' } }` passed this guard cleanly and would have moved a document to
 * whatever that farm happened to call itself.
 *
 * Nothing in this service builds a `$rename` today, and that is exactly why it
 * is worth fixing rather than noting. This function exists so tenancy is a
 * mechanism instead of a rule somebody has to remember — the same argument
 * `scoped()` makes about filters — and a mechanism with a gap where nobody
 * currently walks is a mechanism that will be trusted by whoever walks there
 * first.
 */
export function assertSafeUpdate<T extends Tenanted>(update: UpdateFilter<T>): void {
  for (const [operator, operand] of Object.entries(update)) {
    if (!operator.startsWith('$')) continue;
    if (operand === null || typeof operand !== 'object') continue;

    const fields = Object.entries(operand as Record<string, unknown>);

    for (const [field, value] of fields) {
      const written = root(field);
      if (written !== undefined && IMMUTABLE_FIELDS.has(written)) {
        throw new TenancyViolationError(
          `${operator} may not modify "${field}" — orgId and _id are immutable once written.`,
        );
      }

      // `$rename` writes its destination, which is the value. Read as unknown
      // and checked for a string rather than assumed: this is a caller's object.
      if (operator === '$rename' && typeof value === 'string') {
        const destination = root(value);
        if (destination !== undefined && IMMUTABLE_FIELDS.has(destination)) {
          throw new TenancyViolationError(
            `$rename may not write "${value}" — orgId and _id are immutable once written.`,
          );
        }
      }
    }
  }
}

interface FindOptions<T> {
  limit?: number;
  sort?: Sort<T>;
}

interface ScopedCollection<T extends Tenanted> {
  findOne(filter?: Filter<T>): Promise<WithId<T> | null>;
  findMany(filter?: Filter<T>, options?: FindOptions<T>): Promise<WithId<T>[]>;
  countDocuments(filter?: Filter<T>): Promise<number>;
  insertOne(doc: Omit<T, 'orgId'>): Promise<InsertOneResult<T>>;
  updateOne(filter: Filter<T>, update: UpdateFilter<T>): Promise<UpdateResult<T>>;
  /**
   * Idempotent insert-if-absent. orgId is stamped into $setOnInsert, so a
   * replayed batch that loses the race still lands in the right tenant.
   */
  upsertOne(filter: Filter<T>, update: UpdateFilter<T>): Promise<UpdateResult<T>>;
  deleteOne(filter: Filter<T>): Promise<DeleteResult>;
}

export interface Scoped {
  orgId: string;
  col<T extends Tenanted>(name: CollectionName): ScopedCollection<T>;
}

/**
 * The injectable core. Takes an already-resolved Db so the guard behaviour can
 * be exercised against a fake in tests without a live server.
 */
export function scopedOn(database: Db, orgId: string): Scoped {
  if (!orgId) throw new Error('scoped(): orgId is required');

  const col = <T extends Tenanted>(name: CollectionName): ScopedCollection<T> => {
    const c = database.collection<T>(name);

    return {
      findOne: (filter?: Filter<T>) => c.findOne(guardFilter<T>(orgId, filter)),

      findMany: (filter?: Filter<T>, options?: FindOptions<T>) => {
        // Sort is a projection concern, not a tenancy one — the filter is
        // guarded before it ever reaches the cursor.
        const cursor = c.find(guardFilter<T>(orgId, filter)).limit(options?.limit ?? 200);
        return (options?.sort ? cursor.sort(options.sort) : cursor).toArray();
      },

      countDocuments: (filter?: Filter<T>) => c.countDocuments(guardFilter<T>(orgId, filter)),

      insertOne: (doc: Omit<T, 'orgId'>) =>
        // orgId is supplied by the layer, never by the caller, so the spread
        // reconstitutes a complete T. The cast is the seam where that
        // structural fact is asserted to the type system.
        c.insertOne({ ...doc, orgId } as OptionalUnlessRequiredId<T>),

      updateOne: (filter: Filter<T>, update: UpdateFilter<T>) => {
        assertSafeUpdate(update);
        return c.updateOne(guardFilter<T>(orgId, filter), update);
      },

      upsertOne: (filter: Filter<T>, update: UpdateFilter<T>) => {
        assertSafeUpdate(update);
        const setOnInsert = { ...(update.$setOnInsert ?? {}), orgId };
        return c.updateOne(
          guardFilter<T>(orgId, filter),
          { ...update, $setOnInsert: setOnInsert } as UpdateFilter<T>,
          { upsert: true },
        );
      },

      deleteOne: (filter: Filter<T>) => c.deleteOne(guardFilter<T>(orgId, filter)),
    };
  };

  return { orgId, col };
}

/** App-facing entry point. Every server-side read or write goes through this. */
export async function scoped(orgId: string): Promise<Scoped> {
  return scopedOn(await db(), orgId);
}

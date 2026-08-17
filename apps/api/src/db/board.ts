import { COLLECTIONS } from './scoped';
import { db } from './client';
import { listFarmSummaries, type FarmSummary } from './farms';

/**
 * Everything the operations board reads, in one pass.
 *
 * ## Counts and timings, never contents
 *
 * `ACCESS-AND-BILLING.md` §5 draws this line for `farm:show` and it holds here
 * for the same reason: an operator needs to know a farm is generating refusals,
 * and does not need to read the refusal. **Nothing in this module returns a
 * record's fields.** Names and ids of farms, yes — they are how you address one
 * — and beyond that only numbers and dates. A board that could show a farm's
 * notes would be a reason not to build a board.
 *
 * ## Why it is here and not in `ops/`
 *
 * Raw collection access is confined to `apps/api/src/db/` by lint, and these
 * are the deliberate cross-tenant reads. Keeping them beside `farms.ts` means
 * the one place that crosses tenants stays one place; `ops/` is HTTP and HTML
 * and holds no queries at all.
 *
 * ## Read-only, and safe against a live database
 *
 * Every operation is a `find`, a `countDocuments`, an `estimatedDocumentCount`
 * or a `stats` read. Nothing here writes; the two things the board can change
 * live in `ops/actions.ts` and are called only by an explicit button.
 */

/** How a farm's records reach — or fail to reach — the rest of the farm. */
export interface SyncTrouble {
  orgId: string;
  name: string;
  /** Logged and undecided. The sweeper's queue, and normally zero. */
  pending: number;
  /** How long the oldest undecided row has been waiting, in milliseconds. */
  oldestPendingMs: number | null;
  /** Refused on purpose: a role that may not, a reading below the meter. */
  rejected: number;
  /** Refused for colliding with something already applied. */
  conflict: number;
}

export interface TokenCounts {
  /** Promotion codes: minted, and how many redemptions have been spent. */
  promoMinted: number;
  promoRedemptions: number;
  /** Codes with redemptions left and no expiry behind them. */
  promoLive: number;
  invitesPending: number;
  invitesAccepted: number;
  joinCodesLive: number;
}

export interface Health {
  /** Round trip to mongod in milliseconds, or null when it did not answer. */
  databaseMs: number | null;
  /** Seconds this process has been up. */
  uptimeSeconds: number;
  /** Bytes of records, and bytes of photographs, kept apart deliberately. */
  recordBytes: number;
  photoBytes: number;
}

export interface Board {
  farms: FarmSummary[];
  tokens: TokenCounts;
  health: Health;
  trouble: SyncTrouble[];
}

/**
 * Records and photographs are counted separately, and that is the point.
 *
 * `db:usage` says why at length: a busy year of records is under a megabyte and
 * one phone photograph is several times that, so a single "storage" number
 * hides the only ratio worth looking at — which of the two is actually growing.
 */
async function usage(): Promise<{ recordBytes: number; photoBytes: number }> {
  const database = await db();

  const sizes = await Promise.all(
    COLLECTIONS.map(async (name) => {
      try {
        const [row] = await database
          .collection(name)
          .aggregate<{ bytes: number }>([
            { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
          ])
          .toArray();
        return row?.bytes ?? 0;
      } catch {
        // A collection that does not exist yet is zero bytes, not a failure —
        // on a fresh box that is most of them.
        return 0;
      }
    }),
  );

  const [photos] = await database
    .collection('photoBytes.files')
    .aggregate<{ bytes: number }>([{ $group: { _id: null, bytes: { $sum: '$length' } } }])
    .toArray()
    .catch(() => []);

  return {
    recordBytes: sizes.reduce((total, bytes) => total + bytes, 0),
    photoBytes: photos?.bytes ?? 0,
  };
}

async function health(): Promise<Health> {
  const database = await db();

  const started = Date.now();
  const databaseMs = await database
    .command({ ping: 1 })
    .then(() => Date.now() - started)
    .catch(() => null);

  const { recordBytes, photoBytes } = await usage();

  return {
    databaseMs,
    uptimeSeconds: Math.floor(process.uptime()),
    recordBytes,
    photoBytes,
  };
}

/**
 * The closest thing this server has to a funnel.
 *
 * `redeemedBy[]` carries the farm, the person and the moment, so minted-versus-
 * spent is exact rather than estimated — and the same shape covers invites and
 * join codes. **The codes themselves are never stored** (only a SHA-256), so
 * there is nothing here that could leak one.
 */
async function tokens(now: Date): Promise<TokenCounts> {
  const database = await db();

  const promos = await database
    .collection<{
      maxRedemptions: number;
      redeemedBy: unknown[];
      expiresAt?: Date;
      disabledAt?: Date;
    }>('promoCodes')
    .find({}, { projection: { maxRedemptions: 1, redeemedBy: 1, expiresAt: 1, disabledAt: 1 } })
    .toArray();

  const invites = await database
    .collection<{ acceptedAt?: Date; revokedAt?: Date }>('invites')
    .find({}, { projection: { acceptedAt: 1, revokedAt: 1 } })
    .toArray();

  const joinCodes = await database
    .collection<{ expiresAt?: Date }>('joinCodes')
    .countDocuments({ expiresAt: { $gt: now } });

  return {
    promoMinted: promos.length,
    promoRedemptions: promos.reduce((total, code) => total + code.redeemedBy.length, 0),
    promoLive: promos.filter(
      (code) =>
        code.disabledAt === undefined &&
        (code.expiresAt === undefined || code.expiresAt > now) &&
        code.redeemedBy.length < code.maxRedemptions,
    ).length,
    invitesPending: invites.filter(
      (invite) => invite.acceptedAt === undefined && invite.revokedAt === undefined,
    ).length,
    invitesAccepted: invites.filter((invite) => invite.acceptedAt !== undefined).length,
    joinCodesLive: joinCodes,
  };
}

/**
 * Farms whose records are not reaching the rest of the farm, and nobody has
 * said so.
 *
 * **This is the panel that earns the page.** A refusal is visible to exactly
 * one person — the one who caused it, in their own inbox — so a farm quietly
 * generating them is a bug that never gets reported. `pending` is worse again:
 * nobody sees it at all, on any device, until the sweeper decides it.
 *
 * Only farms with something to say are returned. A list that named every quiet
 * farm would need reading before it could be scanned, and the whole value here
 * is that an empty panel means nothing is wrong.
 */
async function trouble(farms: readonly FarmSummary[]): Promise<SyncTrouble[]> {
  const database = await db();
  const mutations = database.collection<{ serverTs?: Date }>('mutations');

  const rows = await Promise.all(
    farms.map(async (farm) => {
      const [pending, rejected, conflict, oldest] = await Promise.all([
        mutations.countDocuments({ orgId: farm.org._id, outcome: 'pending' }),
        mutations.countDocuments({ orgId: farm.org._id, outcome: 'rejected' }),
        mutations.countDocuments({ orgId: farm.org._id, outcome: 'conflict' }),
        mutations
          .find({ orgId: farm.org._id, outcome: 'pending' })
          .sort({ serverTs: 1 })
          .limit(1)
          .toArray(),
      ]);

      const at = oldest[0]?.serverTs;

      return {
        orgId: farm.org._id,
        name: farm.org.name,
        pending,
        rejected,
        conflict,
        oldestPendingMs: at === undefined ? null : Date.now() - at.getTime(),
      } satisfies SyncTrouble;
    }),
  );

  return rows.filter((row) => row.pending > 0 || row.rejected > 0 || row.conflict > 0);
}

/**
 * One call, because the page is one page.
 *
 * The panels are gathered together rather than behind a route each: they are
 * read at the same moment by the same person, and four requests that can
 * disagree about when "now" was is a board that shows a farm in two states.
 */
export async function readBoard(now = new Date()): Promise<Board> {
  const farms = await listFarmSummaries(10_000);

  const [tokenCounts, healthNow, troubled] = await Promise.all([
    tokens(now),
    health(),
    trouble(farms),
  ]);

  return { farms, tokens: tokenCounts, health: healthNow, trouble: troubled };
}

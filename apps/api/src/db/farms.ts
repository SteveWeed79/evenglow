import { db } from './client';
import { listOrgs, listUsersInOrg, type OrgDoc } from './identity';

/**
 * Every farm on this server, with the few numbers an operator asks about.
 *
 * ## Why this is a module and not a script
 *
 * It was inline in `list-farms.mts`, which was fine while `farm:ls` was the
 * only thing that wanted it. The control centre wants exactly the same rows,
 * and the alternative to extracting it is two implementations of **the one
 * query in this codebase that crosses tenants on purpose** — which is the last
 * query that should exist twice. `scoped()` exists so no request can do this;
 * keeping the cross-tenant read in one named place is how that stays checkable.
 *
 * **Still not reachable from a route.** Living in a module rather than a script
 * does not put it behind a token — nothing imports this from `routes/`, and the
 * line `list-farms.mts` draws is the line that matters: a cross-tenant read
 * requires a shell on the server, or an operator page that has one. Read-only
 * throughout; every operation here is a `find` or a `countDocuments`.
 *
 * ## What it deliberately does not answer
 *
 * The sync state. That is `farmSyncState`, and it needs the server's
 * environment rather than the database — the `FREE_SYNC_ORGS` comp and the
 * open-server flag are both env, and a farm's situation is wrong without them.
 * Keeping it out means this module has no opinion about billing and no reason
 * to import it.
 */

/** One build, and how many accounts on this farm last spoke with it. */
export interface FarmBuild {
  version: string;
  people: number;
}

export interface FarmSummary {
  org: OrgDoc;
  people: number;
  /** Every mutation ever logged for this farm, refusals and all — it is the log. */
  records: number;
  /** The newest `serverTs` in the log, or undefined for a farm that never wrote. */
  lastWriteAt: Date | undefined;
  /**
   * What this farm is running, newest build first.
   *
   * Built from `users.lastSeen`, so it counts accounts rather than handsets and
   * omits anybody who has not synced since the field started being written.
   * An empty list is "nothing has reported yet", which on a server that just
   * deployed this is every farm.
   */
  builds: FarmBuild[];
  /** The most recent moment anybody on this farm spoke to the server. */
  lastSeenAt: Date | undefined;
}

/**
 * Sorted newest-farm-first, matching `listOrgs`.
 *
 * One round trip per farm rather than an aggregation, because the row count is
 * the number of farms on one server and the queries are all indexed lookups —
 * an aggregation pipeline here would be harder to read for no measurable gain
 * at any scale this will see.
 */
export async function listFarmSummaries(limit = 200): Promise<FarmSummary[]> {
  const orgs = await listOrgs(limit);
  if (orgs.length === 0) return [];

  const database = await db();
  const mutations = database.collection<{ serverTs?: Date }>('mutations');

  return Promise.all(
    orgs.map(async (org) => {
      const [people, records, latest] = await Promise.all([
        listUsersInOrg(org._id),
        mutations.countDocuments({ orgId: org._id }),
        mutations.find({ orgId: org._id }).sort({ serverTs: -1 }).limit(1).toArray(),
      ]);

      return {
        org,
        people: people.length,
        records,
        lastWriteAt: latest[0]?.serverTs,
        builds: tallyBuilds(people.map((person) => person.lastSeen?.client)),
        lastSeenAt: newest(people.map((person) => person.lastSeen?.at)),
      } satisfies FarmSummary;
    }),
  );
}

/**
 * Counts accounts per build, newest version first.
 *
 * Sorted numerically rather than by string, because `0.10.0` sorts before
 * `0.9.0` alphabetically and a fleet readout that puts the newest build in the
 * middle of the list is one nobody trusts twice. Every value here has already
 * been through `parseVersion` on the way in, so the split cannot fail — see
 * `recordLastSeen`.
 */
function tallyBuilds(reported: readonly (string | undefined)[]): FarmBuild[] {
  const counts = new Map<string, number>();
  for (const version of reported) {
    if (version === undefined) continue;
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }

  return [...counts]
    .map(([version, people]) => ({ version, people }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function newest(dates: readonly (Date | undefined)[]): Date | undefined {
  let best: Date | undefined;
  for (const at of dates) {
    if (at !== undefined && (best === undefined || at > best)) best = at;
  }
  return best;
}

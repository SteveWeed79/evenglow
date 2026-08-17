/**
 * `pnpm farm:ls` — every farm on this server, one line each.
 *
 * The answer to "who is actually using this", which until now needed mongosh
 * and a query nobody had written down.
 *
 * **Read-only, and safe against the live database.** Every operation is a
 * `find` or a `countDocuments`.
 *
 * ## Why this is a command and not a route
 *
 * It is the one query in the codebase that crosses tenants on purpose. The
 * whole of `scoped()` exists so that no request can do that, and the way to
 * keep it true is for the cross-tenant read to require a shell on the server
 * rather than a token — the same line `promo:new` draws for the same reason.
 *
 * **The query itself now lives in `db/farms.ts`**, because the operations page
 * wants these same rows and two implementations of the deliberate cross-tenant
 * read is the last duplication this codebase should carry. What is left here is
 * presentation: this file decides how a farm reads down a column, and nothing
 * else.
 *
 *   pnpm farm:ls               newest first
 *   pnpm farm:ls --all         past the default 200
 */

import { farmSyncState } from '../billing/access.ts';
import { readEnv } from '../env.ts';
import { listFarmSummaries } from './farms.ts';

const all = process.argv.includes('--all');

/**
 * The server's own environment, because the sync column is wrong without it.
 *
 * This listing used to read `syncGranted` and the subscription and stop there,
 * so a farm comped through `FREE_SYNC_ORGS` — testers, and whoever runs the
 * box — showed as `unsubscribed` while syncing perfectly. Refusing to start
 * without a readable environment is the right failure: a sync column computed
 * from half the inputs is a confident wrong answer, and this command exists to
 * be believed.
 */
const env = readEnv(process.env);

const farms = await listFarmSummaries(all ? 10_000 : 200);

if (farms.length === 0) {
  console.log('\n  No farms on this server yet.\n');
  process.exit(0);
}

const now = Date.now();

/** Fixed-width so a column of farms reads down rather than across. */
function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width - 1) + '…' : text.padEnd(width);
}

function when(at: Date | undefined): string {
  if (at === undefined) return 'never';
  const days = Math.floor((now - at.getTime()) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * What this farm is running, in the width of a column.
 *
 * One build is the ordinary case and reads as itself. Several means the farm is
 * mid-update, which is worth seeing — so the newest is named and the rest are
 * counted rather than truncated into a list nobody can parse at a glance.
 */
function builds(farm: (typeof farms)[number]): string {
  const [newest, ...rest] = farm.builds;
  if (newest === undefined) return '—';
  return rest.length === 0 ? newest.version : `${newest.version} +${rest.length}`;
}

console.log(
  `\n  ${pad('FARM', 22)}${pad('ID', 28)}${pad('WHO', 5)}${pad('RECORDS', 9)}` +
    `${pad('SYNC', 14)}${pad('BUILD', 12)}LAST WRITE`,
);
console.log(`  ${'─'.repeat(100)}`);

for (const farm of farms) {
  console.log(
    `  ${pad(farm.org.name, 22)}${pad(farm.org._id, 28)}${pad(String(farm.people), 5)}` +
      `${pad(String(farm.records), 9)}${pad(farmSyncState(env, farm.org), 14)}` +
      `${pad(builds(farm), 12)}${when(farm.lastWriteAt)}`,
  );
}

console.log(`\n  ${farms.length} farm${farms.length === 1 ? '' : 's'}.`);
console.log('  pnpm farm:show <id>   for one of them in detail\n');

process.exit(0);

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
 *   pnpm farm:ls               newest first
 *   pnpm farm:ls --all         past the default 200
 */

import { entitlementOf } from '@steading/contracts';
import { db } from './client.ts';
import { listOrgs, listUsersInOrg } from './identity.ts';

const all = process.argv.includes('--all');

const farms = await listOrgs(all ? 10_000 : 200);

if (farms.length === 0) {
  console.log('\n  No farms on this server yet.\n');
  process.exit(0);
}

const database = await db();
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

console.log(`\n  ${pad('FARM', 24)}${pad('ID', 28)}${pad('WHO', 5)}${pad('RECORDS', 9)}${pad('SYNC', 12)}LAST WRITE`);
console.log(`  ${'─'.repeat(88)}`);

for (const farm of farms) {
  const [people, records, latest] = await Promise.all([
    listUsersInOrg(farm._id),
    database.collection('mutations').countDocuments({ orgId: farm._id }),
    database
      .collection<{ serverTs?: Date }>('mutations')
      .find({ orgId: farm._id })
      .sort({ serverTs: -1 })
      .limit(1)
      .toArray(),
  ]);

  /**
   * What this farm's sync state actually is, in the order the server decides
   * it — a grant short-circuits the subscription, so showing the subscription
   * would be showing something that is not being consulted.
   */
  const state =
    farm.syncGranted !== undefined
      ? 'granted'
      : (entitlementOf(farm.subscription, now).refusal ?? 'paid');

  console.log(
    `  ${pad(farm.name, 24)}${pad(farm._id, 28)}${pad(String(people.length), 5)}` +
      `${pad(String(records), 9)}${pad(state, 12)}${when(latest[0]?.serverTs)}`,
  );
}

console.log(`\n  ${farms.length} farm${farms.length === 1 ? '' : 's'}.`);
console.log('  pnpm farm:show <id>   for one of them in detail\n');

process.exit(0);

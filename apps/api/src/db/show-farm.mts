/**
 * `pnpm farm:show <farmId>` — one farm, in enough detail to answer a message.
 *
 * The tool for *"farm X says sync is broken"*. Everything here is a fact the
 * server holds; nothing is inferred, and nothing asks the farm.
 *
 * **Read-only, and safe against the live database.**
 *
 * ## What it deliberately does NOT show
 *
 * Any record's contents. A farm's records are the farm's — §5 of
 * `ACCESS-AND-BILLING.md` is written about exactly this, and the support loop
 * takes a farm's data only when it is asked for and agreed to (S2). Counts and
 * timings answer an operational question; reading somebody's egg tallies over
 * their shoulder does not.
 *
 *   pnpm farm:show 01J0000000000000000000ORG1
 */

import { entitlementOf } from '@steading/contracts';
import { db } from './client.ts';
import { findOrgById, listUsersInOrg } from './identity.ts';
import { COLLECTIONS } from './scoped.ts';

const farmId = process.argv[2];

if (farmId === undefined || farmId.startsWith('--')) {
  console.error('\n  Usage: pnpm farm:show <farmId>\n  Find the id with: pnpm farm:ls\n');
  process.exit(1);
}

const farm = await findOrgById(farmId);

if (farm === null) {
  // Named plainly rather than as "not found", because the likeliest cause is a
  // truncated copy-paste from the list rather than a farm that is absent.
  console.error(`\n  No farm with the id ${farmId}.\n  Check it against: pnpm farm:ls\n`);
  process.exit(1);
}

const database = await db();
const now = Date.now();
const entitlement = entitlementOf(farm.subscription, now);

console.log(`\n  ${farm.name}`);
console.log(`  ${farm._id}`);
console.log(`  Made ${farm.createdAt.toISOString().slice(0, 10)}\n`);

// ── Who is on it ─────────────────────────────────────────────────────────────
const people = await listUsersInOrg(farmId);
console.log('  WHO');
for (const person of people) {
  const how = person.googleSub === undefined ? 'password' : 'google';
  const off = person.disabledAt === undefined ? '' : '  DISABLED';
  console.log(`    ${person.role.padEnd(6)} ${person.email.padEnd(32)} ${how}${off}`);
}
if (people.length === 0) console.log('    nobody — a device minted this farm and never signed up');

// ── Whether the server is taking its work ────────────────────────────────────
console.log('\n  SYNC');
if (farm.syncGranted !== undefined) {
  const note = farm.syncGranted.note === undefined ? '' : ` (${farm.syncGranted.note})`;
  console.log(`    granted ${farm.syncGranted.at.toISOString().slice(0, 10)}${note}`);
  console.log('    revoke with: pnpm farm:grant ' + farmId + ' --revoke');
} else if (farm.subscription === undefined) {
  console.log('    no subscription — free tier, which is the ordinary state (D13)');
} else {
  console.log(`    ${farm.subscription.state}, ${entitlement.syncing ? 'syncing' : 'held'}`);
  if (farm.subscription.expiresAt !== undefined) {
    console.log(`    paid to ${new Date(farm.subscription.expiresAt).toISOString().slice(0, 10)}`);
  }
  if (farm.subscription.source !== undefined) console.log(`    via ${farm.subscription.source}`);
}

// ── What it has sent ─────────────────────────────────────────────────────────
const mutations = database.collection<{ serverTs?: Date; entity?: string }>('mutations');
const [total, newest, oldest] = await Promise.all([
  mutations.countDocuments({ orgId: farmId }),
  mutations.find({ orgId: farmId }).sort({ serverTs: -1 }).limit(1).toArray(),
  mutations.find({ orgId: farmId }).sort({ serverTs: 1 }).limit(1).toArray(),
]);

console.log('\n  WHAT IT HAS SENT');
console.log(`    ${total} mutation${total === 1 ? '' : 's'}`);
if (newest[0]?.serverTs !== undefined) {
  const idleDays = Math.floor((now - newest[0].serverTs.getTime()) / 86_400_000);
  console.log(`    first ${oldest[0]?.serverTs?.toISOString().slice(0, 10) ?? '—'}`);
  console.log(`    last  ${newest[0].serverTs.toISOString().slice(0, 10)} (${idleDays}d ago)`);
  /**
   * The number that usually answers the question.
   *
   * A farm reporting "sync is broken" and last writing three weeks ago is a
   * device that stopped flushing; one that wrote an hour ago is a farm looking
   * at a screen that has not refreshed. Those get very different replies, and
   * this is the line that tells them apart.
   */
} else {
  console.log('    nothing has ever reached the server from this farm');
}

// ── Where the records are ────────────────────────────────────────────────────
const counts: [string, number][] = [];
for (const name of COLLECTIONS) {
  if (name === 'mutations') continue;
  const live = await database.collection(name).countDocuments({ orgId: farmId });
  if (live > 0) counts.push([name, live]);
}

if (counts.length > 0) {
  console.log('\n  RECORDS');
  for (const [name, count] of counts.sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(6)}  ${name}`);
  }
}

console.log('\n  Contents are not shown. Counts answer an operational question;');
console.log("  reading a farm's records over their shoulder does not.\n");

process.exit(0);

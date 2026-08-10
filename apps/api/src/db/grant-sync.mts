/**
 * `pnpm farm:grant <farmId>` — sync given away, and taken back.
 *
 * The comp. For testers, for the people who build this, and for anyone who
 * should not be charged.
 *
 * ## Why this exists next to FREE_SYNC_ORGS rather than instead of it
 *
 * The environment variable works and is read once at startup, so changing it
 * means editing a file and restarting the service. That is fine when the farm
 * is your own and actively bad the first time somebody messages you on a
 * Sunday. This writes the same decision to the farm's own document, where it
 * takes effect on the next request.
 *
 * The env list stays, and still wins. An operator who cannot reach the
 * database — or who wants a grant that survives a restore from backup — can
 * still name a farm there.
 *
 * ## Still not requestable, which is the property that mattered
 *
 * The masterplan's argument is against a *route*: "a grant that can be
 * requested is a grant that can be requested by anybody." Nothing on the wire
 * reaches this. It needs a shell on the server, exactly like `promo:new`, and
 * that is the whole authority model.
 *
 *   pnpm farm:grant 01J…ORG1                       sync, indefinitely
 *   pnpm farm:grant 01J…ORG1 --note "beta tester"  and a word to remember why
 *   pnpm farm:grant 01J…ORG1 --revoke              take it back
 */

import { findOrgById, setSyncGrant } from './identity.ts';

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const farmId = process.argv[2];
const revoke = process.argv.includes('--revoke');
const note = flag('note');

if (farmId === undefined || farmId.startsWith('--')) {
  console.error(`
  Usage: pnpm farm:grant <farmId> [--note "why"] [--revoke]

  Find the id with: pnpm farm:ls
`);
  process.exit(1);
}

/**
 * Named before it is changed, and this is not politeness.
 *
 * A farm id is 26 characters of Crockford base32 pasted from a terminal, and
 * the failure mode of getting one wrong is silent: the grant lands on somebody
 * else's farm and neither farm ever finds out. Printing the name is what makes
 * a mis-paste visible at the moment it happens.
 */
const farm = await findOrgById(farmId);

if (farm === null) {
  console.error(`\n  No farm with the id ${farmId}.\n  Check it against: pnpm farm:ls\n`);
  process.exit(1);
}

if (revoke) {
  if (farm.syncGranted === undefined) {
    console.log(`\n  "${farm.name}" was not granted sync. Nothing to take back.\n`);
    process.exit(0);
  }

  await setSyncGrant(farmId, null);
  console.log(`
  Taken back from "${farm.name}".

  If this farm has no subscription it will now be held on its next flush, and
  the app will say so plainly — "Kept on this phone" — rather than failing.
  Nothing on any device is lost; nothing is deleted anywhere.
`);
  process.exit(0);
}

await setSyncGrant(farmId, { at: new Date(), ...(note === undefined ? {} : { note }) });

console.log(`
  Granted to "${farm.name}".

  Sync, indefinitely, whatever the store says${note === undefined ? '' : ` — ${note}`}.
  It takes effect on the next request; nothing needs restarting.

  Take it back with: pnpm farm:grant ${farmId} --revoke
`);

process.exit(0);

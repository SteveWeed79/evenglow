import { isUlid, newId } from '@steading/contracts';
import { clearLocalOrg, readLocalOrgRaw, writeLocalOrg } from './store';

/**
 * The farm's id before there is an account (A2.1).
 *
 * First launch mints an org ULID on the device and opens `steading-{that}.db`.
 * Everything works from that moment — tallies, dues, weather, photos, the
 * whole app — and nothing flushes, because there is no token and none is
 * needed. This is D1 applied one level out: the client already mints every
 * entity id, and an org is the outermost case of the same argument.
 *
 * The bytes live in secure storage (`store.ts`, the only file permitted to
 * name it) for a reason that is not secrecy — this value goes over the wire at
 * signup. Invariant 6 permits exactly two stores on a device, and this one is
 * the key to which file in the other one to open.
 *
 * That leaves one honest consequence worth stating: on Android, secure storage
 * is cleared when the app's data is cleared, and an unclaimed farm's id goes
 * with it. The records are still in the database file, but nothing knows which
 * file they are in. **That is what an account is for**, and it is exactly the
 * third moment in A2.3 — recovery is the thing being sold, not "sign up".
 *
 * ## Why it is not simply the claims cache
 *
 * `readCachedClaims` carries an orgId too, and reusing it would have been
 * fewer files. But those claims are the shape a *signed-in* device holds, and
 * a half-filled one — an orgId with no userId and no role — would be a
 * different thing wearing the same type. Every reader of `CachedClaims` would
 * then have to know which kind it was holding. A separate key says what it is.
 */

/**
 * Read and parsed, never trusted (invariant 11).
 *
 * A value that is not a ULID cannot name a database this app made. Treated as
 * absent rather than repaired: minting a fresh one is recoverable, and opening
 * a file named after a corrupted string is not.
 */
export async function readLocalOrgId(): Promise<string | null> {
  const stored = await readLocalOrgRaw();
  return stored !== null && isUlid(stored) ? stored : null;
}

/**
 * Written once and never rewritten, which is the invariant that matters.
 *
 * A second mint would orphan a database full of records — the file is named
 * for this value — so the write only ever happens when the read came back
 * empty.
 */
export async function ensureLocalOrgId(): Promise<string> {
  const existing = await readLocalOrgId();
  if (existing !== null) return existing;

  const minted = newId();
  await writeLocalOrg(minted);
  return minted;
}

/**
 * Forgets the unclaimed id, so the next launch mints a new farm.
 *
 * Called when a device signs in to an org it did **not** mint — a hand joining
 * their employer's farm. That device's local records belong to a farm that no
 * longer has anywhere to go, and keeping the id would mean the next sign-out
 * silently reopened a database full of somebody else's practice records.
 *
 * Deliberately NOT called after a successful claim: a claimed org keeps its
 * id, because the id is the whole point of adoption. Signing out of a claimed
 * farm and back in opens the same file it always did.
 */
export async function forgetLocalOrgId(): Promise<void> {
  await clearLocalOrg();
}

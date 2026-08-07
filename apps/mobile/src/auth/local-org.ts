import { isUlid, newId } from '@steading/contracts';
import { knownFarmIds } from '../db/open';
import {
  clearLocalOrg,
  readLocalOrgRaw,
  readRetiredOrgsRaw,
  writeLocalOrg,
  writeRetiredOrgs,
} from './store';

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
 * empty. When it *is* empty, everything below is an attempt to find the farm
 * that was already here before accepting that there isn't one.
 */
export async function ensureLocalOrgId(): Promise<string> {
  const existing = await readLocalOrgId();
  if (existing !== null) return existing;

  const known = await knownFarmIds();

  /**
   * The way back from a join.
   *
   * Signing in to somebody else's farm moves this device's own id aside
   * (`retireLocalOrgId`), because leaving it in place would mean the next
   * sign-out reopening a farm this device no longer belongs to. Signing out
   * again is the moment that reverses: there is no employer's farm to be on,
   * and the farm this device minted is the right one to come back to.
   *
   * **Not a guess, which is what separates it from the adoption below.** The
   * retired list is a record of something this device did, newest first, so
   * the answer is known rather than inferred — and the disk check keeps it
   * honest, because an id whose database is gone names nothing.
   *
   * Adopting rewrites the pointer and drops the id from the list. A value that
   * stayed retired while being returned would come back through here on every
   * call, and the pointer that is supposed to be written once would never be
   * written at all.
   */
  const retired = await retiredOrgIds();
  const returning = retired.find((id) => known.includes(id));

  if (returning !== undefined) {
    await writeLocalOrg(returning);
    await writeRetiredOrgs(retired.filter((id) => id !== returning));
    return returning;
  }

  /**
   * Nothing said which farm this is — but there may be one on disk.
   *
   * This is the silent loss, and it is the one worth guarding. Secure storage
   * returns null rather than throwing when it cannot read a value, so a
   * cleared keystore, a restored backup or a reinstall that kept the files
   * looks exactly like a first launch: a fresh id is minted, a new empty
   * database opens, and a farm's records sit in the file next to it with
   * nothing pointing at them. No error, no warning, nothing on any screen.
   *
   * **Adopting is right and guessing is not.** Exactly one database means
   * exactly one farm, and reopening it is the only answer that can be correct.
   * More than one means two farms have been on this device and picking either
   * would be the app deciding which somebody meant — so it mints, and the
   * records stay where they are rather than being merged into a guess.
   */
  const only = known.length === 1 ? known[0] : undefined;

  if (only !== undefined) {
    await writeLocalOrg(only);
    return only;
  }

  const minted = newId();
  await writeLocalOrg(minted);
  return minted;
}

/**
 * Every farm this device minted and then moved away from, newest first.
 *
 * Parsed and filtered rather than trusted (invariant 11): a value that is not
 * an array of ULIDs cannot name a database this app made, and treating it as
 * empty is recoverable where opening a file named after a corrupted string is
 * not.
 */
export async function retiredOrgIds(): Promise<string[]> {
  const stored = await readRetiredOrgsRaw();
  if (stored === null) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => isUlid(id)) : [];
  } catch {
    return [];
  }
}

/**
 * Moves the unclaimed id aside, rather than deleting it.
 *
 * Called when a device signs in to an org it did **not** mint — a hand joining
 * their employer's farm. The active pointer has to move: keeping it would mean
 * the next sign-out silently reopening a database that is no longer the farm
 * this device belongs to.
 *
 * **It used to delete the id, and that made the move permanent.** The file is
 * `steading-{orgId}.db` and the id is the only thing that names it, so a join
 * stranded every record behind it for good — no error, nothing on any screen,
 * and no way back on the morning somebody went looking for last week's
 * tallies. The records were never gone; the only copy of their address was.
 *
 * Retiring costs one string and changes nothing about which farm is open. What
 * it buys is the way back: `ensureLocalOrgId` reads this list the next time
 * there is no signed-in farm, which is to say on the first launch after a
 * sign-out.
 *
 * Deliberately NOT called after a successful claim: a claimed org keeps its
 * id, because the id is the whole point of adoption.
 */
export async function retireLocalOrgId(): Promise<void> {
  const current = await readLocalOrgId();
  await clearLocalOrg();

  if (current === null) return;

  // Newest first, and deduplicated — rejoining the same farm twice must not
  // put the same id in the list twice.
  const rest = (await retiredOrgIds()).filter((id) => id !== current);
  await writeRetiredOrgs([current, ...rest]);
}

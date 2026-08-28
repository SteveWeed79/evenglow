import type { Collection } from 'mongodb';
import { parseVersion, type Role, type Subscription } from '@homefarm/contracts';
import { db } from './client';

/**
 * Identity collections are deliberately NOT tenant-scoped: sign-in has to find
 * a user before an orgId exists, so scoped() cannot serve this path.
 *
 * Because the generic guard does not apply here, this module exposes narrow
 * purpose-built functions instead of collection handles. It lives inside
 * server/db/ so the lint guard's exemption covers it, and there is no
 * general-purpose query in it by design.
 */

export interface UserDoc {
  _id: string; // ULID
  email: string; // lowercased, unique
  /**
   * Absent on an account that only ever signs in with Google (A2.4).
   *
   * Optional rather than a placeholder hash, because a placeholder is a
   * password-shaped thing somebody could eventually match. `authorizeCredentials`
   * refuses an account without one — a Google-only account cannot be entered
   * with a password, which is the whole point of not having set one.
   */
  passwordHash?: string;
  /**
   * Google's stable subject id, set the first time somebody signs in with it.
   *
   * The identity, where the email is only the label: Google's `sub` survives
   * somebody changing the address on their account, and an email does not.
   * Matching on email alone would mean an account silently changing hands the
   * day an address is recycled.
   */
  googleSub?: string;
  name: string;
  orgId: string;
  role: Role;
  createdAt: Date;
  /**
   * When this account was made an operator of **this server**, if ever.
   *
   * ## Not a role, and the first version of the board made it one
   *
   * `requireAdmin` checked `role === 'admin'` — and `admin` is a **farm** role,
   * the manager a farm's owner appoints. `assignableRoles('owner')` returns all
   * three roles and `assignableRoles('admin')` returns `['admin', 'hand']`, so
   * any farm owner could mint one and any admin could mint another. That
   * account would then have read every farm on the server, granted free sync,
   * and minted subscription codes — cross-tenant escalation reachable from an
   * ordinary Members screen, on the one surface `scoped()` deliberately does not
   * protect.
   *
   * The two ideas were never the same and sharing a word made them look it. A
   * farm's admin manages a farm. An operator runs the box. Somebody can be both,
   * either, or — most usually — an operator who is a plain `hand` on their own
   * farm, and the two facts have nothing to say about each other.
   *
   * ## Nothing on the wire can write it
   *
   * Not in any payload schema, not in `roleSchema`, not in the access token, not
   * settable by `/members/:id/role`. `pnpm ops:admin` is the only thing that
   * sets it, which needs a shell on the server — the same authority model
   * `farm:grant` and `promo:new` already have, and the one the masterplan asks
   * for: *"a grant that can be requested is a grant that can be requested by
   * anybody."*
   *
   * A date rather than a boolean, so an operator list answers *when* as well as
   * *who* — the same shape `syncGranted` uses one collection over.
   */
  operatorSince?: Date;
  /**
   * When this address was proved readable by whoever owns the account.
   *
   * Absent means unproved, which is the state every password signup starts in
   * and the state every account created before this shipped is in. **Absent is
   * not a defect and is not repaired by a backfill** — dating it from the row's
   * creation would be this field asserting something nobody ever demonstrated,
   * which is the one thing it exists to stop.
   *
   * Set by `/auth/verify` when a code minted to the address is spent at it, and
   * set outright on the Google paths: `verifyGoogleIdToken` refuses a token
   * without `email_verified`, so Google has already done exactly this work and
   * asking the farmer to do it again would be theatre.
   *
   * **What reads it is `/auth/forgot`**, which sends nothing to an unproved
   * address. See `verification.ts` for why that is worth the recovery it costs.
   */
  emailVerifiedAt?: Date;
  disabledAt?: Date;
  /**
   * The address and the Google subject this account had before it was removed.
   *
   * Kept because the row is kept: a farm's records name who typed them, and
   * "who was that?" is a question somebody asks about a person who left. Moved
   * out of `email` and `googleSub` so they no longer identify a live account —
   * see `disableUser` for why removal has to release them.
   */
  formerEmail?: string;
  formerGoogleSub?: string;
  /**
   * The build this account last talked to the server with, and when.
   *
   * **The only evidence there is about what is actually installed.** Sideloaded
   * installs have no updater and no telemetry, so "which builds are in the
   * field" was a question nothing on this server could answer — the version
   * header arrived on every sync, decided the 426, and was discarded. Setting
   * `MINIMUM_CLIENT_VERSION` without knowing what it would lock out is a guess,
   * and this is what turns it into a reading.
   *
   * **Per account rather than per device**, because that is what the wire
   * actually carries: the token names an account, and nothing identifies a
   * handset outside a mutation envelope — `/snapshot` has no body at all. A
   * person with two phones on different builds shows as whichever synced last,
   * which is a real limit and stated here rather than discovered from a
   * confusing panel.
   *
   * `client` is absent when the build sent no version, or sent one that is not
   * `major.minor.patch`. See `recordLastSeen` for why that is a parse and not a
   * store.
   */
  lastSeen?: { at: Date; client?: string };
}

export interface OrgDoc {
  _id: string; // ULID
  name: string;
  createdAt: Date;
  /**
   * What the farm has paid for, if anything (D13).
   *
   * Absent on every farm that has never subscribed, which is the ordinary
   * free-tier state and not a problem — `entitlementOf` reads an absent
   * subscription as `unsubscribed` rather than as a fault.
   */
  subscription?: Subscription;
  /**
   * The Play purchase token this farm's subscription came from.
   *
   * **Server-side only and deliberately not part of `Subscription`.** That
   * shape is shared with the client through the contracts package; this is
   * storage. Keeping it out means there is no route that could accidentally
   * serialise it into a response.
   *
   * Stored rather than hashed, because it is not a credential to be checked —
   * it is the handle this server presents to Google when asking what the
   * purchase is worth now, and a hash cannot be presented.
   */
  playPurchaseToken?: string;
  /**
   * Sync given away, by whoever runs this server (D13).
   *
   * The database half of `FREE_SYNC_ORGS`, and the reason it exists: the
   * environment variable works and requires a restart to change, so comping a
   * tester means editing a file and bouncing the service. That is fine when
   * the farm is your own and actively bad the first time somebody messages you
   * on a Sunday.
   *
   * **Still not requestable, which is the property that mattered.** The
   * masterplan's argument is against a *route* — "a grant that can be
   * requested is a grant that can be requested by anybody" — and nothing on
   * the wire reaches this field. It is written by `pnpm farm:grant`, which
   * needs a shell on the server, exactly like minting a promotion code does.
   *
   * The env list stays and still wins: a farm named there is granted whether
   * or not this field is set, so an operator locked out of the database can
   * still let somebody through.
   */
  syncGranted?: { at: Date; note?: string };
}

async function users(): Promise<Collection<UserDoc>> {
  return (await db()).collection<UserDoc>('users');
}

async function orgs(): Promise<Collection<OrgDoc>> {
  return (await db()).collection<OrgDoc>('orgs');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  return (await users()).findOne({ email: normalizeEmail(email) });
}

export async function findUserById(id: string): Promise<UserDoc | null> {
  return (await users()).findOne({ _id: id });
}

/** By Google's stable subject id, which outlives a change of address. */
export async function findUserByGoogleSub(googleSub: string): Promise<UserDoc | null> {
  return (await users()).findOne({ googleSub });
}

/**
 * Binds a Google identity to an account that already exists, and only to one
 * whose address has been proved and which no Google identity holds yet.
 *
 * The upgrade path for a farm that signed up with a password and later taps
 * the Google button with the same address: the account is theirs either way,
 * and the alternative is telling them their own email is taken.
 *
 * ## Both conditions are in the filter, and that is the point
 *
 * A verified ID token proves that *the caller* controls the address. It proves
 * nothing about the stored row, and this used to be an unconditional `$set`:
 *
 *   - **`emailVerifiedAt: { $exists: true }`.** `/auth/signup` sends no mail
 *     and sets no flag, so an address typed into it is unproved — see
 *     `emailVerifiedAt` above, and `verification.ts`. Without this, signing up
 *     as somebody else's address and waiting handed their Google sign-in to
 *     the farm that typed it first: they land inside that org, as that user,
 *     with everything they log syncing there. `/auth/forgot` already refuses
 *     to act on an unproved address for exactly this reason.
 *   - **`googleSub: { $exists: false }`.** The caller reaches the linking
 *     branch only when no account matched this `sub`, so a `googleSub` that is
 *     already set is necessarily a *different* Google account — and rebinding
 *     one address to a new Google identity is the outcome `googleSub` exists
 *     to prevent. It also settles the race: two first-time sign-ins for one
 *     address, arriving together with different subjects, and exactly one of
 *     them matches.
 *
 * In the filter rather than merely checked by the caller, for the reason
 * `changeUnverifiedEmail` gives: the route checks these too, and that is the
 * check a refactor can walk past. This is the one that cannot.
 *
 * False means nothing matched — no such account, or its address is unproved,
 * or another Google identity already holds it. The caller cannot tell which,
 * and must not: the answer would say whether an address has an account.
 */
export async function linkGoogleSub(userId: string, googleSub: string): Promise<boolean> {
  const result = await (await users()).updateOne(
    { _id: userId, emailVerifiedAt: { $exists: true }, googleSub: { $exists: false } },
    { $set: { googleSub } },
  );
  return result.matchedCount === 1;
}

/**
 * The same binding, asked for by somebody who is already signed in.
 *
 * **`emailVerifiedAt` is deliberately absent from this filter, and that is the
 * entire difference.** The condition above exists because `/auth/google` is
 * unauthenticated and had nothing but an address to go on — and an address in
 * `users` is a claim, not a fact, so linking on it handed whoever typed it
 * first the sign-in of whoever actually owns it. A caller here has presented
 * the account's own session *and* its password. That is the proof the address
 * was standing in for, and a better one: it is about the account rather than
 * about an inbox.
 *
 * So a farm that signed up with a password and never confirmed its email can
 * connect Google without confirming it first, which is the step the H1 fix
 * otherwise makes unavoidable and the reason this function exists.
 *
 * **The other two conditions stay, and one is new.** `googleSub: { $exists:
 * false }` still refuses to rebind an account that already carries a Google
 * identity — the outcome `googleSub` exists to prevent — and it settles the
 * race between two link requests arriving together. `disabledAt` joins them
 * because a removal landing between `requireMutationClaims` and this write
 * would otherwise bind an identity to somebody who is no longer on the farm;
 * the route checks it too, and this is the check a refactor cannot walk past.
 *
 * **The Google subject's uniqueness is not this filter's job.** It is the
 * partial unique index on `googleSub`, and the caller reads a duplicate key as
 * "somebody else holds that Google account" — see `isDuplicateKey`, and
 * `/auth/email` for why a route keeps both the read and the index rather than
 * resting on either.
 *
 * False means nothing matched, and the caller cannot tell which of the three
 * it was. That is deliberate: guessing would mean telling somebody removed from
 * a farm mid-request that their account is connected to a Google account they
 * have never seen.
 */
export async function linkGoogleSubInSession(
  userId: string,
  googleSub: string,
): Promise<boolean> {
  const result = await (await users()).updateOne(
    { _id: userId, disabledAt: { $exists: false }, googleSub: { $exists: false } },
    { $set: { googleSub } },
  );
  return result.matchedCount === 1;
}

export async function insertUser(user: UserDoc): Promise<void> {
  await (await users()).insertOne({ ...user, email: normalizeEmail(user.email) });
}

/**
 * Whether a write failed because a unique index already held the value.
 *
 * Here rather than in a route because the number is the driver's, and a route
 * testing `error.code === 11000` would be a route that knows which database
 * this is. On `users` the only unique index that a caller can collide with is
 * the email — `_id` is a freshly minted ULID — so this is a taken address in
 * every practical case, and the routes say so.
 *
 * The distinction is worth drawing at all because the alternative is telling
 * somebody their email is taken when in fact Mongo was briefly unavailable.
 * That sends them to a sign-in screen for an account that does not exist.
 */
export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Replaces a password hash, by email.
 *
 * There is no reset flow in the product yet — D7 is single-farm-first and the
 * first account is made by `pnpm db:seed` — so this exists for the one case
 * that is otherwise unrecoverable: a development account whose password was
 * stored as something other than what its owner typed. It takes a hash, never
 * a plaintext, so hashing parameters stay in one place.
 */
export async function setPasswordHash(email: string, passwordHash: string): Promise<boolean> {
  const result = await (await users()).updateOne(
    { email: normalizeEmail(email) },
    { $set: { passwordHash } },
  );
  return result.matchedCount === 1;
}

/**
 * Records that this account's address has been proved.
 *
 * Takes the address it was proved *for* and puts it in the filter, so a write
 * that lost a race against a change of address lands on nothing rather than
 * marking the new string verified on the strength of the old one's code.
 * `claimVerifyCode` already binds the code to an address; this is the second
 * half of the same guard, at the moment the flag is actually written.
 */
export async function markEmailVerified(
  userId: string,
  email: string,
  at: Date,
): Promise<boolean> {
  const result = await (await users()).updateOne(
    { _id: userId, email: normalizeEmail(email) },
    { $set: { emailVerifiedAt: at } },
  );
  return result.matchedCount === 1;
}

/**
 * Moves an account onto a different address, and only while the current one is
 * unproved.
 *
 * **`emailVerifiedAt` is in the filter, not merely checked by the caller.** The
 * route checks it too, and that check is the one a refactor can walk past; this
 * is the one that cannot. A verified address is a different object — moving it
 * needs the old address to confirm the move or it is an account-takeover
 * primitive handed to whoever holds a session — and that flow is not built.
 *
 * The new address is left unproved, which is the whole point: a correction
 * buys the chance to prove the new string, never the belief that it is right.
 *
 * False means nothing matched: no such account, or its address is already
 * verified. A duplicate key from the unique index means somebody else has the
 * address, and it is left to the caller to read — `isDuplicateKey` is how.
 */
export async function changeUnverifiedEmail(userId: string, email: string): Promise<boolean> {
  const result = await (await users()).updateOne(
    { _id: userId, emailVerifiedAt: { $exists: false } },
    { $set: { email: normalizeEmail(email) } },
  );
  return result.matchedCount === 1;
}

/**
 * Makes somebody an operator of this server, or stops them being one.
 *
 * By **email**, because that is what an operator holds — a user id is a ULID
 * nobody has written down, and `pnpm ops:admin` is typed by a person reading a
 * message from the person asking. `null` takes it back.
 *
 * Returns false when no account has that address, so the caller can say so
 * rather than reporting a grant that landed nowhere. A disabled account is
 * deliberately still matchable: `disableUser` moves the address to
 * `formerEmail`, so a removed person cannot be found here at all, and the board
 * refuses a disabled account on every request regardless.
 */
export async function setOperator(email: string, at: Date | null): Promise<boolean> {
  const result = await (await users()).updateOne(
    { email: normalizeEmail(email) },
    at === null ? { $unset: { operatorSince: '' } } : { $set: { operatorSince: at } },
  );
  return result.matchedCount === 1;
}

/**
 * Everyone who can open the operations board.
 *
 * For the script that grants it, so an operator can see the whole list before
 * and after — the question "who else has this" has no other answer, and a
 * grant nobody can audit is one nobody can revoke with confidence.
 */
export async function listOperators(): Promise<UserDoc[]> {
  return (await users())
    .find({ operatorSince: { $exists: true } })
    .sort({ operatorSince: 1 })
    .toArray();
}

export async function findOrgById(id: string): Promise<OrgDoc | null> {
  return (await orgs()).findOne({ _id: id });
}

export async function insertOrg(org: OrgDoc): Promise<void> {
  await (await orgs()).insertOne(org);
}

/**
 * Renames a farm, and answers whether there was one to rename.
 *
 * Only the name. A `$set` of the whole document would carry whatever the caller
 * happened to be holding, and this collection also holds the subscription —
 * which is the one field on a farm that must never move because somebody
 * corrected a spelling.
 *
 * False means no such farm, which the route turns into a 404 rather than a
 * silent success. `matchedCount`, not `modifiedCount`: renaming a farm to the
 * name it already has modifies nothing and is not a failure.
 */
export async function renameOrg(id: string, name: string): Promise<boolean> {
  const result = await (await orgs()).updateOne({ _id: id }, { $set: { name } });
  return result.matchedCount > 0;
}

/**
 * Every farm on this server, newest first.
 *
 * For the operator commands only — there is no route that reaches it, and
 * there must not be: this is the one query in the codebase that deliberately
 * crosses tenants, which is why it lives here beside the other narrow,
 * purpose-built functions rather than behind a collection handle.
 */
export async function listOrgs(limit = 200): Promise<OrgDoc[]> {
  return (await orgs()).find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

/**
 * Every farm's id, and deliberately without a limit.
 *
 * `listOrgs` takes one and defaults to 200, which is right for a page somebody
 * reads and wrong for a job that has to cover the whole box — the sweeper ran
 * over `listOrgs()` and therefore skipped every farm past the two-hundredth,
 * newest-first, in silence.
 *
 * Ids only, which is what makes "no limit" a reasonable thing to offer: a
 * hundred thousand farms is 2.6 MB of ULIDs, and no server this is for has a
 * hundredth of that. Nothing here reads a farm's contents, so it stays beside
 * the other narrow cross-tenant functions rather than becoming a general query.
 */
export async function listOrgIds(): Promise<string[]> {
  const rows = await (await orgs())
    .find({}, { projection: { _id: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  return rows.map((org) => org._id);
}

/** Everyone on one farm, so `farm:show` can say who would be affected. */
export async function listUsersInOrg(orgId: string): Promise<UserDoc[]> {
  return (await users()).find({ orgId }).sort({ createdAt: 1 }).toArray();
}

/**
 * Notes what build an account is running, on a request that already proved who
 * it is.
 *
 * **The version is parsed, not stored as it arrived.** It is a header, which
 * makes it caller-controlled data reaching the database (invariant 11) — and
 * this one ends up rendered on an operations page, aggregated into counts, and
 * compared against a floor. `parseVersion` bounds it to three integers of at
 * most five digits each, so what lands is a version or nothing: no unbounded
 * string, no shape a reader has to be careful with, and no way to spread a
 * version histogram across a thousand invented values.
 *
 * An unreadable version still records the *visit*. That distinction carries
 * real information — a build that predates the header, or something
 * hand-rolled — and `at` without `client` says exactly that, where dropping the
 * write entirely would make the account look dormant.
 *
 * **Never fails a request.** This is telemetry hanging off the side of sync,
 * and a farm's morning must not end in a 500 because a bookkeeping write lost a
 * race. The caller decides nothing on the result, so there is nothing to
 * report.
 */
export async function recordLastSeen(
  userId: string,
  reportedVersion: string | undefined,
  at: Date,
): Promise<void> {
  const parsed = reportedVersion === undefined ? null : parseVersion(reportedVersion);
  const client =
    parsed === null ? {} : { client: `${parsed.major}.${parsed.minor}.${parsed.patch}` };

  try {
    await (await users()).updateOne({ _id: userId }, { $set: { lastSeen: { at, ...client } } });
  } catch {
    // Deliberately swallowed — see above.
  }
}

/** Gives sync away, or takes it back. Null revokes. */
export async function setSyncGrant(
  orgId: string,
  grant: { at: Date; note?: string } | null,
): Promise<boolean> {
  const result = await (await orgs()).updateOne(
    { _id: orgId },
    grant === null ? { $unset: { syncGranted: '' } } : { $set: { syncGranted: grant } },
  );
  return result.matchedCount === 1;
}

/**
 * Records what a rail told us about this farm's subscription.
 *
 * Replaces wholesale rather than merging fields: a store notification
 * describes the whole current state, and merging would let a stale field from
 * a previous notification survive underneath a fresh one — which is exactly
 * how a farm ends up entitled by a value nobody remembers writing.
 */
export async function setSubscription(
  orgId: string,
  subscription: Subscription,
  playPurchaseToken?: string,
): Promise<void> {
  await (await orgs()).updateOne(
    { _id: orgId },
    { $set: { subscription, ...(playPurchaseToken === undefined ? {} : { playPurchaseToken }) } },
  );
}

/**
 * Which farm a purchase belongs to.
 *
 * A store notification names the purchase, never the customer — so the token
 * has to be matched back to the farm that submitted it. A token nobody has
 * submitted belongs to a purchase this server has never seen, which is either
 * a forgery or a signup that never finished, and both are nothing to act on.
 */
export async function findOrgIdByPurchaseToken(purchaseToken: string): Promise<string | null> {
  const org = await (await orgs()).findOne({ playPurchaseToken: purchaseToken }, { projection: { _id: 1 } });
  return org?._id ?? null;
}

/**
 * Whether anybody at all belongs to this org.
 *
 * The claim path's crash guard (A2.2). Creating a farm is two inserts — the
 * org, then its owner — and there is no transaction to wrap them in: tests run
 * against a standalone mongod, and requiring a replica set to create an
 * account would make the setup harder than the feature.
 *
 * So the second insert failing, or the process dying between them, leaves an
 * org with no users. That org is **unclaimed by definition**: no user means no
 * token can ever carry its id, which means no request can ever reach inside
 * it. Letting the same device finish the job it started is strictly better
 * than telling a farm its own id is taken and stranding every record on the
 * handset behind an id it can never claim.
 *
 * `findOne` rather than `countDocuments`: the question is existence, and a
 * count of a large org is work nobody asked for.
 */
export async function orgHasMembers(orgId: string): Promise<boolean> {
  return (await (await users()).findOne({ orgId }, { projection: { _id: 1 } })) !== null;
}

/**
 * Removes an org that was created seconds ago and could not be given an owner.
 *
 * Best-effort tidying, not a correctness mechanism — `orgHasMembers` is what
 * makes the half-created state recoverable. This just keeps the common failure
 * (an email already in use) from leaving a row behind at all.
 */
export async function deleteOrgIfEmpty(orgId: string): Promise<void> {
  if (await orgHasMembers(orgId)) return;
  await (await orgs()).deleteOne({ _id: orgId });
}

// ── membership ───────────────────────────────────────────────────────────────

/**
 * The org-scoped user reads.
 *
 * Every one takes orgId and puts it in the filter, and none of them takes a
 * filter from a caller. That is weaker than `scoped()`, which makes forgetting
 * structurally impossible — but this collection cannot be scoped, because
 * sign-in has to find a user before an orgId exists. `tests/isolation` covers
 * what the mechanism cannot.
 */

/** Members of one farm, newest first. Password hashes never leave this module. */
export async function listMembers(orgId: string): Promise<Omit<UserDoc, 'passwordHash'>[]> {
  return (await users())
    .find({ orgId }, { projection: { passwordHash: 0 } })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray() as Promise<Omit<UserDoc, 'passwordHash'>[]>;
}

/**
 * How many active owners a farm has.
 *
 * Disabled owners are not counted, deliberately: a farm whose only owner has
 * been disabled has no one who can act, so treating that account as the last
 * owner would let the state persist rather than surfacing it.
 */
export async function countOwners(orgId: string): Promise<number> {
  return (await users()).countDocuments({ orgId, role: 'owner', disabledAt: { $exists: false } });
}

/** Scoped by orgId, so a token from one farm cannot move a role on another. */
export async function setUserRole(orgId: string, userId: string, role: Role): Promise<boolean> {
  const result = await (await users()).updateOne({ _id: userId, orgId }, { $set: { role } });
  return result.matchedCount === 1;
}

/**
 * Removal is a disable, never a delete — and it gives the address back.
 *
 * Their records stay: a morning's egg logs do not stop being true because the
 * person who typed them left, and a delete would either orphan them or take
 * them with it. `requireMutationClaims` already refuses a disabled account on
 * every write, so access ends immediately.
 *
 * ## Why the email has to move
 *
 * **Reported from a farm: somebody who joined with a code and was then removed
 * could not create a farm of their own.** They could not do anything at all.
 * `email` is globally unique, so the disabled row went on owning the address;
 * sign-in refused it for being disabled, and signup refused it for existing —
 * with the one message that makes the trap airtight, *"that email already has a
 * Steading account, sign in with it instead"*, which is advice to do the thing
 * that also fails. One removal burned an address permanently.
 *
 * So removal releases it. The row keeps the name and the history; the address
 * stops pointing at an account nobody can enter.
 *
 * `removed:<userId>` rather than unsetting it. The unique index is not sparse,
 * so two removed people would both hold `null` and the second removal would
 * fail — and a colon cannot appear before the `@` in an address, so this token
 * can never collide with somebody's real one.
 *
 * **Google's subject id goes with it**, or the release is half a release: a
 * tester who signed up with Google would still be found by `findUserByGoogleSub`
 * and 401'd, having freed an address they never used.
 *
 * This is one-way, as removal already was — nothing in this service clears
 * `disabledAt`. Somebody who comes back comes back as a new account, which is
 * what "removed from the farm" means.
 */
export async function disableUser(orgId: string, userId: string, at: Date): Promise<boolean> {
  const found = await (await users()).findOne({ _id: userId, orgId, disabledAt: { $exists: false } });
  if (!found) return false;

  const result = await (await users()).updateOne(
    { _id: userId, orgId, disabledAt: { $exists: false } },
    {
      $set: {
        disabledAt: at,
        // `email` is required on the document, so it is always there to keep.
        // `googleSub` is not — an account that only ever used a password has
        // none, and writing `formerGoogleSub: undefined` would store a null.
        formerEmail: found.email,
        email: `removed:${userId}`,
        ...(found.googleSub === undefined ? {} : { formerGoogleSub: found.googleSub }),
      },
      $unset: { googleSub: '' },
    },
  );
  return result.matchedCount === 1;
}

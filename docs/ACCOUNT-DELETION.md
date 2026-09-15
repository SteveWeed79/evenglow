# Account deletion

**Decided and built, September 2026.** `UNCONSIDERED.md` `[4]` and `[5]`, which
`APPROVED-WORK.md` §3 carries as two separate items — the route, and what
deletion actually *means*. They are one piece of work, because a delete button
that has not answered the second question is a button nobody can write a privacy
policy about.

Google Play requires both halves for any app with account creation: deletion
from inside the app, **and** a web address that works with nothing installed.
The second is not a formality here — a farm whose phone is at the bottom of a
water trough is exactly the farm that needs it.

---

## The rule

> **The last owner takes the farm with them. Anybody else takes only
> themselves.**

Everything below follows from that one line, and it is in
`contracts/deletion.ts` so it is read by whoever finds the code first.

**A farm is its owner's.** A hand's account is membership of somebody else's
farm, so deleting it removes the person and leaves the records — the same rule
removal already follows, and for the reason `identity.ts` gives about removal: *a
morning's egg logs do not stop being true because the person who typed them
left.* An owner with a co-owner is in the same position; the farm has somebody
left to own it.

**The last owner has nobody to leave it to.** An unowned farm is one nobody can
ever act on, export, or delete — a row on a disk with no route to it and no
person entitled to ask. So it goes, whole: every record, every photo's bytes, the
mutation log, and every other member's account on it.

That last clause is the sharp one, and it is why the screen asks the server how
many people it would take and puts the number in the sentence. *"Other members
may be affected"* is scrolled past. *"the 2 other accounts on it"* is weighed.

**The count is of people who lose something, which is not the same as rows.** A
member who was removed months ago has their row deleted too — the farm is gone,
so there is nothing left for it to be the history of — but `disableUser` already
ended their access and released their address, and says plainly that somebody who
comes back comes back as a new account. Counting them would tell an owner that
three other accounts go when one of them stopped being an account in March. The
preview and the answer count the same way, because they are one sentence said
before and after.

### Why not transfer the farm instead

Offering to hand the farm to somebody else before deleting is the obvious
alternative and it is a different feature: it needs a person to hand it *to*, who
has to agree, who may not exist. A farm with one owner and two hands has no
candidate the app can nominate — promoting a hand to owner on their way out of
the door is a decision the leaving owner has no standing to make for them.
Making somebody else an owner first is already possible on the Members screen,
and doing that turns this into the ordinary case. The warning names the farm, so
somebody who wanted that is told before they confirm rather than after.

---

## The proof, and why a session is not one

Every deletion needs the account's **password**, or a **fresh Google ID token**
for the account's own subject. An account with both may use either. A valid
session is not enough on its own.

That is the same bar `/auth/email` sets for a change of address, for a sharper
version of the reason: an address can be moved back and a farm cannot. A refresh
token lifted from a device keystore must not be enough to destroy two years of
records.

The Google token is compared **by subject, never by address**. A valid token for
a different Google account whose address happens to match this one's is exactly
the substitution `googleSub` exists to refuse.

---

## Three doors, one deletion

| | |
|---|---|
| `POST /account/delete` with a bearer | the app, on a session plus a proof |
| `GET /account/delete` | the page, which needs no app and no account |
| `POST /account/delete` with no bearer | that page's form, on an email and password |

`db/deletion.ts` is what all three do; `routes/account.ts` is who may ask. The
shape of the request decides which door it is — the app always sends a bearer and
the page never has one — so neither can reach the other's branch by accident.

**The page enumerates nobody.** A wrong password and an address with no account
get one sentence, because it is reachable by anyone with the URL. That is the
same rule sign-in follows and the reason it follows it.

**The page has no Google button**, and says so: an account Google created is
deleted from inside the app. A sign-in sheet on a web page the farm reached from
a store listing is a phishing shape, and the account it would serve is one that
can always reach the in-app route.

---

## What deletion means — `[5]`, answered

**On the server: immediate and complete.** No soft-delete, no grace period, no
tombstone. The rows go.

A soft-delete is a farm that still exists while being told it does not, and it
puts the burden of remembering on every future query in the service. Invariant 7
— never delete a mutation row — is about a **device's outbox**, where the history
is the duplicate defence and the audit trail. The server's log is the same audit
trail and the replication feed, and it survives every other operation here
including a member's removal and a record's archive. It does not survive the farm
asking to be forgotten, because an audit trail of a farm that asked not to exist
is precisely the thing the request is about.

**In backups: until the copy rolls, and the policy must say so.** Nightly dumps
are encrypted to an `age` public key and uploaded to S3, and rotation is an S3
lifecycle rule on the prefix rather than logic in the script — a bucket setting
cannot silently stop working. A farm deleted today is in every dump taken before
today, and those expire on the bucket's schedule and not before.

> **The lifecycle rule is 30 days**, and that number is the one the privacy
> policy states. It is not yet set, because the bucket does not exist yet — see
> `ROADMAP.md` §7 and `PICK-UP-HERE.md`, where configuring backups is still open
> work. **Whoever creates that bucket sets this rule at the same time**, or the
> policy is describing something that is not true. It is a farmer's number to
> change; what it cannot be is unstated.

**A lapsed subscription is never a deletion.** Reading is deliberately ungated on
billing (`routes/sync.ts`): *a farm's records are the farm's, and a lapsed
subscription must never be the reason it cannot get them back.* A farm that stops
paying keeps everything and can pull it; it simply cannot push new work up.
Deleting a farm to save disk would be the betrayal that argument exists to
prevent, and nothing in this service does it.

**What is deliberately left behind:**

- **The farm's own records, when the person leaving is not its last owner.**
  They name a user id that no longer resolves, which is what "the farm keeps its
  records and the person leaves" actually means.
- **Support tickets.** `SUPPORT-LOOP.md` S1 makes a bundle machine-first —
  structure and counts, a hashed org key, no content — and those arrive as GitHub
  issues. Deleting an account does not reach GitHub, and the privacy policy
  should say so. The opt-in half that carries a farm's actual records is refused
  server-side until the repository is private (S5) and is off today, so no farm's
  records are there to be left.

**What it does not do, and the copy says so in both doors: cancel a
subscription.** Google Play holds that, and a farm that deletes without
cancelling goes on being charged for a farm that no longer exists. This service
cannot cancel it — the purchase is between the farm and the store — so the only
honest thing is to say it before the button.

---

## On the device

**Nothing on the handset is touched unless asked.** Sign-out already works this
way on purpose (`auth/session.ts`): the database is per farm, so isolation is
structural, and wiping would destroy unsent work — *the worst bargain in the
codebase*. A deletion that quietly took a farm's records off the phone would be
the same trade made worse, since the server copy is gone too.

So the panel offers it, off by default, and the sentence afterwards says which
way it went. When it is asked for, the file is **marked** rather than deleted:
it is still open at that moment, and it goes at the store switch the sign-out
triggers — `abandonLocalOrg` and `disposeWhenClosed` are the pair, and the same
mechanism `discardEmptyLocalOrg` already uses.

`ensureLocalOrgId` filters marked farms out of the disk scan it adopts from, or
signing out would reopen the very file that is about to go.

---

## What is tested, and where

| | |
|---|---|
| Every tenant collection is swept, driven from `COLLECTIONS` | `tests/unit/deletion-coverage.test.ts` |
| No delete is unscoped | same file, structurally rather than by naming filters |
| The neighbouring farm is untouched | `tests/isolation/account-deletion.test.ts` |
| A session alone is refused | same file |
| The page enumerates nobody | same file |
| The page, its policy and its nonce | `tests/unit/account-delete-page.test.ts` |
| The warning, the toggle, and what is said afterwards | `tests/screens/account-delete.test.tsx` |

**The sweep is driven by `COLLECTIONS` and not by a list written in the test.** A
collection added to `scoped.ts` next year is covered the day it exists; a second
copy of the list is the thing that goes stale, and it would go stale in the
safe-looking direction — a farm asking to be forgotten, leaving a collection of
its records behind with nothing pointing at them.

**The page suite needs no database**, deliberately. Everything else here needs a
mongod and therefore skips on a machine that cannot obtain one, and the page is
the half a store reviewer actually opens — the worst one to have covered only by
a job somebody has to remember to look at.

---

## Not transactional, and what that costs

A standalone mongod has no multi-document transaction (`DEPLOY-THE-SERVER.md`
records that decision), so a deletion is a sequence of deletes that can be
interrupted by a restart.

The order is chosen so that **any prefix leaves a state a retry finishes**: the
tenant records and the photo bytes first, the identity rows last, the farm's own
row last of all. A half-deleted farm still has its owner, who is still signed in,
and asking again completes it. The other order leaves records with no owner —
which nothing could ever reach to finish, and which is the one outcome worse than
the interruption.

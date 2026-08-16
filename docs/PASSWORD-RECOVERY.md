# Password recovery

**Decided, not built.** The delivery channel was the open question and it is
answered: **Steading gains an email sender.** This document is the design that
answer implies, researched before any code, so the implementation is a
transcription rather than a series of judgement calls made at the keyboard.

**The gap it closes.** There is no password reset. `AccountScreen` says so in a
comment: recovery needs `pnpm db:password`, which needs a shell on the server.
A farm that forgets its password is locked out of sync until the author
personally runs a script — and it is a lockout that hits people who are paying
and doing nothing wrong. `UNCONSIDERED.md` catalogued account deletion `[4]`
and never thought to ask about recovery; the August product assessment caught
it.

**Email is the route, and it is an ordinary addition to a server that already
exists.** `api.swbuild.dev` runs Fastify on the Oracle box and already
authenticates, syncs, serves the APK, takes support tickets and talks to Play.
Sending one message is a route beside those, not a new dependency.

Worth stating because an earlier draft of this document got it wrong: it
described email as a departure from an app "that needs no server to function".
That conflates two different things. **Offline-first is a promise about the
handset** — every record is written to local SQLite, the app opens and works
with the radio off, and sync is what happens afterwards. It has never been a
claim that the project has no server, and the two have been distinct since D10.

The two real costs are small and are already on the list: a secret on the box
alongside the ones there now, and a processor to name in the privacy policy
`[1]` and the Data Safety declaration `[3]` — the same paragraph that has to
name Atlas, S3, GitHub and Google.

---

## 1. What the standard requires

Every one of these is channel-independent — they apply as much to a code typed
into the app as to a link in a browser. Taken from the OWASP Forgot Password
guidance.

| Requirement | How this design meets it |
|---|---|
| CSPRNG token, long enough to resist brute force | `randomInt` over `JOIN_CODE_ALPHABET`, 8 characters — §3 does the arithmetic |
| Stored securely, never in the clear | SHA-256, and the hash **is** the `_id` |
| Single use | Redemption is a conditional update; exactly one caller wins |
| Expires | 20 minutes |
| No user enumeration | One response, one shape, one timing envelope — §5 |
| Rate limited | The auth routes already fail closed per IP; per-account limit added |
| Existing sessions invalidated on success | Every refresh token for that user revoked — §6 |

**None of this is new machinery.** `db/join-codes.ts` already implements the
first four, argues for them, and is tested. This follows it deliberately rather
than inventing a second idiom — the reasoning in that module's header is the
reasoning here, with one parameter changed and the change argued in §3.

## 2. A code, not a link

The email carries **an eight-character code the person types into the app**,
not a link.

A link is the web default and it is wrong here, for three reasons that are all
about this being an app:

1. **There is no web frontend to land on.** A reset page would be a new
   surface, on a server whose only current job is an API and a shelf.
2. **A deep link only works on the device that opened the email.** Farms read
   email on a phone and log the flock on a tablet. An `Android App Link` also
   needs domain verification via `assetlinks.json`, which is one more thing
   that silently stops working.
3. **A code is what this farm already knows.** Join codes are six characters
   typed by somebody standing in a barn. The gesture is familiar and the
   control already exists.

## 3. Eight characters, and why not six

`JOIN_CODE_ALPHABET` is 32 characters with the ambiguous ones removed
(no `I`, `L`, `O`, `U`), so each character is exactly five bits.

**A join code is six characters and that is defensible because somebody is
holding their phone out while it lives.** Ten minutes, one per farm, redeemed
by a person standing next to the person who minted it.

**A reset code has none of those properties.** It sits in an inbox. The inbox
may be open on a shared machine. Nobody is watching the window. So the
parameter moves:

| | Join code | Reset code |
|---|---|---|
| Length | 6 (30 bits, ~10⁹) | **8 (40 bits, ~10¹²)** |
| Lifetime | 10 minutes | **20 minutes** |
| Live at once | One per farm | **One per user** |
| Wrong attempts | Route limit only | **Five, then the code dies** |

The attempt counter is the part that matters more than the length. A code that
dies on the fifth wrong guess makes the entropy argument almost academic — but
both are cheap, and this is the flow that hands over an account.

**Twenty minutes rather than ten** because an email has to arrive, be noticed,
and be carried to another device. Ten minutes is a window that fails honest
people.

## 4. The provider

**Postmark**, on deliverability, with the integration written against a seam so
the choice stays cheap to revisit.

The comparison, for the record: Resend has the nicest API and a free tier;
Amazon SES is cheapest at scale and wants dedicated attention to configure;
Postmark keeps transactional and bulk sending on separate infrastructure and
refuses marketing mail, which is why its inbox placement is the best of the
three.

**Deliverability is the whole product here.** A reset email that lands in spam
is a lockout with extra steps, and this is the only email Steading will ever
send. Volume is a handful a month, so cost-at-scale — the one axis SES wins —
is the axis that does not apply.

Written against a `sendEmail` port with the provider behind it, for the same
reason `blobsFor(orgId)` is a seam: the second choice should be a file, not a
migration.

**`EMAIL_API_TOKEN` and `EMAIL_FROM` join `env.ts` as optional**, defaulting to
empty like `SUPPORT_GITHUB_TOKEN` and `GOOGLE_PLAY_SERVICE_ACCOUNT` — so a
development box with no mail configured refuses the route cleanly instead of
failing at send time. The token is server-side only; invariant 12 is not in
play, and it must never reach the client bundle.

## 5. Not saying whether the account exists

`POST /auth/forgot` **always** answers `202` with the same body, in the same
shape, whether or not the email belongs to anybody.

The timing has to match too, and that is the part implementations get wrong: a
real account does an argon2 hash and a database write while a non-existent one
returns immediately, and the difference is measurable from outside. Either do
the same work in both branches or hold the response to a fixed floor. **The
fixed floor is simpler and does not burn CPU on an attacker's behalf.**

The copy says what happened without asserting the account exists:

> If that email has an account, a code is on its way. It is good for twenty
> minutes.

## 6. What a successful reset does

Three writes, and the second two are the ones people forget:

1. Set the new `passwordHash` (argon2, as signup does).
2. **Revoke every refresh token for that user.** A reset is what somebody does
   when they think another person has their password, and leaving that
   person's session alive defeats the entire exercise.
3. Mark the code used, so a replay finds it spent.

Ordered so a crash cannot leave a live session on a changed password: revoke
first, then set, then mark. A crash after step one signs everybody out, which
is survivable; a crash the other way round is not.

**A reset does not delete the farm's data, log anybody out of the app, or
affect the local SQLite database.** The app opens before it authenticates
(D14), so a locked-out farm has been logging normally all along — this restores
sync, not the records.

## 7. The shape

```
POST /auth/forgot   { email }                 → 202, always, fixed timing
POST /auth/reset    { email, code, password } → 204, or 400 with one message
```

```ts
interface PasswordResetDoc {
  /** SHA-256 of the normalised code. The code itself is never stored. */
  _id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Counts wrong guesses. At five the row is dead. */
  attempts: number;
  /** Set on use. A replay is refused. */
  usedAt?: Date;
}
```

Lives in `apps/api/src/db/password-resets.ts`, **deliberately not tenant
scoped**, for the reason `join-codes.ts` gives: it is used by somebody with no
session and therefore no `orgId`, so `scoped()` cannot serve it. Same
discipline — no collection handle leaves the module, every function is
purpose-built, and `tests/isolation` covers it.

Minting replaces whatever that user had live, so a person who taps twice has
one working code rather than two, and the one in the newest email is the one
that works.

## 8. What the client needs

- **A link on the sign-in screen**, which is where somebody discovers they are
  stuck.
- **Two steps on one screen**: ask for the email, then take the code and the
  new password together. One screen because the code arrives while the person
  is still holding the phone, and a second navigation is a place to get lost.
- **The refusal is one message for every failure** — wrong code, expired code,
  spent code, too many attempts — because distinguishing them tells an attacker
  which of those they achieved. It names the recovery: *"That code is not
  right, or it has expired. Ask for another."*

## 9. What has to be tested before this ships

The list, so it is not assembled from memory at the end:

- A code works exactly once; the second attempt is refused.
- An expired code is refused.
- The fifth wrong guess kills the code, and the correct one then fails too.
- Minting twice leaves exactly one live code, and it is the newer.
- `/auth/forgot` answers identically for a real and an unknown address, and
  within the same timing envelope.
- A successful reset revokes every refresh token for that user, and a session
  that was live before it is refused afterwards.
- The stored row never contains the code in the clear.
- **Isolation**: the collection is reachable only through its module, and a
  reset cannot be minted or redeemed across orgs.
- The route refuses cleanly when no mail is configured, rather than erroring at
  send time.

## 10. What this does not do

- **No security questions.** They are a weaker password nobody chose.
- **No "reset link expires when you click it" web page.** §2.
- **No recovery codes at signup**, which was one alternative considered: it
  works for a solo owner without any email at all, and it is a thing people
  lose in the drawer with the manual. It remains the obvious second factor if
  this app ever grows one, and the token machinery here would serve it
  unchanged.
- **No owner-mediated reset** for now — another farm member minting a reset
  code the way they mint a join code. It is a natural companion for a farm with
  more than one person, it reuses every part of this, and it is a smaller piece
  of work once this exists. It is not a substitute: most farms are one person,
  and that person has nobody to ask.

---

**Sources for the standard and the provider comparison** —
[OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
[OWASP Top 10 A07: Identification and Authentication Failures](https://owasp.org/Top10/2021/A07_2021-Identification_and_Authentication_Failures/),
[Resend vs Amazon SES vs Postmark, 2026](https://www.buildmvpfast.com/blog/resend-vs-ses-vs-postmark-transactional-email-deliverability-saas-2026),
[The top transactional email services for developers](https://knock.app/blog/the-top-transactional-email-services-for-developers).

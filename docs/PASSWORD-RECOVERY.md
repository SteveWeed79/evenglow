# Password recovery, and the mail sender under it

**Built, 17 August.** It was largely the typing exercise this document set out
to make it — the shape, the code length, the timing floor, the two-axis rate
limit and the three writes all went in as written. Three things came out
differently and each is recorded below where it belongs, rather than leaving the
document describing something that is not there:

1. **Two providers behind the port, not one** (§8.1). The port existed so the
   choice would be a file; taking that seriously costs fifteen lines per
   provider, and the cost analysis here weighed scale rather than floor.
2. **Superseded, not deleted** (§7). Deleting the previous row broke the
   per-account limit in a way only its own test found.
3. **No `html` part** (§7). Nothing needed one and an unsent branch is an
   untested path.

**What is still open**: the From domain (§8.2), which is a decision rather than
code — mail stays off until `EMAIL_FROM` is set, deliberately. And email
verification at signup (§10), which is the next thing.

**The gap.** There is no password reset. `AccountScreen` says so in a comment:
recovery needs `pnpm db:password`, which needs a shell on the server. A farm
that forgets its password is locked out of sync until the author personally
runs a script — a lockout aimed squarely at people who are paying and doing
nothing wrong.

---

## 1. This is a mail sender, and password reset is its first customer

Worth putting first, because it changes what the work is worth.

`api.swbuild.dev` already authenticates, syncs, bills, takes support tickets,
talks to Play and serves the APK. A mail send is a route beside those. What it
unlocks is not one flow:

- **Invites do not currently reach anybody.** `POST /invites` binds a token to
  an email address, returns it **once, to the owner who created it**, and there
  the trail ends. The design in `DOMAIN-SCOPE.md` §8.1 is explicitly an
  email-bound invitation — *"a link that travels by text message and sits in a
  phone forever"* is named as the thing it avoids — and there has never been
  anything to send it with. Today an owner has to read a 43-character token
  down the phone. **Mail finishes a feature that is otherwise built and
  stranded.**
- **The support loop has no way to close.** `SUPPORT-LOOP.md` §6 lists "there
  is no channel to tell a farm their report mattered" as outstanding. A farm
  that raised a ticket has an address.
- **Nothing verifies an email address.** Password signup accepts whatever is
  typed; only the Google path carries `email_verified`. Once mail exists,
  verification is a small follow-on — see §10.
- **`[148]` in `UNCONSIDERED.md`** — "there is no way to tell a farm anything",
  which covers release notes, an outage, and a fixed defect — stops being
  structural.

So the sender is the deliverable and the reset is the first thing routed
through it. Build it as a capability.

## 2. What the standard requires

Channel-independent: these apply to a code typed into an app exactly as they do
to a link in a browser.

| Requirement | How this design meets it |
|---|---|
| CSPRNG token, long enough to resist brute force | `randomInt` over `JOIN_CODE_ALPHABET`, 8 characters — §4 |
| Stored securely, never in the clear | SHA-256, and the hash **is** the `_id` |
| Single use | Redemption is a conditional update; exactly one caller wins |
| Expires | 20 minutes |
| No user enumeration | One response, one shape, one timing envelope — §5 |
| Rate limited | Per IP as the auth routes already do, **and per account** — §5 |
| Existing sessions invalidated on success | Every refresh token for that user revoked — §6 |

**Almost none of this is new machinery.** `db/join-codes.ts` implements the
first four, argues for each, and is tested. This follows it rather than
inventing a second idiom.

## 3. A code, not a link — and this time on the merits

The earlier draft of this document chose a code partly because "there is no web
frontend to land on". That was a bad reason: there is a server, and a reset
page is a route. Re-decided properly, the answer is the same and the reasons
are better.

**A one-time code, typed into the app.**

1. **Phishing.** A password reset email that trains people to click a link is a
   password reset email that trains people to click *any* link claiming to be a
   reset. A code the person carries into an app they already have open cannot
   be redirected to a lookalike domain. This is the security argument and it is
   the strongest one.
2. **Cross-device.** Email gets read on a phone; the farm's records are on the
   tablet in the kitchen. A link completes on the device that opened it. A code
   travels.
3. **The alternative costs real setup to work at all.** An Android App Link
   needs `assetlinks.json` served from the domain and verified, and it fails
   open into a browser when verification breaks — which is a silent failure
   mode on a flow used by people who are already stuck.
4. **It is the gesture this farm already knows.** Join codes are six characters
   typed by somebody standing in a barn.

The cost is honest: typing eight characters is slower than tapping a link. For
a flow somebody hits once a year, that is the right trade.

## 4. Eight characters, and why not six

`JOIN_CODE_ALPHABET` is 32 characters with the ambiguous ones removed (no `I`,
`L`, `O`, `U`), so each character is exactly five bits.

**A join code is six characters, and that is defensible because somebody is
holding their phone out while it lives** — ten minutes, one per farm, redeemed
by a person standing next to the person who minted it.

**A reset code has none of those properties.** It sits in an inbox, possibly on
a shared machine, with nobody watching the window.

| | Join code | Reset code |
|---|---|---|
| Length | 6 (30 bits, ~10⁹) | **8 (40 bits, ~10¹²)** |
| Lifetime | 10 minutes | **20 minutes** |
| Live at once | One per farm | **One per user** |
| Wrong attempts | Route limit only | **Five, then the code dies** |

**The attempt counter matters more than the length.** A code that dies on the
fifth wrong guess makes the entropy argument nearly academic — but both are
cheap, and this is the flow that hands over an account.

**Twenty minutes rather than ten** because mail has to arrive, be noticed, and
be carried to another device. Ten minutes is a window that fails honest people.

## 5. Not saying whether the account exists

`POST /auth/forgot` **always** answers `202`, same body, same shape, whether or
not the address belongs to anybody.

**The timing has to match, and that is the part implementations get wrong.** A
real account does an argon2 hash and a database write; a non-existent one
returns immediately, and the difference is measurable from outside. Hold the
response to a fixed floor rather than doing fake work — simpler, and it does
not burn the box's CPU on an attacker's behalf.

**Rate limited on two axes**, because they stop different attacks: per IP,
which the auth routes already do and which fails closed; and **per account**,
so somebody who knows one farmer's address cannot fill their inbox with reset
codes. The per-account limit is the anti-harassment one and it is easy to
forget.

The copy says what happened without asserting the account exists:

> If that email has an account, a code is on its way. It is good for twenty
> minutes.

## 6. What a successful reset does

Three writes, and the last two are the ones people forget:

1. **Revoke every refresh token for that user.** A reset is what somebody does
   when they think another person has their password; leaving that person's
   session alive defeats the whole exercise.
2. Set the new `passwordHash` (argon2, as signup does).
3. Mark the code used, so a replay finds it spent.

**In that order**, so a crash cannot leave a live session on a changed
password. A crash after step one signs everybody out, which is survivable; a
crash the other way round is not.

**A reset does not touch the farm's records.** The app opens before it
authenticates (D14), so a locked-out farm has been logging normally all along.
This restores sync, not the data.

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

`apps/api/src/db/password-resets.ts`, **deliberately not tenant scoped**, for
the reason `join-codes.ts` gives: it is used by somebody with no session and
therefore no `orgId`, so `scoped()` cannot serve it. Same discipline — no
collection handle leaves the module, every function purpose-built, and
`tests/isolation` covers it.

Minting replaces whatever that user had live, so somebody who taps twice has
one working code, and it is the one in the newest email.

> **Superseded rather than deleted, and the first implementation deleted.**
> A delete-then-insert leaves exactly one row however many times somebody asks
> — so the per-account limit above, which counts rows, could never fire, and the
> anti-harassment control §5 calls "the one that is easy to forget" was
> decorative. Its own test caught it on the first run. `supersededAt` marks the
> old row instead, `claimResetCode` filters on it, and the retired rows are a
> better audit trail than none: a run of them is somebody being locked out, or
> somebody else trying to lock them out.

## 8. The sender

### 8.1 The provider

**Both, behind the port, chosen by `EMAIL_PROVIDER`** — and Resend is where to
start.

> **Corrected while building.** This section chose Postmark on deliverability
> and dismissed cost with *"volume is a handful a month, so cost-at-scale — the
> one axis SES wins — does not apply."* That is true and it points at the wrong
> number: at a handful a month the deciding figure is the **monthly minimum**,
> not the per-thousand rate. Postmark's free tier is a hundred messages and is
> described as being for testing; Resend's is three thousand, which is about a
> hundred times this flow's volume. Against a project whose entire
> infrastructure is roughly $25 a year and whose farms pay $39
> (`ACCESS-AND-BILLING.md` §4.1), a paid mail floor is several farms' revenue
> spent on password resets.
>
> Both adapters are one authenticated POST of JSON, so shipping both cost about
> thirty lines and no dependency. That is not a re-decision of the paragraph
> below — it is what its own port was for. If inbox placement ever disappoints,
> Postmark is one environment variable away.

Postmark remains the better answer on deliverability alone, behind a port so the
choice stays a file rather than a migration.

For the record: Resend has the nicest API and a free tier; Amazon SES is
cheapest at scale and wants dedicated attention to configure; Postmark keeps
transactional and bulk sending on separate infrastructure and refuses marketing
mail, which is why its inbox placement leads.

**Deliverability is the entire product here.** A reset that lands in spam is a
lockout with extra steps. Volume is a handful a month, so cost-at-scale — the
one axis SES wins — does not apply.

The seam is `sendEmail({ to, subject, text, html })`, one module, provider
behind it, exactly as `blobsFor(orgId)` is the seam for photo bytes.

### 8.2 The DNS, which is not optional any more

**This is the part that decides whether any of the above works**, and it is
configuration rather than code — which means it can be got wrong quietly and
discovered by a farmer who never got their code.

- **SPF, DKIM and DMARC all three.** As of late 2025 the large mailbox
  providers reject non-compliant mail outright rather than filing it in spam.
  Transactional mail is exempt from the one-click-unsubscribe rule and is
  **not** exempt from authentication.
- **DKIM must be signed with our domain, not the provider's.** The classic
  failure is an ESP signing as `mailer.provider.com` while the From header says
  ours, which passes DKIM and fails DMARC alignment. Postmark's DKIM setup
  publishes a record on our domain; use it.
- **A dedicated sending subdomain**, so a reputation problem cannot reach
  whatever else the apex is used for.
- **A reachable reply address, not `no-reply@`.** Replies to a black hole are
  an engagement signal against you, and for a one-person operation the replies
  are worth reading — it is the support channel `SUPPORT-LOOP.md` §6 says does
  not exist.

**The From domain is an open question and it is a security one.** The domain is
`swbuild.dev`; the app is called Steading. A password reset arriving from a
domain the farm has never heard of is indistinguishable from phishing, and the
correct user response to it is to ignore it. Either the mail comes from
something that says Steading, or the email body has to work harder than any
copy should have to. **Worth deciding before the DNS is set up rather than
after.**

### 8.3 When mail fails

The flow has to behave when the provider is down, the address bounces, or no
mail is configured at all.

- **No mail configured** — `EMAIL_API_TOKEN` empty, as on a development box —
  the route refuses cleanly at the edge with a plain message, rather than
  erroring at send time. Same shape as `SUPPORT_GITHUB_TOKEN` and
  `GOOGLE_PLAY_SERVICE_ACCOUNT`, which already default to empty in `env.ts`.
- **The provider is down.** The code is minted and stored before the send is
  attempted, so a failed send is a farmer who waits and asks again — not a
  broken row. Do not surface the failure differently from success: that would
  reintroduce the enumeration §5 removes.
- **A hard bounce** means the address is wrong or gone, and nothing in this
  system currently knows that. Not solved here; noted as the first thing worth
  adding once mail has a webhook.

## 9. What the client needs

- **A link on the sign-in screen**, which is where somebody discovers they are
  stuck.
- **Two steps on one screen**: ask for the email, then take the code and the
  new password together. One screen, because the code arrives while the person
  is still holding the phone, and a second navigation is a place to get lost.
- **One refusal message for every failure** — wrong code, expired, spent, too
  many attempts — because distinguishing them tells an attacker which of those
  they achieved. It names the recovery: *"That code is not right, or it has
  expired. Ask for another."*
- **The new password field obeys the same rules signup uses.** One place, not
  two, or they will drift.

## 10. Email verification, immediately after

Not part of this, and the obvious next thing once a sender exists.

Password signup accepts any address; only Google carries `email_verified`. That
is tolerable while an address does nothing, and it stops being tolerable the
moment an address can receive a password reset — a typo at signup means a
recovery route that reaches a stranger, and the farm cannot tell.

Same token machinery, same table shape, one more route. **Not folded in here**
because it changes the signup flow and this document is about the lockout.

## 11. What has to be tested

Assembled now rather than from memory at the end:

- A code works exactly once; the second attempt is refused.
- An expired code is refused.
- The fifth wrong guess kills the code, and the correct one then fails too.
- Minting twice leaves exactly one live code, and it is the newer.
- `/auth/forgot` answers identically for a real and an unknown address, **and
  within the same timing envelope** — the assertion people skip.
- A successful reset revokes every refresh token for that user; a session live
  before it is refused after it.
- The stored row never contains the code in the clear.
- The route refuses cleanly when no mail is configured.
- A send failure does not leave the caller a different answer from a success.
- **Isolation**: the collection is reachable only through its module, and a
  reset cannot be minted or redeemed across orgs.

## 12. What this does not do

- **No security questions.** They are a weaker password nobody chose.
- **No emailed link, and no reset web page.** §3.
- **No recovery codes at signup.** They work with no mail at all and for a solo
  owner, and they are a thing people lose in the drawer with the manual. The
  obvious second factor if this app ever grows one, and the machinery here
  would serve it unchanged.
- **No owner-mediated reset** yet — another member minting a reset code the way
  they mint a join code. A natural companion for a farm with more than one
  person, reusing every part of this, and a small piece of work once this
  exists. Not a substitute: most farms are one person, and that person has
  nobody to ask.
- **No bounce handling.** §8.3.

---

**Sources.**
[OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) ·
[OWASP Top 10 A07: Identification and Authentication Failures](https://owasp.org/Top10/2021/A07_2021-Identification_and_Authentication_Failures/) ·
[MDN, One-time passwords](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/OTP) ·
[Password reset best practices, Authgear](https://www.authgear.com/post/authentication-security-password-reset-best-practices-and-more/) ·
[Universal and deep links, 2026](https://prototyp.digital/blog/universal-links-deep-linking-2026) ·
[Google and Yahoo email authentication requirements](https://powerdmarc.com/google-and-yahoo-email-authentication-requirements/) ·
[Bulk email sender requirements checklist](https://redsift.com/guides/bulk-email-sender-requirements) ·
[Resend vs Amazon SES vs Postmark, 2026](https://www.buildmvpfast.com/blog/resend-vs-ses-vs-postmark-transactional-email-deliverability-saas-2026)

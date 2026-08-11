# Running the server — the operator's commands

Everything a person who runs Steading does from a terminal, and where to do it.

There is no admin web portal, deliberately. Every command here needs a shell on
a machine that can reach the database, which is the whole authority model: no
route can grant a subscription, read across farms, or reset a password, so no
token can either. See §5 for when that stops being the right answer.

---

## 0. Where to enter them

**All of these run from the repository root**, not from `apps/api`:

```
cd /c/steading          # or wherever the checkout is
pnpm farm:ls
```

They read `.env.local` in that root, so `MONGODB_URI` decides which database
they touch.

> ### That last sentence is the whole safety story
>
> These commands do not know or care whether a database is "production". If
> `.env.local` points at your Atlas cluster, then `pnpm farm:grant` typed on a
> laptop in a kitchen writes to the live farm data — the same as if it were
> typed on the server.
>
> There is no staging flag and there will not be one: a label that says
> `production` is trusted right up until somebody points a staging config at a
> real cluster, and then it is actively misleading. **Check
> `MONGODB_URI` before anything that writes.**
>
> The one exception is `pnpm db:verify`, which uses a database called
> `steading_verify` and drops it — it deliberately ignores `MONGODB_DB` so it
> cannot be aimed at real records.

**Which shell.** Anything: PowerShell, Git Bash, cmd, a Linux shell. On Windows
the `pnpm farm` script is careful about argument quoting (see §3), but nothing
here depends on the shell you use.

**Which machine.** Any machine with a checkout and a route to the database —
that is the point of them reading `MONGODB_URI` rather than assuming localhost.
The server itself is an Oracle Cloud Always Free ARM instance, settled in
`Steading-Masterplan.md` §5 and costed in `ACCESS-AND-BILLING.md` §4.1; the
commands do not have to run there and mostly will not.

What does not exist yet is the deployment *mechanism* — no container image, no
process supervisor, no TLS termination, and `start` runs TypeScript through
`tsx`, which is a devDependency. The host is decided; getting the API onto it is
still a job.

---

## 1. Looking at farms

### `pnpm farm:ls`

Every farm, one line each: name, id, how many people, how many records, its
sync state, and when it last wrote anything.

```
  FARM                    ID                          WHO  RECORDS  SYNC        LAST WRITE
  Hollow Farm             01J8Z3M4Q7R2VXK9N5T6B8D0FW  2    1,412    granted     today
  Ridge Smallholding      01J8Z9P2K4M7X1V3N8T5R6B2CD  1    88       unsubscribed 6d ago
```

Read-only. The id in the second column is what the other two commands take.

### `pnpm farm:show <farmId>`

One farm in detail — the tool for *"farm X says sync is broken"*.

```
pnpm farm:show 01J8Z3M4Q7R2VXK9N5T6B8D0FW
```

Who is on it and how they sign in, whether the server is taking its work, when
it first and last wrote, and how many of each kind of record it holds.

**The line that usually answers the question is `last`.** A farm reporting
broken sync that last wrote three weeks ago is a device that stopped flushing;
one that wrote an hour ago is a person looking at a screen that has not
refreshed. Those get different replies.

Read-only, and **it does not show record contents** — counts answer an
operational question, and reading somebody's tallies over their shoulder does
not. When you genuinely need their data, the support loop asks them for it
(`docs/SUPPORT-LOOP.md` S2).

---

## 2. Giving sync away

### `pnpm farm:grant <farmId> [--note "why"] [--revoke]`

The comp. For testers, for the people building this, and for anyone who should
not be charged.

```
pnpm farm:grant 01J8Z3M4Q7R2VXK9N5T6B8D0FW --note "beta tester"
pnpm farm:grant 01J8Z3M4Q7R2VXK9N5T6B8D0FW --revoke
```

Takes effect on the next request — nothing needs restarting. It prints the
farm's **name** before it changes anything, which is the check against a
mis-pasted id: a 26-character ULID that lands on the wrong farm is otherwise a
silent mistake neither farm ever notices.

There are two ways to grant sync and they are both deliberate:

| | `FREE_SYNC_ORGS` | `pnpm farm:grant` |
|---|---|---|
| Lives in | `.env.local` | the farm's own document |
| Takes effect | on restart | on the next request |
| Survives a database restore | yes | only if the backup has it |
| Use it for | you, permanently | testers, support, anyone temporary |

The env list wins, so an operator locked out of the database can still let
somebody through. Neither is reachable from the wire, which is the property the
masterplan is protecting: *a grant that can be requested is a grant that can be
requested by anybody.*

### `pnpm promo:new`

A code somebody types into the app themselves, rather than a grant you apply
for them.

```
pnpm promo:new                        one farm, forever
pnpm promo:new --days 365             a year from whenever it is redeemed
pnpm promo:new --uses 5 --note beta   five farms
```

**Printed once and stored hashed.** Write it down; losing it means minting
another, which is cheap. Redeemed in the app under Account → *Been given a
code?*, which appears once somebody is signed in and unsubscribed.

> **Neither of these does anything on a server with no Play config.** The
> billing gate is `if (env.playConfig !== null && …)` — with
> `GOOGLE_PLAY_SERVICE_ACCOUNT` unset, no farm is ever refused sync, so there is
> nothing for a grant or a code to unlock. That is the correct state for a
> self-hosted farm and it is the state this server is in today.

---

## 3. Accounts

### `pnpm db:seed`

Creates the first farm and its owner. D7 is single-farm-first, so the first
account is made here rather than through the app.

```
SEED_ORG="Hollow Farm" SEED_EMAIL=owner@example.com SEED_PASSWORD='a good password' pnpm db:seed
```

**Through the environment, not as arguments.** A farm name with a space in it
silently shifts every later argument along — which once produced an account
whose email was the second word of the farm name and whose password was the
real email address. Argv is also readable from a process list, and one of these
three values is a password.

### `pnpm db:password`

Sets an existing account's password. **This is the only password reset there
is** — there is no in-app flow, so an owner who forgets and does not use Google
sign-in needs you.

```
SEED_EMAIL=owner@example.com SEED_PASSWORD='the new password' pnpm db:password
```

---

## 4. The database itself

### `pnpm db:indexes`

Applies every index definition. **Run it once against any new database**, and
again after any release that adds a collection.

Two of them carry behaviour rather than speed: `users.email` is unique and is
the duplicate-signup guard, and the TTL indexes on `refreshTokens.expiresAt` and
`invites.expiresAt` are what make expired tokens and invites delete themselves.
Nothing in the application code enforces either — they are properties of the
database, so if the index is missing nothing cleans up and nothing complains.

### `pnpm db:verify`

Exercises the real server data path — the scoped tenancy layer, index
application, and the sync applier — against whatever `MONGODB_URI` points at,
and reports plainly.

**Safe against a live cluster.** It uses a database called `steading_verify` and
drops it, deliberately ignoring `MONGODB_DB` so it cannot be aimed at real
records.

Worth running after any change to the server's data path, and after pointing at
a new cluster. It is the only way to execute the Mongo-backed checks outside
CI — most of the test suite skips them without a database.

### `pnpm db:usage`

What each farm is costing, in bytes. Read-only.

Not for pricing — `ACCESS-AND-BILLING.md` §4.1 settles that. It is for capacity
against the host's disk, for spotting the one farm uploading video, and for
deciding when photo bytes should leave the database for S3.

### `pnpm farm`

Brings a **development** server up from nothing: a local database, a first
account, and the API. For a working machine, not for a deployment.

It writes any missing `AUTH_SECRET` or `MONGODB_URI` into `.env.local` and
leaves anything already there alone — so it will not overwrite an Atlas URI. It
does rewrite the file when it adds something, and comments do not survive that.

### `pnpm dev:api`

The API alone, watching for changes, against whatever `.env.local` says.

---

## 4a. Putting the API somewhere phones can reach

Everything above assumes a shell on a machine that already runs the service.
This is how it gets there in the first place.

**The thing that forces this is a second person.** A phone on your own wifi can
reach a laptop, and a tethered one can reach it over `adb reverse`. Neither
works for somebody else's phone in somebody else's house, and neither survives
the laptop closing. A tester is what turns "runs locally" into "needs an
address".

### What the API actually needs

Two environment values, and nothing else is required:

| | |
|---|---|
| `AUTH_SECRET` | 32 characters or more. Signs access and refresh tokens |
| `MONGODB_URI` | Atlas, or a `mongod` on the same box |

Everything else in `apps/api/src/env.ts` has a default, and the features they
switch on — Google sign-in, Play billing, the support loop — each stay off and
say so rather than half-working.

**One value is not required and should be set anyway: `TRUSTED_PROXY_HOPS=1`,
behind any host that terminates TLS for you.** Fly, Render, a reverse proxy —
all of them forward the request and append the caller to `X-Forwarded-For`.
Fastify does not believe that header unless told how far to look, so
`request.ip` becomes the proxy's address for every request. Every rate limiter
in this service keys on `request.ip`, so the auth limiter would count the whole
internet as one caller and lock a farm out over somebody else's typo. The
number is how many proxies are actually in front; `true` would let a caller
forge past it by sending the header themselves.

### The box, start to finish

**`docs/DEPLOY-THE-SERVER.md` is the step-by-step**, from a fresh Oracle
Always Free instance to `https://api.swbuild.dev/health`. Three consoles that
cannot be scripted (DNS, Oracle's ingress rule, Atlas's IP allowlist), then one
script:

```
sudo git clone https://github.com/SteveWeed79/steading /opt/steading
sudo /opt/steading/scripts/deploy/setup-box.sh api.swbuild.dev
```

`scripts/deploy/` holds what it installs: a systemd unit, a Caddyfile that
obtains and renews the certificate by itself, and `deploy.sh` for every
version after the first.

The one thing worth repeating out of that document, because it costs an
evening: **there are two firewalls in front of an Oracle box.** The VCN
security list in the cloud console, and the instance's own iptables — which
ships with a REJECT rule allowing only SSH, and which `ufw` does not manage, so
`ufw allow 443` reports success and changes nothing.

### The image, for a host that wants one

`apps/api/Dockerfile`. Two stages: a filtered `pnpm install`, then
`pnpm deploy --legacy --prod` into a self-contained tree, copied into a
runtime stage with nothing else in it. `fly.toml` at the repo root runs it.

Not needed on the box above, which runs from a checkout under systemd — easier
to read the logs of and easier to fix at 6am.

Three things about it are not obvious and each one cost a failed build:

- **All four workspace manifests must be in the build context**, including
  `apps/mobile/package.json`, even though the install is filtered to the API.
  `pnpm deploy` re-resolves the whole workspace and the root `package.json`
  names `@steading/mobile`. Omit it and the deploy step fails *after* a
  successful install, which is a confusing place to land.
- **`tsx` is a production dependency**, deliberately. This service imports
  extensionless (`from './env'`) under `moduleResolution: bundler`, which
  neither Node's own type stripping nor `tsc` output can load — both need the
  specifiers rewritten across every file in the service. So the source ships
  and `tsx` runs it, exactly as `pnpm dev:api` always has.
- **`.npmrc` has to be copied in.** Its reasoning is about Windows path
  lengths, but the `node-linker=hoisted` it sets is also what lets
  `pnpm deploy` run at all without `inject-workspace-packages`.

### Fly, as the alternative

`fly.toml` is at the repo root and points at that Dockerfile.

```
fly launch --no-deploy --copy-config      # once. names the app, picks a region
fly secrets set AUTH_SECRET=… MONGODB_URI=…
fly deploy
```

Kept because the answer could change, and because it is the fastest way to put
this somewhere when the box is unavailable. It costs a couple of dollars a
month, which is exactly what the Oracle instance exists to avoid.

### Then the app has to be told

`EXPO_PUBLIC_API_URL` is **compiled into the APK**. `boot/config.ts` reads it
once and there is no runtime setting, on purpose: a server address a stranger
can talk somebody into changing is a phishing surface, and this app is
offline-first precisely so it never has to ask.

So the origin goes into `eas.json`'s `preview-farm` and `production` profiles,
and pointing at a different server means another build. A build with the value
empty is not broken — it is the free tier, and the sync chip says **Not set
up**.

---

## 5. When this should become a portal

Not yet, and the trigger is worth naming rather than feeling:

**When somebody who is not you needs to perform an operator action.** A CLI
needs a laptop, a checkout and a shell. That is the constraint that breaks
first — not the feature list.

The second trigger is response time: if *"why isn't farm X syncing"* stops being
answerable in five minutes with `farm:show`, the tooling has fallen behind the
number of farms.

When it is built, two things must hold, and they are the reason it is not a few
routes on the existing API:

- **Its own service, never a route on the farm API.** `scoped()` is load-bearing
  because there is exactly one way into the data and it always carries an
  `orgId`. An admin surface that can read across farms is the one thing that
  could undo that, and it must not share a process with the surface phones talk
  to.
- **It must never accept a farm access token.** Separate credentials, separate
  audience, separate revocation.

---

## Turning on "Something is wrong"

The app's report button posts a bundle to the farm server, which files it as a
GitHub issue. Until a token and a repo are set the route answers 501 and the
app falls back to its share sheet — which works, and is not the loop.

**One-time setup.**

1. Make a fine-grained token at
   <https://github.com/settings/personal-access-tokens/new>:
   - **Repository access** → Only select repositories → `steading`
   - **Permissions** → Repository permissions → **Issues: Read and write**
   - Nothing else. It files issues and that is all it can do.
2. Add two lines to `.env.local` **on the machine running the server**:

   ```
   SUPPORT_GITHUB_TOKEN=github_pat_...
   SUPPORT_REPO=SteveWeed79/steading
   ```

3. Restart the farm server. `Check my setup` will say where reports go.

`.env.local` is gitignored and the token is read only by the server — it never
reaches the app, which is why the route is unauthenticated and the token is not.

### Leave `SUPPORT_ACCEPT_RECORDS` alone while the repository is public

It is off by default and it must stay off. It controls the **opt-in second
half** — the farm's actual records, as CSV — and a public tracker is a public
place to put them. The route refuses them on the server rather than trusting
the app not to offer, and tells the farm plainly that they were not sent.

The lean bundle is safe in public by construction, which is the point of S1:
**structure and counts, never content.** No email, no farm name, no animal
names. The farm id is a hash rather than the id, so two reports from one farm
can be recognised as the same farm without the ticket naming a customer.

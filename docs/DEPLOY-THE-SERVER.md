# Putting the farm server on the internet

From a fresh Oracle Always Free instance to `https://api.swbuild.dev/health`
answering `{"ok":true}`, and then to two phones syncing one farm.

Follow it in order. Steps 1–2 are two different consoles and neither can be
scripted from the box; steps 3–6 are the box, and only step 5b is not a script;
steps 7–8 are the app.

> **The database lives on the box.** This deployment ran on a managed MongoDB
> cluster to begin with and no longer does — `mongod` is installed alongside the
> API, bound to loopback, and the cluster has been deleted. Step 3 is where that
> happens on a fresh box, and *"Moving the database onto the box"* below is the
> record of the move and the reasoning that still governs it.

---

## Why any of this is needed

A phone on your own wifi can reach a laptop, and a tethered one can reach it
over `adb reverse`. Neither works for somebody else's phone in somebody else's
house, and neither survives the laptop closing.

**Only writing needs the server.** Logging eggs, treatments, losses and hours
all happen against SQLite on the handset and always will. What the server adds
is a farm existing on more than one device — which is also the only thing
anybody is ever asked to pay for (D13).

---

## What you need before you start

| | |
|---|---|
| An Oracle Cloud instance | Always Free ARM, **Ubuntu** — not Oracle Linux |
| A domain you control | A subdomain is enough. `api.swbuild.dev` throughout below |
| Somewhere to put the database | **Nothing to arrange.** Step 3 installs `mongod` on this same box |
| SSH access to the box | `ssh ubuntu@<the box's public IP>` |

### Two SSH settings, before you spend an evening on the box

**`client_loop: send disconnect: Connection reset` after a pause is not the
box.** A NAT entry somewhere between you and it — a home router, or the
provider's edge — expires while the connection sits idle, and neither end finds
out until the next keystroke tries to send. On your own machine, once, for every
host you ever reach:

```
# ~/.ssh/config, or %USERPROFILE%\.ssh\config on Windows
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 5
```

A keepalive every minute keeps the entry warm, and five missed replies still
disconnects — so a real five-minute outage is still an outage, and a coffee
break is not.

**And run anything long inside `tmux`.** A dropped session sends `SIGHUP` to
whatever it was running, so a disconnect during `migrate-to-local-mongo.sh` or
`backup-mongo.sh` leaves a half-finished job with nobody watching:

```
sudo apt-get install -y tmux
tmux new -s steading      # Ctrl-B then D detaches; close the laptop
tmux attach -t steading   # it kept running
```

Deployments do not need this — `steading-deploy.timer` runs them from systemd,
so they neither know nor care whether anybody is connected.

**Upgrade the Oracle account to Pay As You Go before you rely on this.** Oracle
reclaims Always Free compute that sits idle — roughly under 20% CPU with low
network over seven days — and a farm API is exactly that shape. A Pay As You Go
account is exempt and Always Free resources still cost nothing. This is the
cheapest insurance in the whole document and the failure it prevents is your
sync server quietly disappearing.

---

## 1. DNS — one record

At whoever hosts `swbuild.dev`:

```
api    A    <the box's public IP>
```

**It does not touch the apex or `www`.** A subdomain is a separate record
pointing at a separate machine with its own certificate, so a portfolio on the
same domain is unaffected and never sees this traffic.

**If the zone is on Cloudflare, leave the record grey — DNS only.** An
orange-clouded record proxies through Cloudflare, which terminates TLS itself:
Caddy's certificate challenge cannot complete, and the proxy hop count in step 5
would be wrong.

Wait for it, then check from anywhere:

```
dig +short api.swbuild.dev
```

That must print the box's IP before step 6, because Let's Encrypt checks the
name resolves to the machine asking for the certificate.

---

## 2. The Oracle console — the ingress rule

**This is the step that cannot be scripted, and forgetting it looks exactly
like the server being down.**

Networking → Virtual Cloud Networks → your VCN → Security Lists → Default →
**Add Ingress Rule**:

| | |
|---|---|
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port | `443` |

Add a second one for `80` — Let's Encrypt uses it for the certificate challenge
and Caddy uses it to redirect.

There are **two** firewalls in front of this box. This is the one in Oracle's
control plane. The other one is on the instance itself and step 4 handles it.

---

## 3. The database — on the box

One script, and it is the same one the live box was moved onto:

```
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/SteveWeed79/steading /opt/steading
sudo MONGODB_DB=steadingdb /opt/steading/scripts/deploy/setup-mongo.sh
```

Installs MongoDB 8, binds it to **127.0.0.1 only**, caps the WiredTiger cache,
and creates the application user. The connection string that comes out of it is
a loopback one, and it is what goes in `MONGODB_URI` at step 5.

**Pass `MONGODB_DB` if your database is not to be called `steading`** — this
deployment's is `steadingdb`, and `env.ts` reads `MONGODB_URI` and `MONGODB_DB`
independently, so a mismatch is a server that connects and serves an empty
database while reporting nothing wrong.

**Nothing to open in a firewall for this**, which is the point of loopback: the
database is reachable from this box and from nowhere else, so the only way in
is a shell on the machine. Authorization is switched on even so — a bug in the
API that let somebody run code as the service user should not additionally hand
them an unauthenticated database admin shell.

> **This step used to be a third console: a managed cluster's IP allowlist.**
> That deployment is over and the cluster is deleted. The failure it produced is
> worth remembering only because it is such a good disguise — every request
> waited five seconds for a connection it would never get, and the app reported
> it as a network error, which sends you looking at wifi.

---

## 4. On the box — one script

The checkout is already there from step 3, so this is the one line:

```
sudo /opt/steading/scripts/deploy/setup-box.sh api.swbuild.dev
```

It is idempotent — safe to run again after a failure or a change. It installs
Node 22, pnpm, the API's dependencies, a `steading` service user, the systemd
unit and Caddy, and it opens 80 and 443 on **the instance's own iptables**.

That last one is worth knowing about on its own. Oracle's Ubuntu images ship
with a REJECT rule in the INPUT chain and allow only SSH before it, and `ufw`
does not manage those rules — so `ufw allow 443` reports success and changes
nothing. This is the single most common way an Oracle deployment appears dead
after everything else was done right.

**Nothing here compiles.** `@node-rs/argon2-linux-arm64-gnu` and
`@esbuild/linux-arm64` are both in the lockfile as optional dependencies, so
ARM gets the right binaries and no toolchain is needed. Checked, not assumed.

**The script does not write any secrets.** It creates `/etc/steading/api.env`
empty at mode 0600 and tells you what goes in it — a script that generated or
copied secrets would leave them in a shell history or a log.

---

## 5. The two values

```
sudo nano /etc/steading/api.env
```

| | |
|---|---|
| `AUTH_SECRET` | 32 characters or more. `openssl rand -base64 48` |
| `MONGODB_URI` | The loopback string `setup-mongo.sh` printed at step 3, password included. Add `MONGODB_DB=` on its own line when the database is not called `steading` — this box's is `steadingdb` |

Two more are already in the file and should stay:

- **`TRUSTED_PROXY_HOPS=1`** — Caddy is in front and sets `X-Forwarded-For`.
  Fastify does not believe that header unless told how far to look, so without
  this `request.ip` is `127.0.0.1` for every request. **Every rate limiter in
  this service keys on `request.ip`**, so the auth limiter would count the whole
  internet as one caller and lock a farm out over a stranger's failed sign-in.
  A number rather than `true`, so a caller cannot forge past it by sending the
  header themselves.

  > **This number is a fact about your topology, and it is wrong in a different
  > way in each direction. Change it whenever you change what sits in front of
  > the service.**
  >
  > It is `1` because exactly one proxy — Caddy on this box — appends to
  > `X-Forwarded-For`. Put Cloudflare, an Oracle load balancer, or a second
  > reverse proxy in front and it becomes `2`. `fly.toml` sets `1` for Fly's own
  > single forwarding hop, for the same reason.
  >
  > **Too few, and the farm throttles itself.** Fastify takes the address that
  > many hops from the right, so with a real proxy in front and a count that is
  > short, `request.ip` collapses to the proxy for every caller. One stranger's
  > failed sign-in then rate-limits everybody — the exact failure this variable
  > exists to prevent, arrived at from the other side.
  >
  > **Too many, and a caller chooses their own address.** Counting past the
  > proxies you actually run means reading a header segment the client wrote, so
  > anyone can present a new `request.ip` per request and the auth limiter never
  > fires at all. That is the more dangerous direction by a distance: it is
  > authorization failing open (invariant 10), and unlike the throttling case
  > nothing about it is visible — the service looks perfectly healthy while the
  > password limiter has been switched off.
  >
  > Neither can be inferred from inside the process, which is why this is
  > configuration and why the default is `0`: trusting nothing is the answer
  > that fails closed for a service reachable directly.
- **`PORT=3001`** — what Caddy proxies to. Change both or neither.

Everything else in `apps/api/src/env.ts` has a default, and each feature it
switches on — Google sign-in, Play billing, the support loop — stays off and
says so rather than half-working.

**`AUTH_SECRET` signs every token. Changing it later signs every device out.**

**If your data is not in a database called `steading`, add `MONGODB_DB=` too.**
`env.ts` defaults it to `steading`, and the template above does not mention it —
so a cluster whose records live under another name connects successfully, serves
an empty database, and reports nothing wrong.

---

## 5b. The indexes, which nothing applies for you

```
pnpm db:indexes
```

**Run this once against the database, before the first real sign-up.** Nothing
in the service does it at boot — `applyIndexes` is only reached from
`pnpm db:indexes`, `pnpm db:seed` and `pnpm db:verify`, so a database that was
never seeded has no indexes at all and the service starts happily without them.

Two of them carry behaviour rather than speed, and both fail silently:

- **`users.email` is unique** — it is the duplicate-signup guard. Without it two
  accounts can hold one address.
- **The TTL indexes on `refreshTokens.expiresAt` and `invites.expiresAt`** are
  what make expired tokens and join codes delete themselves. Without them
  nothing expires and nothing complains.

It is idempotent, so run it again after any release that adds a collection.
Run it from a checkout with `MONGODB_URI` pointing at the cluster — the box, or
your own machine. `docs/OPERATOR.md` §4 has the rest.

---

## 6. Start it, and check from somewhere else

```
sudo systemctl start steading-api
systemctl status steading-api
```

Then from your own machine, not the box.

**On Windows, write `curl.exe` and not `curl`.** In PowerShell `curl` is an
alias for `Invoke-WebRequest`, which tries to parse the reply as a web page and
stops on a *"Script Execution Risk"* prompt instead of showing you anything.
Windows 10 and later ship the real thing at `C:\Windows\System32\curl.exe`; the
`.exe` is what gets past the alias.

```powershell
curl.exe -i https://api.swbuild.dev/health
```

```bash
curl -i https://api.swbuild.dev/health     # macOS, Linux, Git Bash
```

`-i` prints the status line and headers as well as the body, which is the
difference between "it did not work" and knowing which of five things to look
at. `{"ok":true}` and you are done with the server.

`/health` deliberately touches nothing — it opens no database connection — so a
green health check means the process is up and nothing more than that.

**What the reply tells you:**

| | |
|---|---|
| `200` and `{"ok":true}` | The process is running |
| Hangs, then times out | The Oracle ingress rule (step 2) |
| `Connection refused` | The port is open, Caddy is not running |
| A certificate error | `sudo journalctl -u caddy -n 50` — usually DNS was not ready when it asked |

### Then ask whether it can actually serve

```bash
curl -i https://api.swbuild.dev/ready
```

`/ready` opens the database connection `/health` does not. That distinction is
the whole point: Mongo connects lazily, so a wrong `MONGODB_URI` — an
unreachable host, a rejected password, a cluster that was paused — leaves the
process up and answering `/health` while every route that touches a record
fails. The two endpoints together tell you which half is broken.

| | |
|---|---|
| `200` and `{"ok":true,"database":"reachable"}` | Done with the server |
| `503` and `{"ok":false,"database":"unreachable"}` | The process is fine; `MONGODB_URI` or `MONGODB_DB` in `/etc/steading/api.env` is not |
| Takes about five seconds first | Normal — that is the driver's server-selection timeout on the first connection |

The reply says `unreachable` and nothing else on purpose. This endpoint needs no
token and is on the open internet, and a Mongo connection error names the host,
the replica set and sometimes the user. The reason is in
`sudo journalctl -u steading-api -n 50`.

`deploy.sh` polls `/ready` after every restart, so a deploy that cannot reach
the database fails at the deploy rather than at the first farm to log an egg.
Fly's health check stays on `/health`, because it is wired to a machine restart
and restarting a process fixes nothing about a database.
| `502 Bad Gateway` | Caddy is up, the API is not. `sudo journalctl -u steading-api -n 50` |

`502` is the likeliest one after a first run, because the service will not start
until `/etc/steading/api.env` has both values in it.

---

## 7. Point the app at it

`apps/mobile/eas.json` already carries `https://api.swbuild.dev` in the
`preview-farm` and `production` profiles. Build a tester APK:

```
pnpm --filter @steading/mobile exec eas login
pnpm --filter @steading/mobile exec eas build --profile preview-farm --platform android
```

EAS builds it and prints a URL. That URL is the link — message it, open it on
an Android phone, allow the browser to install once.

**The origin is compiled into the APK.** `boot/config.ts` reads it at boot and
there is no runtime setting, deliberately: a server address a stranger can talk
somebody into changing is a phishing surface. Pointing at a different server
means another build.

**Nothing but a promoted build will reach `/app`.** The deploy script resolves
the commit the box is serving to a `v<version>+<code>` tag with git — locally,
with no network — and asks GitHub only for the APK attached to that release.
So a build somebody runs from a laptop, or a hand-dispatched APK built at some
other commit, is invisible to it. `publish-apk.sh` checks the application id
again on the file that arrives, which is the only check on the hand-run path.

A release that changes no app code has no tag on its commit and publishes
nothing, which is what you want: the shelf keeps the APK it has until a commit
that actually produced one is deployed.

**This used to ask EAS** (`eas build:list --git-commit-hash`), which was the
remaining half of #153: the APK workflow moved to a GitHub runner so a build
quota could not refuse a release, and the box went on asking Expo — so a
runner-built APK never reached the shelf and nothing reported an error. The
commit is still the key, which is the property that made the EAS query right;
only the place the artefact is fetched from changed. `EXPO_TOKEN` is no longer
needed on the box at all.

---

## 7b. "Something is wrong" — turning it on for this box

The app's report button posts a bundle to whichever server it was built
against, and that server files it as a GitHub issue. Without a token and a repo
`/support` answers 501 and the handset says **this server has nowhere to file a
report**, then offers its share sheet instead. The share sheet works; it is not
the loop.

**This is configured per server, and that is the part that catches people.**
Setting it in a repo checkout on a laptop configures the laptop. The moment the
app is pointed at this box, the box's `/etc/steading/api.env` is the file being
asked — and `setup-box.sh` leaves both lines commented out, so a box that has
never been told is the normal state of a new one.

1. Make a fine-grained token at
   <https://github.com/settings/personal-access-tokens/new>:
   - **Repository access** → Only select repositories → `steading`
   - **Permissions** → Repository permissions → **Issues: Read and write**

   Nothing else. It files issues and that is the whole of what it can do.

2. On the box, uncomment and fill in the two lines the setup script left:

   ```
   sudo nano /etc/steading/api.env
   ```

   ```
   SUPPORT_GITHUB_TOKEN=github_pat_...
   SUPPORT_REPO=SteveWeed79/steading
   ```

3. Restart, because the environment is read once at startup:

   ```
   sudo systemctl restart steading-api
   ```

4. Check it from the PC without filing anything:

   ```
   curl.exe -s -o NUL -w "%{http_code}\n" -X POST -H "content-type: application/json" -d "{}" https://api.swbuild.dev/support
   ```

   **`400` is the good answer.** The route checks its configuration before it
   parses the body, so an empty body gets past the gate and is refused by the
   schema — which proves a token is set without creating an issue to prove it.
   `501` is the gate still closed. `Check my setup` runs exactly this probe and
   says which server it asked.

**Leave `SUPPORT_ACCEPT_RECORDS` alone while the repository is public.** It
governs the opt-in second half — the farm's own records — and a public tracker
is a public place to put them. The lean bundle is safe in public by
construction: structure and counts, never content.

---

## 8. Two devices, one farm

**Do the tablet first, and the order matters.** Everything on it today is
local-only — it has never had a server to reach — so an uninstall takes it.

1. **On the tablet, still on its USB dev build**, point it at the real server
   and sign up. Signing up claims the org the device already minted (D15) and
   flushes its queue, so the farm reaches the server without anything being
   retyped.
2. **Then** install the EAS APK on your phone and sign in with the same
   account. The records arrive by snapshot. That *is* the continuity test.
3. Farm → Members → mint a join code. Six characters, ten minutes, one use.
4. Redeem it on the second device rather than signing in, if you want a second
   person on the farm instead of a second device of your own.

**Your mother-in-law needs none of this.** First launch mints her own farm
(D14) and the whole app works with no account at all. She only needs one if she
wants it on two devices — which is also a real cross-tenant test with two live
farms, and the isolation suite has never had that.

### Billing does not stop you *yet*, and the day it does has an order

Writing is the paid thing (D13) and the paywall is built — the sync gate, the
entitlement rules and both comp mechanisms are all in the tree. What decides
whether it is *on* is configuration, and `apps/api/src/billing/access.ts` asks
in this order:

```ts
if (env.playConfig === null) return { syncing: true, refusal: null };
if (org !== null && env.freeSyncOrgs.has(org._id)) return { syncing: true, refusal: null };
if (org?.syncGranted !== undefined) return { syncing: true, refusal: null };
return entitlementOf(org?.subscription, Date.now());
```

**Today the first line answers.** `readPlayConfig` returns `null` unless *both*
`GOOGLE_PLAY_SERVICE_ACCOUNT` and `GOOGLE_PLAY_PACKAGE` are set, so this box
refuses sync to nobody, and `pnpm farm:grant` against it does nothing
observable. Note that a half-configured rail — one variable set, not the other —
leaves the paywall silently off rather than half-on.

#### The switch, and the trap in it

Setting both Play variables turns the gate on for **every farm at once**, and
`entitlementOf` refuses a farm with no subscription as `unsubscribed`. That
includes yours and every tester's. So the order is not optional:

```
pnpm farm:ls                                        # find the ids first
pnpm farm:grant <yourFarmId> --note "my farm"
pnpm farm:grant <testerFarmId> --note "tester"
```

**Comp the farms before the Play config reaches the box**, or the first restart
after configuring it stops your own sync — and it will read as the deploy having
broken something.

Nothing is lost when the gate does refuse: the handset's SQLite is untouched by
definition, the queue accumulates rather than dropping, and a farm that
subscribes later flushes everything it recorded meanwhile. A refusal is a 402
carrying a sentence, not a deletion.

#### Which comp to use

| | `FREE_SYNC_ORGS` | `pnpm farm:grant` |
|---|---|---|
| Lives in | the server's environment | the farm's own document |
| Takes effect | on restart | on the next request |
| Survives a database restore | yes | only if the backup has it |
| Use it for | you, permanently | testers, support, anyone temporary |

The env list is checked first, so an operator locked out of the database can
still let somebody through. Neither is reachable from the wire — *a grant that
can be requested is a grant that can be requested by anybody.*

`pnpm promo:new` is the third route and the only one a farm redeems itself: it
writes a real subscription with `source: 'promo'` rather than punching a hole in
the gate, so nothing downstream learns that promotions exist.
`docs/OPERATOR.md` §2 has the rest.

---

## Moving the database onto the box

**Done. This is the record of it, and of the reasoning that still governs the
`mongod` running today.** The live deployment ran on a free managed cluster,
was migrated with the two scripts below, and that cluster has since been
deleted — so a fresh box does step 3 and never has a second place to move from.

The reason for the move: the free tier was 512 MB with photos in GridFS. At
roughly 1 MB of records and 30 MB of photos per farm-year (§4.1) that is about
sixteen farm-years — and a farm photographing receipts and equipment gets there
much faster, against a box with tens of gigabytes spare and no bill either way.

This is what `ACCESS-AND-BILLING.md` §4.1a always described: Fastify and MongoDB
on one free instance.

**One consequence worth carrying:** every ceiling argument that named 512 MB
died with the cluster, and the constraint is now the box's own disk — `df -h /`.
`db:usage`'s 10 GB photo-bytes warning was always reasoning about `mongodump`
size on a self-hosted `mongod`, so it is the right signal here rather than a
threshold twenty times the capacity it was watching.

### A standalone, not a replica set

Checked rather than assumed. Multi-document transactions and change streams both
require a replica set; this service uses neither. Every write is a single
document, sync idempotency is one `upsertOne` with `$setOnInsert`, and nothing
tails an oplog. GridFS works standalone. So one `mongod` is the correct shape
here, not a compromise — and one process to reason about instead of three.

### One API process per farm, and that one IS load-bearing

The standalone above is a free choice. This one is not, and it is written down
here because nothing in the code can enforce it.

Hydration pages on `(serverTs, _id)` and a device advances its watermark past
everything it has read, so a row must never become visible carrying a value
below a watermark already published. `apps/api/src/sync/commit-order.ts` gets
that by serialising the stamp, the log write, the projection and the outcome
into one unit per farm — **in process memory.** Two API instances have two
locks and two clamps, and a mutation committed by one can land behind a cursor
the other has already handed out. The symptom is a record that simply never
reaches the second phone: no error anywhere, and only visible by noticing it is
missing.

The systemd unit runs one instance, and `deploy.sh` restarts rather than
overlapping, so this holds today. If a second instance is ever wanted — a
second box, a rolling deploy that overlaps, a process manager with more than one
worker — **the fix is not more locking.** It is a single-node replica set with a
transaction wrapping the number allocation and the insert, which is the one
construct that makes them one visible unit. That also reverses the decision
above, deliberately, and is the moment to do it.

### Two commands

**The first is step 3 on any box. The second had one job, has done it, and now
has no source to read from** — it is kept because a restore-into-a-new-box is
the same shape, and because the checks it makes are the ones worth copying.

```
sudo MONGODB_DB=steadingdb /opt/steading/scripts/deploy/setup-mongo.sh
```

**Pass `MONGODB_DB` if your database is not called `steading`** — the same value
that is in `/etc/steading/api.env`. The account it creates is granted on that
database *and only that one*, so getting it wrong means the restore in the next
step fails with "not authorized" against a database the account was never given.

Installs MongoDB 8, binds it to **127.0.0.1 only**, caps the WiredTiger cache at
2 GB so it does not compete with the API for the same 12 GB, turns authorization
on, and creates the `steading` account — printing its connection string once,
because the only place it should live is `/etc/steading/api.env`.

```bash
export MONGODB_DB=steadingdb
export ATLAS_URI="$(sudo grep -oP '^MONGODB_URI=\K.*' /etc/steading/api.env)"
export LOCAL_URI='<the string setup-mongo.sh printed>'

sudo -E /opt/steading/scripts/deploy/migrate-to-local-mongo.sh
```

**Exported, not written on the `sudo` line.** `sudo -E VAR=… script` passes
those assignments as *arguments to sudo*, so both connection strings — with
their passwords — sit in `ps` output for every user on the box while the
migration runs. Which is the exact thing the script's own header says it is
avoiding, and this document told you to do it the wrong way until somebody ran
it.

Counts every collection at the source, stops the API, dumps, restores with
`--drop`, counts again, and **refuses to declare success unless the two match
document for document**. Then applies the indexes.

Both URIs go through the environment rather than argv, because argv is visible
in `ps` to every user on the box — the same rule `backup-mongo.sh` and
`db:seed` follow.

**If your records are not in a database called `steading`, pass `MONGODB_DB`
too.** The connection string and the database name are separate settings in
this app — `env.ts` reads `MONGODB_URI` and `MONGODB_DB` independently — and a
managed cluster's string commonly names no database at all. The script settles
it once
rather than guessing twice: a URI that names a *different* database stops with
both names printed rather than migrating the wrong records, and the count it
compares before and after is taken against `MONGODB_DB` explicitly, so it
cannot compare an empty `test` against an empty `test` and call that verified.

**Stopping the API costs nothing here**, which is worth using rather than
attempting a live migration. The app is offline-first: a phone with no server
queues its mutations and flushes them when one returns, which is the ordinary
path exercised every time somebody logs eggs in a barn with no signal. A dump
taken while writes are landing is a dump that silently misses some.

### Never open 27017

Not in iptables, not in Oracle's security list, not in `bindIp`. An
internet-reachable MongoDB is found and ransomwared by automated scanners within
hours — among the most reliably exploited services there is. The API is on the
same box and reaches it over loopback.

Authorization is on even so. A bug in the API that let somebody run code as the
service user should not additionally hand them an unauthenticated database admin
shell.

### Afterwards

The advice here was to leave the old cluster alone for a week — a free,
off-site, known-good copy that cost nothing to keep until the box had proven
itself. **That week has passed and the cluster has been deleted.**

**So backups are yours, and nobody else has a copy. That is now literal.**
`scripts/backup-mongo.sh` is the job — dump, encrypt to a public key so the box
can write backups it cannot read, upload; `restore` is a subcommand of the same
script. §4.1a-i calls this a condition of the first real farm rather than a
nicety, and it was already true of the free managed tier, which has no automated
backups either — the difference is that there is no longer a second disk
anywhere that has ever held these records.

> **As of today this is not yet configured.** Both timers are installed and the
> script stops on the first variable it needs, so the state reports itself
> rather than failing quietly — but `STEADING_BACKUP_BUCKET` and
> `STEADING_BACKUP_RECIPIENT` are unset, which means **no backup has been
> taken**. One box, one volume, one copy. This is the top of the list before a
> farm that is not yours depends on it.

Enable `steading-backup.timer` **and** `steading-backup-check.timer` together —
"Before a farm that is not yours depends on this", below, has the settings and
the restore drill. The second timer is not optional decoration: without it a
backup that quietly stops is indistinguishable from one that is working.

**Photos stay in GridFS**, and that was re-argued rather than assumed once the
database moved — §4A.3 has the three reasons the box's own filesystem is not an
improvement, and the one clock this starts.

---

## How much of the box this actually uses

Worth knowing before spending an evening growing a disk, because the answer is
"almost none of it":

| | |
|---|---|
| Node 22, pnpm, the checkout and its dependencies | ~1.5 GB |
| Caddy, and its logs | rolls at 10 MiB × 5 |
| Farm records | ~1 MB per farm-year |
| Photos | ~30 MB per farm-year, in GridFS |
| SQLite | **none** — that lives on the handset |

The last two are on the box, because the database is. A default 46.6 GB boot
volume has roughly 37 GB spare — over a thousand farm-years. `df -h /` settles
it in a line, and it is the ceiling that matters now that no free-tier allowance
is in the picture.

Memory is the same story. The only component with a real appetite is argon2,
bounded per hash at 19 MiB and `parallelism: 1`, so a hundred *simultaneous*
sign-ins is under 2 GB — against a 90-day refresh token that makes sign-ins rare
by construction.

**Egress is the one free-tier resource this app can genuinely consume at scale**,
because photo bytes stream through the API in both directions. That is the number
to re-read in the console, not cores.

### If you do need to grow the disk

Three steps, and the middle one is the one people miss — a resized volume does
not change `lsblk` until the device is rescanned, so `growpart` reports
`NOCHANGE` and looks like a failure:

```
# 1. Console: Block Storage -> Boot Volumes -> Edit -> new size
# 2. Make Linux notice
sudo dd iflag=direct if=/dev/sda of=/dev/null count=1
echo 1 | sudo tee /sys/class/block/sda/device/rescan

# 3. Partition boundary, THEN the filesystem inside it. Only the first leaves
#    the space unusable and looks like the resize did nothing.
sudo growpart /dev/sda 1
sudo resize2fs /dev/sda1        # ext4. `sudo xfs_growfs /` if df -Th says xfs
```

---

## Deploying

Two halves, and they are deliberately separate: **you decide when something
ships; the box works out how to fetch it.**

```
sudo cp /opt/steading/scripts/deploy/steading-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now steading-deploy.timer
systemctl list-timers steading-deploy
```

That is the box half, once. It then checks for a new release every five
minutes, and a check that finds nothing costs one `git fetch` and exits.

### The box pulls; GitHub is never given a key

The obvious shape is an SSH step in the workflow — a private key in GitHub
Secrets, port 22 open to the runner ranges, the runner driving the box. It
trades a real property for convenience: **GitHub would hold a credential that
opens a shell on the machine with every farm's records on it**, and the ranges
it would have to be reachable from are large enough to be the internet.

Pulling inverts that. Nothing inbound is opened, there is no key anywhere for a
leaked token to expose, and the only thing GitHub can do is move a branch. The
cost is up to five minutes of latency — which, for an app whose clients queue
offline by design, is not a cost.

### `release`, not `main` — and shipping is a button

The box follows a branch called **`release`**, and nothing moves it on its own.

**GitHub → Actions → CI → "Run workflow"**, pick the branch, go. That re-runs
every check against that exact commit and moves `release` only if they all
pass. It works from the phone app, so shipping needs no laptop and no checkout.

```
merge a PR into main
        ↓
CI runs verify on main          (nothing ships — this is just the check)
        ↓
you test it on the tablet
        ↓
Actions -> CI -> Run workflow   ← the deploy
        ↓
verify runs again on that commit; green moves `release`
        ↓
the box's timer picks it up within five minutes
```

**Why the button rather than shipping every green main.** Merging and shipping
are different acts, and the gap between them is where this project's real
defects have lived — the camera crash, the portrait lock, a VPN address
compiled into an APK, a systemd directive that let the port bind and then
killed the process. All of them passed CI. The server half is genuinely well
covered (a real mongod, the isolation suite, `db:verify`), but *the tests pass*
and *I have tried it on the tablet* are different claims, and this is where the
second one gets made.

**It is not a permanent shape.** Deleting the `if:` on the release job ships
every green main instead. Worth revisiting when the ceremony costs more than
the mistakes it catches.

There is **no `ref` input** on the form, deliberately: the dispatch UI already
has a branch selector and `actions/checkout` defaults to it in both jobs, so
what gets tested and what gets shipped cannot come apart. An input would have
been a second source of truth whose failure mode is testing one commit and
shipping another, with both steps green.

The push is a plain fast-forward with **no `--force`**, and that is the guard
rather than tidiness: `release` may only move forward. A promote that would
rewind the server — shipping an older commit over a newer one — fails instead
of quietly handing the box yesterday's code. To go back on purpose, revert
through the normal route, so what the server runs stays something that exists
in main's history.

`deploy.sh` refuses anything but a fast-forward too, so a box somebody edited in
place at 6am stops and says so instead of silently resolving it.

**The command-line equivalent is `git push origin main:release`** — but it
skips the re-verify, so the button is the better habit.

### A dev branch

Yes, and there are two versions of it depending on how much the box is carrying.

**While nothing depends on the server**, point it at a branch:

```
echo 'STEADING_REF=dev' | sudo tee /etc/steading/deploy.env
sudo systemctl start steading-deploy
```

`deploy.sh` reads that file, so the timer picks it up on the next tick. Put it
back to `release` — or delete the file — when you are done.

**Once somebody else is testing against it, don't.** Your tester's phone is
pointed at `api.swbuild.dev`, and repointing the box at `dev` repoints hers with
it. At that stage the second version is worth the hour:

- a second `A` record, `api-dev.swbuild.dev`, at the same box
- a second site block in the Caddyfile, proxying to `127.0.0.1:3002`
- a copy of the unit as `steading-api-dev`, with `PORT=3002`, its own
  `/etc/steading/api-dev.env`, and `MONGODB_DB=steading_dev` so it cannot touch
  real records
- a copy of the timer with `STEADING_REF=dev` against a second checkout

Twelve gigabytes and two cores carry both without noticing — the constraint was
never compute. **Use a separate database, not a separate collection prefix.**
The whole tenancy model is `scoped(orgId)` inside one database, and a dev farm
sharing that database with a real one is the exact thing every isolation test
in the repo exists to prevent.

### Do you ever `git pull` on the box?

**No — and doing it by hand is actively harmful.** The timer runs `deploy.sh`,
which fetches and fast-forwards for you. The only manual `git` on that box is
the `git clone` in step 3, once.

The reason it matters: `git pull` there moves the checkout to **`main`**, which
is ahead of the CI-gated `release` ref. Every deployment afterwards would find
the release commit is an *ancestor*, report "nothing to deploy", and exit
happily — while the box quietly serves code CI never passed. Silent, and
permanent until somebody notices.

`deploy.sh` now refuses that case explicitly and prints the way back rather than
reporting success. But the short version is: let the timer do it.

To force a deployment now instead of waiting up to five minutes:

```
sudo systemctl start steading-deploy
```

### Watching it

```
journalctl -u steading-deploy -n 50        # what the last runs did
journalctl -u steading-deploy -f           # follow the next one
systemctl list-timers steading-deploy      # when it last ran, when it next will
```

A failed deployment leaves the previous version running and prints the last
thirty lines of the API's log plus the command to go back. It does not roll back
by itself: the new code may be fine and the database unreachable, in which case
reverting fixes nothing and hides which of the two it was.

---

## Editing files on the box from Windows (WinSCP)

`/etc/steading/api.env` holds an auth secret, a database password and a GitHub
token. None of those is typeable and all of them arrive by copy and paste, which
is precisely what `nano` in an SSH window is worst at. WinSCP opens the file in
a normal Windows editor where Ctrl+V does what it says.

### 1. Install and connect

<https://winscp.net/eng/download.php> — the Installation package.

| | |
|---|---|
| File protocol | **SFTP** |
| Host name | the box's public IP |
| Port | 22 |
| User name | `ubuntu` |
| Password | *leave empty* |

**The key goes in Advanced → SSH → Authentication → Private key file.** Oracle
Cloud disables password login, so without a key this fails with *no supported
authentication methods available* and nothing about that message says "key".

Point it at whatever `ssh` already uses — `%USERPROFILE%\.ssh\id_ed25519`, or
the `.key` file downloaded when the instance was created. WinSCP will say it is
not a PuTTY key and offer to convert it; say yes and let it save the `.ppk`
beside the original. **It converts a copy — the original keeps working for
`ssh`.**

### 2. The part that will otherwise look like you got it wrong

`/etc/steading` is `0750 root:root` and the file inside it is `0600`. `ubuntu`
cannot read it, so a correctly configured WinSCP still shows **permission
denied** on that folder. That is the box being right, not the setup being wrong.

**Advanced → Environment → SFTP → SFTP server:**

```
sudo /usr/lib/openssh/sftp-server
```

Oracle's Ubuntu image gives `ubuntu` passwordless sudo, so this needs nothing
else. The path is Ubuntu's; on a Red Hat–family box it is
`/usr/libexec/openssh/sftp-server`.

**Every file operation in that session is now root.** There is no confirmation
step and no undo, so it is worth having only this one saved site pointed at this
one box rather than making it the default for everything.

Save the site so none of the above has to be found twice.

### 3. Edit, then check what you left behind

Navigate to `/etc/steading`, select `api.env`, press **F4**. Paste, save, close —
WinSCP uploads on save.

Then, in the SSH window:

```
sudo ls -l /etc/steading/api.env
sudo systemctl restart steading-api
```

**Expect `-rw------- 1 root root`.** An upload can come back `0644`, and a
world-readable file holding a database password is a worse outcome than the
typing this was meant to avoid. If it moved:

```
sudo chown root:root /etc/steading/api.env
sudo chmod 0600 /etc/steading/api.env
```

The service reads its environment once at startup, so nothing you edit here
takes effect until that restart.

### If you would rather not hand root an SFTP session

Leave the SFTP server setting alone, drop the file in `/home/ubuntu/` where
`ubuntu` can write, and put it in place with one command that is explicit about
mode and owner:

```
sudo install -m 0600 -o root -g root /home/ubuntu/api.env /etc/steading/api.env
sudo systemctl restart steading-api
```

Two steps instead of one, and the permissions cannot drift because they are
stated rather than inherited from whatever the upload felt like.

---

## Mail, and the DNS that decides whether it works

Without this there is no password reset: a farm that forgets its password waits
for somebody to run `pnpm db:password` on the box. It also finishes invites,
which have been able to mint a token and unable to send it since they were
built.

**Off until configured, and that is a supported state.** `/auth/forgot` answers
503 with a plain sentence rather than erroring at send time.

### 1. Decide what the mail comes from — this one is not technical

The domain is `swbuild.dev` and the app is called Steading. **A password reset
from a domain the farm has never heard of is indistinguishable from phishing,
and ignoring it is the correct response.** Cheaper to settle before the DNS
exists than after. Either the address says Steading, or the email body has to
work harder than any copy should have to.

Use a **dedicated sending subdomain** — `mail.` or `send.` — so a reputation
problem cannot reach whatever else the apex serves. And a **reachable reply
address, not `no-reply@`**: replies into a black hole are an engagement signal
against you, and for a one-person operation the replies are worth reading.

### 2. The provider

```
EMAIL_PROVIDER=resend           # or postmark
EMAIL_API_TOKEN=...
EMAIL_FROM=Steading <hello@mail.example.com>
EMAIL_REPLY_TO=hello@example.com
```

Resend to start: its free tier is three thousand messages a month against this
flow's handful, where Postmark's hundred is described as being for testing.
Postmark is the better answer on deliverability alone and is one variable away
if inbox placement ever disappoints — that is what the port is for.

`EMAIL_PROVIDER=log` writes the message to the journal instead of sending it,
for walking the flow on a box with no provider. It has to be chosen explicitly;
an unconfigured server refuses rather than pretending.

### 3. SPF, DKIM and DMARC — all three, and not optional

**This is the part that decides whether any of the above works**, and it is
configuration, so it can be got wrong quietly and discovered by a farmer who
never received their code. The large mailbox providers now reject
unauthenticated mail outright rather than filing it in spam. Transactional mail
is exempt from one-click-unsubscribe; it is **not** exempt from authentication.

Your provider's dashboard gives you the exact records. Three things to get right:

- **DKIM must be signed with your domain, not the provider's.** The classic
  failure is an ESP signing as `mailer.provider.com` while the From header says
  yours: DKIM passes, DMARC alignment fails, and the mail is rejected. Use the
  provider's own domain-verification flow, which publishes the record on your
  domain.
- **SPF on the sending subdomain**, not the apex, if you took the advice above.
- **DMARC** at least `p=none` with a reporting address to start, tightened to
  `quarantine` once the reports are clean.

Verify before you trust it: send yourself one and check the headers say
`spf=pass`, `dkim=pass` and `dmarc=pass` — Gmail's *Show original* is enough.

### 4. What is deliberately missing

**Bounce handling.** A hard bounce means the address is wrong or gone, and
nothing here knows that yet. It is the first thing worth adding once mail has a
webhook.

---

## The operations board, if you want one

One page that answers the questions the shell commands answer — who is
subscribed, which codes have been claimed, what builds are in the field, whether
the server is healthy, and which farms are quietly generating refusals — plus
buttons for `promo:new` and `farm:grant`.

**It is optional and it is off until you turn it on.** Nothing listens for it
unless the unit is running, and even then it binds `127.0.0.1`, so a box that
never adds the Caddy block below has no admin surface reachable from anywhere.

### An operator account

The board admits **operators** and nobody else — an owner's token is valid,
signed by this server, and still refused. Name one:

```
cd /opt/steading
sudo pnpm ops:admin you@example.com     # the account must already exist
sudo pnpm ops:admin --list              # who has it now
```

> #### This page used to tell you to run a mongosh line, and it was wrong twice
>
> It said the board admits `role: 'admin'` and gave you:
>
> ```
> db.getSiblingDB("steading").users.updateOne(
>   { email: "you@example.com" }, { $set: { role: "admin" } })
> ```
>
> **Do not run it.** Three things are wrong with it now, and the second is the
> one that costs you something:
>
> 1. **It grants nothing.** The board reads `operatorSince`, not the role —
>    `admin` is a *farm* role any owner can hand out from the Members screen, so
>    gating a cross-farm surface on it was an escalation. See `OPERATOR.md` §3.
> 2. **It demotes you.** `db:seed` makes you an `owner`; that `$set` makes you an
>    `admin`. On a single-farm box you were the only owner, so the farm now has
>    **zero**, and no remaining member can put it back —
>    `assignableRoles('admin')` is `['admin', 'hand']`, and promoting yourself is
>    refused as `self`. Repairing it needs another raw write.
> 3. **It names the wrong database.** `getSiblingDB("steading")` is hardcoded,
>    and this box runs `MONGODB_DB=steadingdb` — so on a correctly configured
>    server the write lands in a database nothing reads, which is the only reason
>    (2) has probably not already happened to you.
>
> If you did run it, check with `sudo pnpm farm:show <farmId>`: an owner-less
> farm shows nobody at `owner`. Put it back with the same shape of write against
> the right database, then use `ops:admin` for the board.

**The password comes out of a password manager and is never typed.** The whole
control rests on that entropy: the rate limiter bounds guessing and the operator
flag bounds who may ask at all, but neither helps against a password somebody
chose.

### The unit

```
sudo cp /opt/steading/scripts/deploy/steading-ops.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now steading-ops
curl -s localhost:3002/health          # {"ok":true}
```

It reads the same `/etc/steading/api.env`, which it must: a token minted against
a different `AUTH_SECRET` is not one this process will accept, and a different
`MONGODB_URI` would have it describing a server nobody uses.

### Reaching it

The honest default is **not to publish it at all** — `ssh -L 3002:127.0.0.1:3002
steading-box` and open `http://localhost:3002`. No certificate, no hostname, no
public port, and the board is reachable exactly by people who can already log
into the box.

If you would rather have a URL, it is its own site block on its own name — and
it goes in **`/etc/caddy/conf.d/`, never in the Caddyfile itself**:

```
sudo install -d -m 0755 /etc/caddy/conf.d
sudo tee /etc/caddy/conf.d/ops.caddy >/dev/null <<'EOF'
ops.example.com {
	# Optional and cheap. Breaks when your ISP rotates you, which is the
	# trade — a tailnet survives that and is one more daemon to run.
	@notme not remote_ip 203.0.113.4
	respond @notme 404

	reverse_proxy 127.0.0.1:3002
	encode zstd gzip
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

> #### This page used to say "append it to the Caddyfile", and a deploy ate it
>
> `deploy.sh` renders `/etc/caddy/Caddyfile` from the repository and installs it
> over the running one **on every tick** — which is deliberate, and is why a
> Caddyfile change reaches the box at all. A block appended by hand was therefore
> gone within five minutes, with `reloaded for api.example.com` as the only
> trace, and the board's URL started answering 404 for no reason anybody could
> see.
>
> Worse if you *prepended* it: the deploy reads the domain to render with as the
> first site block in the running file, so the API's config would have been
> rendered for `ops.example.com` and every handset would have lost its server —
> reported as a successful reload.
>
> The Caddyfile now ends its preamble with `import /etc/caddy/conf.d/*.caddy`,
> and the deploy creates that directory and never writes into it. If you already
> had a block in the Caddyfile, the next deploy keeps a copy at
> `/etc/caddy/Caddyfile.local-blocks.bak` and says so — move the block out of it
> into `conf.d` and reload.

**`TRUSTED_PROXY_HOPS=1` has to be right for this to mean anything.** With it
wrong, `request.ip` is `127.0.0.1` for every request and every limiter in the
service shares one bucket — which makes the sign-in limiter decorative and
reduces the board to a password alone. It is the same variable the API needs, so
a box that got it right already has it right here.

A separate hostname also means a separate certificate, which shows up in
Certificate Transparency logs the moment it is issued. `ops.` is a name worth
thinking about for that reason; the SSH tunnel avoids the question entirely.

### What it will not do

**No credential-changing actions.** `db:password` sets any account's password,
which makes a button for it an account-takeover primitive — equally true on
localhost, so it is not an argument about where the page is served from. It
stays on the shell, and the board says so on the page.

It also shows **counts and timings, never contents**: farm names and ids so you
can address one, and beyond that only numbers and dates. Nothing a farm wrote
reaches it, which is asserted rather than intended — see
`tests/isolation/ops-board.test.ts`.

---

## Keeping it going

```
sudo /opt/steading/scripts/deploy/deploy.sh
```

Pull, install, restart, and then **check that it actually came back** — a
`systemctl restart` returns when the process is spawned, not when it is
serving, so without the check a deploy that killed the server reports success.
The check asks `/ready` rather than `/health`, so "came back" means *reached the
database*, not merely *started*.

If it does not come back the script says which of the two failed. A process that
answers `/health` but not `/ready` is running the new code fine and cannot reach
Mongo, so it points at `/etc/steading/api.env` and does **not** offer the
rollback — going back would restore code that was never the problem. Otherwise
it prints the last thirty log lines and the command to return to the previous
commit.

It refuses to merge anything but a fast-forward, so a box somebody edited in
place at 6am stops and says so rather than resolving it silently.

### Before a farm that is not yours depends on this

A nightly backup. `scripts/backup-mongo.sh` dumps, encrypts to a public key —
so the box can write backups it cannot read — and uploads. `restore` is a
subcommand of the same script, and a tested restore is a rehearsed migration.

`ACCESS-AND-BILLING.md` §4.1a-i calls this a condition of the first real farm
rather than a nicety. That was right when a free managed tier held the data —
it has no automated backups either — and it is stricter now that the data is on
this box and the cluster is gone: **this script is the only thing that will ever
put a copy anywhere else.**

**The script existed for months with nothing running it**, which is the state
this section is really about: a backup that depends on somebody remembering to
type a command is not a control, it is an intention. Two timers close it.

#### Turning it on

Put the settings in their own file — not `api.env`, because the bucket
credentials have no business beside the auth secret and vice versa:

```bash
sudo install -m 0600 /dev/null /etc/steading/backup.env
sudo nano /etc/steading/backup.env
```

```
MONGODB_URI=…                    the same value api.env has
STEADING_BACKUP_BUCKET=s3://your-bucket/steading
STEADING_BACKUP_RECIPIENT=age1…  the PUBLIC half
AWS_ACCESS_KEY_ID=…              an IAM user that can only PutObject on the prefix
AWS_SECRET_ACCESS_KEY=…
AWS_DEFAULT_REGION=…
```

**No `STEADING_BACKUP_IDENTITY`.** The private half of the age key must never
be on this machine — that is the entire argument for encrypting to a public
key, and it is why a restore is a deliberate act performed somewhere else. Put
it in a password manager. You need it once, on the worst day.

```bash
sudo cp /opt/steading/scripts/deploy/steading-backup.{service,timer} /etc/systemd/system/
sudo cp /opt/steading/scripts/deploy/steading-backup-check.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now steading-backup.timer steading-backup-check.timer
sudo systemctl start steading-backup      # don't wait until 02:00 to find out
```

#### How you find out it stopped

`steading-backup-check` runs at 09:00 and **exits non-zero when the last
successful backup is more than thirty-six hours old**, which puts the box into
`systemctl --failed`. That is deliberate: there is no mail sender here and no
monitoring agent, so systemd's own state is the one channel an operator already
reads and any monitoring added later already watches.

```bash
systemctl --failed                          # a stale backup shows up here
systemctl status steading-backup-check
journalctl -u steading-backup -n 50
```

Thirty-six hours rather than twenty-four, so a run that started late — a
reboot, a slow dump, the timer's own randomised delay — is not reported as a
failure. A check that cries wolf is a check somebody disables.

The marker it reads is written **only after the script has read the uploaded
object back out of S3**. `aws s3 cp` exiting zero means the request succeeded,
which is not the same claim as the object being in the bucket at the size it
should be.

#### The restore drill, which stays manual

**Twice a year, and it is not automated on purpose.** A real restore test needs
the age identity, and the whole design is that the private half never exists on
this box — so nothing running here can perform one. That is a property to keep,
not a gap to close.

On a machine that is not this one, with the identity to hand:

```bash
export STEADING_BACKUP_IDENTITY=/path/to/age-identity
export STEADING_BACKUP_BUCKET=s3://your-bucket/steading
./scripts/backup-mongo.sh list
./scripts/backup-mongo.sh restore steading-2026-08-05T02-00-00Z.age
```

Restore into a **fresh** database and point a scratch API at it. The script
does not pass `--drop`, so a restore over live data cannot overwrite a current
record — but it can resurrect archived ones, and there is no reason to find
that out on the day you need the backup.

What the drill proves that the nightly job cannot: that the identity in the
password manager is the one that matches the recipient on the box. An `age`
keypair mismatch is invisible until somebody tries to decrypt, and by then the
backups it silently ruined are all of them.

---

## When something is wrong

| What you see | Where to look |
|---|---|
| `curl` hangs, no response at all | The Oracle ingress rule (step 2). Then the instance iptables: `sudo iptables -L INPUT -n --line-numbers` |
| Certificate error, or Caddy will not start | DNS. `dig +short api.swbuild.dev` must return the box. Then `journalctl -u caddy -n 50` |
| `{"ok":true}` but everything else fails | Ask `/ready`. A `503` there confirms the database: `systemctl status mongod` first, then a wrong `MONGODB_URI` or `MONGODB_DB` in `/etc/steading/api.env` |
| Service will not start | `systemctl status steading-api` then `journalctl -u steading-api -n 50`. Usually an empty `AUTH_SECRET` |
| Restarting in a loop | It stops itself after five in a minute. The reason is in `systemctl status` |
| Connects fine, but the farm is empty | `MONGODB_DB`. The default is `steading`; a cluster holding records under another name serves an empty one without complaining (step 5) |
| Two accounts on one email address, or nothing ever expires | `pnpm db:indexes` was never run (step 5b). Run it — it is idempotent |
| App says **Not set up** | The APK was built without an origin — that is `preview`, not `preview-farm` |
| Sync refused with a 402 | Billing, and only possible once `GOOGLE_PLAY_SERVICE_ACCOUNT` is set. With no Play config `access.ts` returns `syncing: true` for every farm, so a 402 here means something else |
| Deploy timer runs, nothing ever deploys | `journalctl -u steading-deploy -n 30`. Either the box is ahead of `release` — never `git pull` there — or git is refusing the checkout's ownership |
| `systemctl --failed` lists `steading-backup-check` | No backup for over 36 hours. `journalctl -u steading-backup -n 50` — usually `/etc/steading/backup.env` is missing a variable, or the IAM user cannot write the prefix |
| Everybody is rate limited at once, or one stranger locks the farm out | `TRUSTED_PROXY_HOPS` is lower than the number of proxies actually in front (step 5). `request.ip` has collapsed to the proxy |
| Password guessing is never throttled | `TRUSTED_PROXY_HOPS` is *higher* than the proxies you run, so callers are choosing their own `request.ip`. Nothing looks wrong; check the number against the topology |
| One farm sees another's records | Stop and report it. That is the invariant everything else is built on |

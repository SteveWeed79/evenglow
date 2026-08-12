# Putting the farm server on the internet

From a fresh Oracle Always Free instance to `https://api.swbuild.dev/health`
answering `{"ok":true}`, and then to two phones syncing one farm.

Follow it in order. Steps 1–3 are three different consoles and none of them can
be scripted from the box; steps 4–6 are the box, and only step 5b is not the
script; steps 7–8 are the app.

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
| A MongoDB Atlas cluster | The free M0 is fine to begin with |
| SSH access to the box | `ssh ubuntu@<the box's public IP>` |

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

## 3. Atlas — let the box in

Atlas blocks by IP by default. Network Access → Add IP Address → the box's
public address.

Until you do this every request waits five seconds for a connection it will
never get and then fails — and the app reports it as a network error, which
sends you looking at wifi.

---

## 4. On the box — one script

```
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/SteveWeed79/steading /opt/steading
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
| `MONGODB_URI` | The Atlas connection string, password included |

Two more are already in the file and should stay:

- **`TRUSTED_PROXY_HOPS=1`** — Caddy is in front and sets `X-Forwarded-For`.
  Fastify does not believe that header unless told how far to look, so without
  this `request.ip` is `127.0.0.1` for every request. **Every rate limiter in
  this service keys on `request.ip`**, so the auth limiter would count the whole
  internet as one caller and lock a farm out over a stranger's failed sign-in.
  A number rather than `true`, so a caller cannot forge past it by sending the
  header themselves.
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

Then from your own machine, not the box:

```
curl https://api.swbuild.dev/health
```

`{"ok":true}` and you are done with the server.

`/health` deliberately touches nothing — it opens no database connection — so a
green health check means the process is up, and it is still worth doing one real
request afterwards to prove Atlas is reachable.

---

## 7. Point the app at it

`apps/mobile/eas.json` already carries `https://api.swbuild.dev` in the
`preview-farm` and `production` profiles. Build a tester APK:

```
pnpm dlx eas-cli login
pnpm --filter @steading/mobile exec eas build --profile preview-farm --platform android
```

EAS builds it and prints a URL. That URL is the link — message it, open it on
an Android phone, allow the browser to install once.

**The origin is compiled into the APK.** `boot/config.ts` reads it at boot and
there is no runtime setting, deliberately: a server address a stranger can talk
somebody into changing is a phishing surface. Pointing at a different server
means another build.

---

## 8. Two devices, one farm

**Do the tablet first, and the order matters.** Everything on it today is
local-only — it has never had a server to reach — so an uninstall takes it.

1. **On the tablet, still on its USB dev build**, point it at the real server
   and sign up. Signing up claims the org the device already minted (D15) and
   flushes its queue, so the farm reaches Atlas without anything being retyped.
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

## Keeping it going

```
sudo /opt/steading/scripts/deploy/deploy.sh
```

Pull, install, restart, and then **check that it actually came back** — a
`systemctl restart` returns when the process is spawned, not when it is
serving, so without the check a deploy that killed the server reports success.
If it does not come back the script prints the last thirty log lines and the
command to go back to the previous commit.

It refuses to merge anything but a fast-forward, so a box somebody edited in
place at 6am stops and says so rather than resolving it silently.

### Before a farm that is not yours depends on this

A nightly backup. `scripts/backup-mongo.sh` dumps, encrypts to a public key —
so the box can write backups it cannot read — and uploads. `restore` is a
subcommand of the same script, and a tested restore is a rehearsed migration.

`ACCESS-AND-BILLING.md` §4.1a-i calls this a condition of the first real farm
rather than a nicety, and that is still right even with Atlas holding the data:
the free M0 tier has no automated backups either.

---

## When something is wrong

| What you see | Where to look |
|---|---|
| `curl` hangs, no response at all | The Oracle ingress rule (step 2). Then the instance iptables: `sudo iptables -L INPUT -n --line-numbers` |
| Certificate error, or Caddy will not start | DNS. `dig +short api.swbuild.dev` must return the box. Then `journalctl -u caddy -n 50` |
| `{"ok":true}` but everything else fails | Atlas Network Access (step 3), or a wrong `MONGODB_URI` |
| Service will not start | `systemctl status steading-api` then `journalctl -u steading-api -n 50`. Usually an empty `AUTH_SECRET` |
| Restarting in a loop | It stops itself after five in a minute. The reason is in `systemctl status` |
| Connects fine, but the farm is empty | `MONGODB_DB`. The default is `steading`; a cluster holding records under another name serves an empty one without complaining (step 5) |
| Two accounts on one email address, or nothing ever expires | `pnpm db:indexes` was never run (step 5b). Run it — it is idempotent |
| App says **Not set up** | The APK was built without an origin — that is `preview`, not `preview-farm` |
| Sync refused with a 402 | Billing, and only possible once `GOOGLE_PLAY_SERVICE_ACCOUNT` is set. With no Play config `access.ts` returns `syncing: true` for every farm, so a 402 here means something else |
| One farm sees another's records | Stop and report it. That is the invariant everything else is built on |

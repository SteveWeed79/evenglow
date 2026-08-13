# Pick up here

**Last worked: 12 August 2026.** The server is live. The app has not been
pointed at it yet, and that needs the tablet.

This file is a point-in-time note, not a spec. It goes stale by design — when
the two devices are syncing, the useful half of it has been spent and it should
be cut down or deleted. `DEPLOY-THE-SERVER.md` is the durable version.

---

## Done, and verified rather than assumed

`https://api.swbuild.dev/health` answers `{"ok":true}` over TLS from outside the
box. That single response covers DNS, both firewalls, Caddy's certificate, and
Fastify behind it.

| Checked | How |
|---|---|
| The whole request path | `curl https://api.swbuild.dev/health` from a machine that is not the box |
| Atlas reachable **from the service process**, not just the box | `POST /auth/login` with a junk email returned *"That email or password is not right."* — that route reads `users`, so a clean 401 proves the connection |
| The server data path against the real cluster | `pnpm db:verify` — 55/55, including cross-tenant isolation, idempotent replay, role refusals and archive-not-delete |
| Indexes on the real database | `pnpm db:indexes` reported *Indexes applied to "steadingdb"* |

## The facts this box actually runs on

| | |
|---|---|
| Host | Oracle Ampere A1, `aarch64`, 2 OCPU / 12 GB, Ubuntu 24.04 |
| Public IP | `147.224.207.159` |
| Hostname | `api.swbuild.dev` |
| DNS | **GoDaddy** holds the zone (`ns71`/`ns72.domaincontrol.com`). Vercel is only the registrar's tenant on the apex — a record added on Vercel's side would be ignored |
| VCN | `vcn-20260115-1714`, Default Security List, ingress on 22 / 80 / 443 |
| Atlas | cluster `steadingdb`, **database `steadingdb`**, M0 free, AWS us-east-1 |
| Checkout | `/opt/steading`, tracking `main` |
| Config | `/etc/steading/api.env`, mode 0600 — `AUTH_SECRET`, `MONGODB_URI`, `MONGODB_DB=steadingdb`, `TRUSTED_PROXY_HOPS=1`, `PORT=3001` |

**`MONGODB_DB=steadingdb` is load-bearing.** `env.ts` defaults it to `steading`,
and this cluster's database is not called that. Without the line the service
starts, connects, serves an empty database and reports nothing wrong.

**There is a systemd drop-in on this box that must not be lost yet:**
`/etc/systemd/system/steading-api.service.d/netlink.conf`. It adds `AF_NETLINK`
to `RestrictAddressFamilies`, without which the service binds its port and then
exits 1. The real fix is in PR #100; the drop-in can go once that merges and
`deploy.sh` has run.

---

## Next, and it needs the tablet

### 1. Build the tester APK — any machine with the checkout

```
pnpm --filter @steading/mobile exec eas login
pnpm --filter @steading/mobile exec eas build --profile preview-farm --platform android
```

`preview-farm`, **not** `preview`. The profile carries
`EXPO_PUBLIC_API_URL=https://api.swbuild.dev`, which is compiled into the APK;
`preview` leaves it empty and the sync chip reads *Not set up*. EAS prints a URL
and that URL is the install link.

### 2. Read the tablet's queue depth before touching anything

Settings → Sync. **Write the number down.** That is what should drain in step 3,
and it is the only way to tell a working first flush from a stalled one.

This is the *"first flush at volume"* case `ACCESS-AND-BILLING.md` §6 names.
`tests/offline/first-flush.test.ts` now covers it and passes, but that is a test
and this is a real farm's history. If it stalls, nothing is lost — the queue
accumulates rather than dropping.

### 3. The tablet first, still on its USB dev build

Sign up on the tablet **before any EAS APK goes near it**. Signing up claims the
org the device already minted (D15) and flushes its queue, so the records reach
Atlas without anything being retyped.

> **Installing the EAS APK over a locally-built one forces an uninstall** —
> different signing keys, `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — and an
> uninstall takes the farm. Pick one route per device and stay on it: local for
> the machine you develop on, EAS for anything handed to somebody else.

### 4. Then the phone

Install the EAS APK, sign in with the same account. The records arrive by
snapshot. **That is the continuity test** and the whole point of the exercise.

### 5. A second person, optionally

Farm → Members → mint a join code. Six characters, ten minutes, one use. Redeem
it on the second device rather than signing in, if the aim is a second person
rather than a second device.

**Billing will not stop any of this.** `access.ts` returns
`{ syncing: true, refusal: null }` whenever `playConfig === null`, which is this
server. No farm is refused sync and `pnpm farm:grant` does nothing observable
until Play is configured.

---

## Loose ends, honestly labelled

Told to do, never confirmed done — worth checking rather than assuming:

- [ ] **Reserve the public IP.** Instance → Attached VNICs → the VNIC → IP
      administration → Ephemeral → **Reserved**. An ephemeral address is
      released on stop/start, and losing it silently breaks the DNS record, the
      Atlas allowlist and the certificate at once. A plain reboot keeps it.
- [ ] **Dedupe `MONGODB_DB` in `api.env`.** It was written twice, both
      `steadingdb`, so the value is right and systemd takes the last one — but a
      later edit to the first line would be silently overridden.
      `sudo grep -c '^MONGODB_DB=' /etc/steading/api.env` should print `1`.
- [ ] **`rm -f /tmp/dbs.cjs`** — a throwaway script used to list databases.
- [ ] **Confirm the reboot survives.** `uptime -p` after a `sudo reboot`, then
      `/health` from elsewhere. The unit is enabled and the iptables rules were
      persisted, but neither has been observed surviving a restart.

Known and deliberately deferred:

- **No backups.** Atlas M0 shows `Backups: Inactive`, so the farm's 3.8 MB
  exists in one place. `ACCESS-AND-BILLING.md` §4.1a-i calls a tested restore a
  condition of the first real farm rather than a nicety.
  `scripts/backup-mongo.sh` is written and waiting on an S3 bucket and an `age`
  keypair — the public half goes on the box, the private half in a password
  manager.
- **Photos share the 512 MB M0 cap, and nothing warns in time.** Photo bytes
  live in GridFS in this same database (`blobsFor(orgId)`, bucket `photoBytes`),
  so they count against the tier's total. At the 200–400 KB the app resizes to,
  that is roughly **1,300–2,500 photos** before the cluster is full; `photoShape`
  permits 25 MB per photo, so ~20 would do it if anything ever escapes the
  resize path. When M0 fills, writes fail — and a farm sees rejected mutations,
  not "the server is full".

  `db:usage` watches for photo bytes past **10 GB**, which is twenty times this
  cluster's entire capacity, so that signal cannot fire first. Its reasoning is
  about `mongodump` size and is right for a self-hosted mongod; it is the wrong
  constraint for M0. Either add a capacity-aware warning, or treat Atlas Flex
  ($8/month, priced in §4.1a) or the S3 move (§4A) as due earlier than the
  documented signal implies.
- **Twenty-five VCNs in this tenancy**, nearly all duplicates on `10.0.0.0/16`,
  several created seconds apart in January. Only `vcn-20260115-1714` is live.
  They consume the tenancy's VCN limit, which is the kind of thing that makes a
  *future* instance fail to launch for no visible reason. Delete carefully —
  removing the wrong one takes this box's networking.
- **A leftover `UDP 5520` "Hytale Ingress" rule** on the live security list.
  Nothing listens on it, so it is a hole to nowhere rather than an exposure.
  Worth removing with the VCN cleanup.
- **After PR #100 merges:** run `sudo /opt/steading/scripts/deploy/deploy.sh`,
  then delete the netlink drop-in, then **re-run `pnpm db:indexes`** — that is
  what creates the unique partial index on `orgs.playPurchaseToken`, and it
  wants to exist *before* Play billing is configured, not after.

---

## When something is wrong

`DEPLOY-THE-SERVER.md`'s symptom table is the first stop. The three failures
this deployment actually hit, in case they recur:

| What you see | It is |
|---|---|
| Service binds then exits 1, five restarts, `uv_interface_addresses` errno 97 | The missing `AF_NETLINK`. The drop-in above, or PR #100 |
| Green `/health`, zero farms | `MONGODB_DB` — the database is `steadingdb`, not `steading` |
| Two accounts on one email, or nothing ever expires | `pnpm db:indexes` was never run against the real database |

Operational commands are in `OPERATOR.md`. `pnpm farm:ls` and
`pnpm farm:show <id>` both read `MONGODB_URI`, so they can run from any machine
with the checkout and a route to Atlas — not only from the box.

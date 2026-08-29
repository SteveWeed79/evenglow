# Adversarial audit — `scripts/deploy/`, August 2026

Companion to `AUDIT-2026-08.md`, which covered `apps/` and `packages/` and
deliberately did not cover this directory. That gap was found the way gaps
usually are: `rename-to-homefarm.sh` was run on a live box, failed halfway, and
took the API down for half an hour.

**These scripts run as root on a box that holds a farm's only server-side copy.
A bug here is an outage or a data loss, not a wrong number on a screen.**

Four reviewers, one per area. Every finding below was re-verified by hand
afterwards; ones that did not survive are not listed.

---

## The three that matter most

### D1 — Backups cannot succeed on any box these scripts build
`scripts/backup-mongo.sh:111` against `scripts/deploy/setup-mongo.sh`

Found independently by two reviewers. Three separate blockers, each fatal alone:

```sh
mongodump --uri="$MONGODB_URI" --archive="$plain" --gzip --oplog --quiet
```

1. **`--oplog` requires a replica set member.** `setup-mongo.sh` contains zero
   replication configuration — verified, `grep -c 'replSet\|replication'` returns
   `0` — and argues the point at length: *"A standalone, not a replica set, and
   that was checked."* The backup script's own comment says *"`--oplog` needs a
   replica set — run mongod as a single-node one"*, an instruction no script
   implements and no document repeats.
2. **The URI names a database.** `setup-mongo.sh` prints
   `…:27017/${DB_NAME}?authSource=admin`, and `mongodump` rejects `--oplog`
   against a database-scoped target.
3. **No privilege on `local`.** The account is created with `readWrite` and
   `dbAdmin` on one database — verified — and `--oplog` must read
   `local.oplog.rs`.

`mongodump` exits non-zero, `set -Eeuo pipefail` aborts before the upload, and no
archive is ever written.

*Fixed (commit `1f1a57c`): `--oplog` is gone, and the reason is written where the
next reader will look rather than left as a bare deletion. What it bought is not
lost in any way that matters here — every write this app makes is a single
document, so there is no cross-document invariant for a point-in-time snapshot to
protect, and the restore path drops `--oplogReplay` to match. Reinstating it means
a replica set, a backup role on `admin`, and reversing `setup-mongo.sh`'s recorded
decision: all three, or none.*

***Still unproven on the live box.** No backup has ever completed there, so the
only thing that will confirm this is a manual `backup-mongo.sh backup` before the
timer is enabled. That is an operational step, not a code one, and it is the
outstanding half of this finding.*

### D2 — Nothing installs the backup units, and the alarm is installed by the same missing step
`scripts/deploy/setup-box.sh`

`grep -c backup scripts/deploy/setup-box.sh` returns **0**. The documented build
is `setup-box.sh` then `setup-mongo.sh`; the four backup units are a manual copy
buried at `docs/DEPLOY-THE-SERVER.md:1289`.

The part that makes it silent: `homefarm-backup-check.timer` — the thing whose
entire job is to say *"no backup has completed"* — is installed by that same
missed step. `systemctl --failed` stays clean. A box with no backups and no
alarm is indistinguishable from a working one.

Together with D1: even after installing the units, every run fails. **Fix D1
before enabling the timers, or the only outcome is a nightly failed unit.**

*Fixed (commit `1f1a57c`): all four units are installed by `setup-box.sh`, and
`backup-check` is enabled immediately — with no marker it says "No backup has ever
completed on this box" and prints the command that fixes it, which is the true
state of a box that has just been built. `tests/unit/deploy-units.test.ts` asserts
it against the directory rather than against a list, so a fifth unit added later
cannot be forgotten.*

### D3 — `deploy.env` is sourced too late to override the two settings that matter
`scripts/deploy/deploy.sh:17`, `:19`, `:30`

```sh
17  REPO_DIR="${HOMEFARM_DIR:-/opt/homefarm}"
19  PORT="${PORT:-3001}"
30  [ -f /etc/homefarm/deploy.env ] && . /etc/homefarm/deploy.env
31  REF="${HOMEFARM_REF:-release}"
```

`HOMEFARM_REF` and `HOMEFARM_APP_ID` are read after the source and work.
`HOMEFARM_DIR` and `PORT` are read before it and cannot be set at all — the unit
carries no `EnvironmentFile`, so sourcing is the only channel.

**This is the mechanism behind the incident that prompted this audit.**
`setup-box.sh` rewrites the unit's ExecStart to the box's real path, so a box at
`/opt/steading` correctly invokes its own `deploy.sh` — which then looks for
`/opt/homefarm`, dies, and fails every five minutes for ever. The box cannot
deploy, so it cannot receive the fix for its own condition, and nothing surfaces
it but a failed unit.

*Fixed (commit `1f1a57c`): the file is sourced first, and `REPO_DIR` defaults to
the tree the script is running out of — `BASH_SOURCE` — rather than to a literal,
so a moved copy is self-locating even with nothing set at all. The literal remains
only as the last resort for a script invoked through a path that cannot be
resolved. Both properties are asserted in `tests/unit/deploy-units.test.ts`: every
setting is read after the source, by index.*

---

## Critical and High

### Migration scripts

- **D4** `--keep-db` printed a `dropDatabase()` command naming the **live**
  database. Introduced by this audit's own first fix and caught by it; the flag
  added to keep a box safe ended by offering a line that destroys the farm's only
  dataset, days later, with the box healthy. Now gated on a copy having happened.
  *Fixed, with a regression test verified red-then-green.*
- **D5** A re-run after a failed copy silently skips the copy **and clobbers the
  breadcrumb**. Step 5 rewrites `api.env` before step 6 copies, so a failed copy
  leaves `MONGODB_DB=homefarm`; on re-run `OLD_DB` reads back as `homefarm`,
  `COPY_DB=0`, and `cp -a "$f" "$f.pre-rename"` overwrites the only on-box record
  of the old name. The API then starts against a partial or empty database, and
  phones flush into it and mark those mutations `applied` — so the old database
  stops being a clean rollback. *Fix: never clobber an existing `.pre-rename`,
  and copy before rewriting.*

  *Fixed as prescribed, both halves. The database copy is now step 5 and the
  environment rewrite step 6, so a failed copy leaves the box exactly as it was —
  old name in `api.env`, old database untouched, and a re-run reading the same
  facts the first one did. And a `.pre-rename` that exists is kept: it holds the
  only on-box record of the old database name and of the Mongo password, and a
  second run replacing it makes the thing kept for recovery a copy of the thing
  it was meant to recover from.*

  ***The order is the fix and the non-clobber is the belt.** Either alone leaves
  a hole: reordering without the non-clobber still loses the record if a later
  step fails twice, and the non-clobber without the reorder still leaves a re-run
  silently skipping the copy while pointing the API at a database that was never
  made.*
- **D6** `OLD_DB`'s fallback is `steadingdb`, a name the code has never used —
  `databaseName()` returns `steading` before the rename commit and `homefarm`
  after. `setup-box.sh` leaves `MONGODB_DB` commented out by default, so the
  fallback is the common path, not the rare one.

  *Fixed by removing the guess. There is no safe one to make: the value decides
  which farm's records are copied, this script cannot see which default the
  installed build compiled in, and being wrong is silent. So an absent
  `MONGODB_DB` is now a refusal carrying the `listDatabases` command that
  answers it.*

  ***What a wrong guess did is not a wrong message.** It is `mongodump --db
  steadingdb` against a database that does not exist — which dumps nothing,
  restores nothing, passes the count check by comparing zero to zero (D7), and
  points the API at an empty database the script has just reported as verified.*
- **D7** The count check cannot fail when the source is empty:
  `a.getCollectionNames()` returns `[]`, `TALLY` is empty, the `while read` body
  never runs, and a copy that moved nothing reports verified. The sibling
  `migrate-to-local-mongo.sh` has exactly this guard.

  *Fixed with the sibling's guard, and a second one on the loop itself in case
  the tally's shape changes: a non-empty tally that yields no rows is a
  verification that verified nothing, which is the defect one layer up.*

  ***It covered for D6 exactly.** A wrong database name produces an empty source,
  and an empty source is what this check could not fail on — so the two together
  made a rename that copied nothing indistinguishable from one that worked.*
- **D8** Every old unit file is `rm -f`'d **before** anything checks the
  replacements exist. A checkout without the new units leaves the box with no API
  unit at all, after the database has been copied.

  *Fixed. The API's unit is required before anything is removed — it is the one
  whose absence leaves nothing to start — and the rest are named when the
  checkout does not carry them, rather than silently skipped one at a time after
  the deletions.*

  ***The recovery was among the casualties**, which is what makes this worse than
  it reads: the deploy timer that would have pulled a checkout containing the
  units is one of the eight that had just been deleted.*
- **D9** `migrate-to-local-mongo.sh` restores with `--drop` and never checks
  whether the local database is already live. A re-run after cutover destroys
  every mutation phones have flushed since — unrecoverably, because clients mark
  them `applied` and never resend (invariant 7).

  *Fixed. It reads the URI the API is actually configured with and refuses when
  that names this box — because while it still names Atlas this is a migration
  that has not landed, and a re-run is the ordinary retry `--drop` exists for;
  once it names the box the migration is done, and there is nothing to re-run,
  only records to destroy.*

  ***No `--force`.** A flag here has exactly one use, which is the accident it
  would cause, and the recovery it would need does not exist — Atlas has none of
  those records either, because nothing has written to Atlas since the URI
  changed. The refusal offers a verified backup instead.*

### Provisioning

- **D10** `setup-mongo.sh` has **no `trap`**. Any death inside the auth-disabled
  window — a failed restart, `wait_for_mongo`'s `die`, a dropped SSH session
  during its 30s of sleeps — leaves `authorization: disabled` on disk with
  `mongod` enabled, so **the database comes back unauthenticated on every
  reboot, indefinitely**. The comment justifying the window reasons only about a
  first run, then the next paragraph withdraws that premise by making the window
  run every time.

  *Fixed (commit `851c9ff`). A trap armed before the window opens and cleared
  only once the verification has passed, so the enabled config is the exit
  invariant. Exercised under a die inside the window, a SIGHUP inside the window,
  a die after the close, and the clean path — all four leave `enabled`.*
- **D11** The "authorization is on" verification passes when mongod is simply
  unreachable — it `die`s only when the unauthenticated read *succeeds*, so every
  other outcome reads as proof of enforcement.

  *Fixed alongside D10 (commit `851c9ff`). Reachability is established first and
  separately: a mongod that is not answering is now its own `die` with its own
  sentence, because a check that cannot tell "locked" from "gone" is not a check.
  `wait_for_mongo` closes the same hole from the other side — it used to return 0
  for a unit systemd called active that had failed fifteen pings.*
- **D12** A re-run with a different `MONGODB_DB` never grants the account on that
  database; `EXISTS` keys on the user's name only.

  *Fixed. The "already exists" branch now asks the second question — does this
  account hold `readWrite` on **this** database — and grants both roles when it
  does not. `grantRolesToUser` with a role already held is a no-op, so the
  ordinary re-run where nothing changed is untouched.*

  ***What it produced was not a box that failed to start.** The API connects,
  authenticates against `admin` perfectly well, and then every query comes back
  `not authorized on <db>` — a box that provisioned cleanly, said so, and could
  not read or write one record. A rename, a second farm, or a rebuild against a
  new name all reach it.*

  *The grant sits inside the auth-disabled window, which is the only place the
  command is permitted, and before the window is closed and verified — so a grant
  that fails cannot leave authorization off. Asserted by position, not by
  reading.*

### Deploy path

- **D13** A deploy that dies after the fast-forward is **never retried**.
  `CHANGED` is derived from whether HEAD moved *this tick*, not from what is
  running, so the next tick prints "nothing to deploy" and exits 0 — for ever.
  New code on disk, old code in memory, green timer.

  *Fixed. The box writes the commit it last got all the way through on —
  `/var/lib/homefarm/deployed-sha`, written the moment `/ready` answers — and a
  tick is "nothing to deploy" only when HEAD is at the release ref **and** that
  ref is what is actually running.*

  *A box that has never written the marker, which is every box already deployed,
  reads it as empty and does one full pass. One extra install and one restart,
  once, and then it settles. Asserted, because it is what the first tick after
  this ships will do.*

  *The marker is written before the Caddy verdict rather than after: Caddy being
  wrong does not make the API undeployed, and withholding it would reinstall and
  bounce the API every five minutes over a web-server config — which is the exact
  churn `CHANGED` exists to stop.*
- **D14** `systemctl reload caddy` is unguarded and sits between the checkout and
  the API restart, so a refused reload skips the restart of code already
  installed — and `cmp -s` then reports "unchanged" on every later tick.

  *Fixed. The reload is guarded and its two outcomes are named — deferred rather
  than ignored, because the verification immediately below asks Caddy's admin API
  what is **actually loaded**, which is a stronger question than this exit code
  answers: a reload returns 0 for a signal delivered, not for a config accepted.*

  *That verification block was added earlier in this audit for the ten-day `/app`
  404 and closes the other half of the same hazard. This one is the half where
  the reload does not return 0 at all, and under `set -e` that killed the script
  where it stood.*
- **D15** The readiness probe is gated on `CHANGED`, so on a box where the
  release ref has not moved, nothing on the box ever checks the API. Combined
  with `StartLimitBurst=5`, an API that dies stays dead while the deploy timer
  reports success every five minutes.

  *Fixed. The probe is unconditional, and on a quiet tick a failure is acted on
  rather than reported: `reset-failed` first — a start limit systemd has hit is
  precisely why nothing is retrying, and a plain restart against one is refused —
  then one restart, then the same diagnosis any failed deploy gets. A box that
  cannot be revived leaves `homefarm-deploy.service` in `systemctl --failed`,
  which is what `check-box.sh` reads.*

  ***The closing advice had to change with it.** That block offers a rollback to
  `$WAS`, and on a quiet tick `$WAS` is `$NOW` — so it would have proposed a
  checkout of the commit already running as the repair for that commit not
  running. It now says which situation it is in.*

  *Both halves are red-proofed against the old code: with the `CHANGED` gate
  restored, `curl` is not called once on a quiet tick.*
- **D16** The API binds `0.0.0.0` while the Caddyfile states *"The API binds
  127.0.0.1 through this proxy"*. Exposure rests entirely on two firewalls, one
  of which `setup-box.sh` says it cannot reach. `ops.ts` gets this right with
  `OPS_HOST ?? '127.0.0.1'`; the API has no equivalent knob.

  *Fixed with the knob `ops.ts` already had: `API_HOST ?? '127.0.0.1'`, same
  default and same sentence, so it is one rule rather than two decisions.
  `API_HOST=0.0.0.0` is there for a container, where loopback is the container's
  own and a published port would otherwise reach nothing.*

  ***This changes what an existing box is reachable on**, and it is worth saying
  plainly: anything talking to `:3001` directly rather than through Caddy stops
  working. On the deployment this repository builds, nothing does — Caddy
  reverse-proxies to `127.0.0.1:3001` on the same machine, and `deploy.sh` probes
  the same loopback address.*

  ***`ops.ts`'s own comment was the clearest statement of the defect** and is
  corrected with it. It justified its loopback default by contrast with an API
  that *"listens on `0.0.0.0` because it must be reachable"* — a premise that was
  never true here. What binding every interface actually bought was a second door
  past Caddy, past TLS, and past whatever the proxy does about headers and rate
  limits.*

### Backup and release

- **D17** The archive's content is never verified — only that it exceeds 4096
  bytes, a constant with no relation to the source. A farm database with photos
  is hundreds of megabytes; a 5 KB archive passes, uploads, and moves the marker.

  *Fixed at both ends. The floor is now derived from the source — `db.stats()`
  says what this database holds, and gzip on BSON does well but not fiftyfold, so
  an archive under a fiftieth of it is not a copy of it. Deliberately loose: this
  guards against a collapse, not against a compression model, and a false alarm
  here fails a backup that was fine. The 4096 constant stays as an independent
  lower bound rather than as the check.*

  *And the archive is read back before it is uploaded. `mongorestore --dryRun`
  walks the whole file and reports what it would restore without writing, so a
  truncated dump — what a killed `mongodump` leaves — is caught here rather than
  on the day somebody needs it. Guarded on the flag existing, because the tools
  come from a distribution package this project does not pin and a verification
  that fails a good backup is worse than one that is skipped and says so.*

  ***This and D18 made each other invisible.** The likeliest way to produce a
  five-kilobyte archive was a correct dump of the wrong, empty database.*
- **D18** The backup dumps whatever database the **URI path** names, while the
  rest of the codebase treats that path as cosmetic and selects on `MONGODB_DB`.
  After a `--keep-db` rename, or on any box where the two disagree, it backs up
  the wrong database and reports success.

  *Fixed. The name is resolved exactly as `databaseName()` resolves it, the path
  is stripped out of the URI so `--db` is the only thing naming a database, and
  the success line says which one it took. Asserted **against `databaseName()`
  itself** rather than against a restatement of its rule, so a change to the
  API's fallback fails the backup's test.*

  *When the two disagree it says so on the way past, because the operator almost
  certainly believes the URI is the one that counts. It is not — here or in the
  API — and `backup.env` being a separate file from `api.env` is what makes them
  drift: two halves edited at different times by different steps.*

  ***The restore path had the mirror of this and is documented rather than
  changed.** `mongorestore --archive` restores each namespace under the name it
  was dumped as, so pointing the URI at a differently-named target does not move
  it. Renaming on restore is `--nsFrom`/`--nsTo` and is a deliberate act with its
  own arguments; guessing at it inside the one path that runs after a farm has
  already lost data is the wrong place to be clever. It now says where the
  records will land and how to put them elsewhere.*

  *`homefarm-backup.service` documents `MONGODB_DB` beside `MONGODB_URI`, which
  it did not.*
- **D19** Both identity checks on a published APK sit inside
  `if command -v unzip`, and nothing installs `unzip`. Without it, any zip named
  `.apk` is published as the farm's app — the exact failure the file says was
  *"found by publishing this repository's README as a build."*

  *Fixed at both ends. The checks are unconditional, and a missing `unzip` is now
  its own refusal rather than a reason to skip them — skipping is failing open on
  the question "is this our application". The cost of refusing is bounded and
  loud: the shelf keeps the APK it has, `deploy.sh` notes it could not publish,
  and the API is untouched.*

  *`setup-box.sh` installs it, **unconditionally** — which is its own small
  finding. The base packages (`ca-certificates curl gnupg git`) are installed
  inside the Node block, so a box that already had Node got none of them. That is
  the shape of dependency that goes missing exactly where nobody is looking, and
  it is why this one was.*
- **D20** A failed asset upload leaves a published release with no APK, and that
  tag is then refused for ever, so the box serving that commit never gets an app.

  *Fixed, and it heals the state as well as preventing it. The step counts the
  APKs on a release rather than asking only whether one exists, so:*

  - *exists **with** an APK → still refused, which is the collision the guard was
    written for: two different builds sharing a name;*
  - *exists **with none** → the wreckage of a failed upload, so it uploads into
    it, which is the repair;*
  - *still empty after the upload → this run produced the stranded state itself,
    so the release is removed and the tag is free for the next run rather than
    blocking every one of them.*

  ***The git tag goes only when this run created the release.** One that was
  already there belongs to whoever made it, and `deploy.sh` resolves a commit to
  a tag with git before it asks GitHub anything — deleting somebody else's would
  change what the box resolves to. Asserted by position: `--cleanup-tag` sits
  inside that guard.*

---

## Medium and Low

Secrets on `argv` — the Mongo password reaches `ps` in `setup-mongo.sh`,
`backup-mongo.sh`, `migrate-to-local-mongo.sh` and `rename-to-homefarm.sh`, in
each case against an explicit written rule that it does not (D21).
`publish-apk.sh` exits 1 after a completely successful local publish, because its
EXIT trap ends on a false test (D22). The backup and its checker both catch up at
boot with no ordering between them, so the check reads a marker the backup has
not written yet and reports a false failure (D23). `setup-box.sh` prints
"installed iptables-persistent and saved" whether or not either happened, so a
box whose rules were not saved is unreachable after its next reboot and the
operator has been told otherwise (D24). `setup-box.sh` writes
`/etc/caddy/Caddyfile` unvalidated and escalates a refused reload into a restart,
turning a rejected config into a total outage (D25). `Persistent=true` on the
deploy timer is a no-op — it applies only to `OnCalendar=` timers — while its
comment claims catch-up behaviour (D26). Root writes a fixed-name file in shared
`/tmp` from a unit with no `PrivateTmp` (D27). `GITHUB_TOKEN` in `deploy.env` is
sourced but never exported, so the private-repo recovery path documented beside
it cannot work (D28).

---

## What was checked and found sound

The `pnpm install --filter` question raised by the live incident: `tsx` is a
direct dependency of `apps/api`, not only a root devDependency, so the filtered
install keeps it — confirmed on the box, where `/opt/homefarm/node_modules/tsx`
survived the prune. Install-page rendering interpolates only machine-local
values. Caddy's `handle_path` + `file_server` is traversal-safe, no ops block is
rendered, and the ops process binds loopback by default. The APK pipeline's
version-bump ordering is correct — the bump is committed before the promote, and
the sha recorded only after the push succeeds. `check-backup.sh` reads a marker
rather than S3 deliberately and correctly, and fails closed on a missing or
non-numeric value. `git safe.directory`, `chown -R` symlink handling, and the
`[ … ] && …` interactions with `set -e` were each tested rather than assumed.

---

## Suggested order

1. **D3** — one line moved. Un-wedges any box not at the default path.
2. **D1 + D2** — drop `--oplog`, install the units in `setup-box.sh`. Until both
   land, no box these scripts build has ever had a backup.
3. **D10** — a `trap` around the auth-disabled window.
4. **D5, D6, D7, D8** — the rename script's remaining half-state paths.
5. **D13, D14, D15** — the deploy path's silent-success paths.

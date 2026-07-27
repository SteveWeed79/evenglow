# Storage conformance suite

These suites are the conformance tests for `apps/app/src/db/port.ts`. They ran
against the IndexedDB implementation D9 retired, and they run unchanged in
substance against the SQLite one — which is the point. A store is correct when
it passes this suite; nothing else is the definition.

They exercise the **real** store, not a fake, through `tests/support/sqlite.ts`:
`node:sqlite` behind the same `SqlDriver` the Capacitor plugin implements, on a
real file in a temp directory. Same SQL, same transactions, same migration
ladder.

What they prove:

- sequence monotonicity, including across a restart and a lost counter
- one BEGIN, both writes, one COMMIT — a failed projection write rolls the
  outbox row back with it (invariant 5)
- single-flight, in-order, capped flushing
- poison-batch parking at the attempt ceiling
- corruption quarantine, in both the outbox and the projection
- the integrity check, and that a user discard does not later read as loss
- pull refusing to clobber a pending local edit
- sign-out clearing every table (C5)

## What this cannot prove

Durability under an Android force-stop. `synchronous = FULL` is what makes that
survivable, and it is set identically here and on the device, but only hardware
can demonstrate it. The Phase 2 device gate stays in the plan for that reason.

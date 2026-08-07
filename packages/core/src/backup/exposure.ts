import { localStore } from '../db/store';

/**
 * How exposed this farm's records are, in one cheap read.
 *
 * A2.3 says an account is asked for at three moments and no others — not a
 * timer, not a nag, not a modal — and names the third as *"enough data to hurt
 * losing"*. That moment was never implemented. What existed was one Settings
 * row reading "Everything is on this phone only", which is true, which is also
 * true on day one about four records, and which is therefore wallpaper by the
 * time it means anything.
 *
 * This is the missing condition, stated so a screen can ask it.
 *
 * ## What "exposed" actually means
 *
 * **Nothing has ever reached a server**, which is `lastSyncAt === null` and is
 * exactly the right test rather than "has no account". A farm whose card
 * lapsed still has a copy on the server and can pull it back — `GET /snapshot`
 * is deliberately ungated on billing — so it is not exposed and must not be
 * told it is. A farm with an account that has never once flushed, because it
 * is on the free tier, *is* exposed, and the phrase "has an account" would
 * have missed it.
 *
 * **And enough records that losing them would hurt.** A count rather than a
 * span of days, which is the weaker of the two measures and is chosen anyway:
 * the span needs a scan of every record on a screen that renders every
 * morning, and `countRecords()` is one query. The number is picked to sit
 * above a setup burst and below a season — a big farm's groups, animals,
 * machines and beds come to a few dozen, while daily egg and feed logging
 * alone reaches this in about three months.
 *
 * **Records, not mutations, and that distinction was got wrong first.** The
 * cheapest read here is `counts()`, which the sync chip already makes — but it
 * counts outbox rows, and on a never-synced farm a group created and then
 * edited three times is four of those and one record. A strip reading "1,540
 * records" about roughly 1,200 of them would be the app overstating the very
 * thing it is asking somebody to act on.
 *
 * ## Why it goes quiet, and why not with a button
 *
 * It stops when the farm does something that actually helps: signs up and
 * syncs, or takes a backup. There is no dismiss.
 *
 * `WeatherWarnings` sets out why a dismissible strip is wrong and three of its
 * four reasons apply here unchanged — a stored "I saw this" is the completion
 * flag the due engine refuses, it drifts from what it describes, and the reflex
 * it trains gets used on the row that mattered. The fourth does not apply and
 * is what makes this different: a weather warning has nothing to act on, and
 * this one has two things, both of which end it honestly.
 *
 * A backup goes stale, so it comes back. `BACKUP_GOOD_FOR` is that patience —
 * long enough not to be a nag, short enough that "your last copy is from
 * February" is not what somebody discovers in September.
 */

/**
 * Records that would hurt to lose.
 *
 * Two hundred. A farm setting itself up — every group, every animal named,
 * every machine, every bed — lands in the low dozens; anything past that is
 * accumulated mornings. Eggs and feed logged daily is two records a day, so
 * this is a season, which is the unit `docs/ROADMAP.md` uses when it argues
 * that a year of comparison is the app's whole second-year value.
 */
export const EXPOSED_AT = 200;

/** How long a backup counts as protection. Ninety days. */
export const BACKUP_GOOD_FOR = 90 * 24 * 60 * 60 * 1000;

export interface Exposure {
  /** Whether to say something. Everything below is why. */
  exposed: boolean;
  /** How many records are on this handset and nowhere else. */
  records: number;
  /** When a backup was last taken from this device, or null for never. */
  lastBackupAt: number | null;
  /** Whether anything has ever reached a server. */
  everSynced: boolean;
}

export async function readExposure(now = Date.now()): Promise<Exposure> {
  const store = localStore();

  const [records, lastSyncAt, lastBackupAt] = await Promise.all([
    store.countRecords(),
    store.getLastSyncAt(),
    store.getLastBackupAt(),
  ]);

  const everSynced = lastSyncAt !== null;
  const backedUpRecently = lastBackupAt !== null && now - lastBackupAt < BACKUP_GOOD_FOR;

  return {
    exposed: !everSynced && !backedUpRecently && records >= EXPOSED_AT,
    records,
    lastBackupAt,
    everSynced,
  };
}

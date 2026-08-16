/**
 * How old is too old, and who decides.
 *
 * `[23]` and `[24]`. Two facts about this app make a version floor necessary
 * rather than tidy. **Sideloaded installs have no updater**: a farm that
 * installed from the shelf gets a fix when somebody tells it to go and get
 * one, which is to say when somebody notices. And **the wire keeps changing in
 * ways an old client cannot model** — the entity list widens, and `null` now
 * means *clear this field*, which a build that predates it will project into a
 * record its own schema then refuses to parse.
 *
 * Neither is a reason to lock anybody out on a whim, and the default here is
 * that there is no floor at all. What this buys is the ability to say, on the
 * day it matters, *"that build cannot read what this farm now holds"* — with a
 * sentence rather than with a device that quietly disagrees with the others.
 *
 * ## What a refusal must not do
 *
 * Nothing is dropped. A batch refused for being too old stays queued exactly as
 * a batch refused for a lapsed subscription does — the mutations are valid, the
 * client is old, and the day the app is updated they all go up. That is why
 * this is a `SyncRefusal` and not a rejection: a rejection goes to the inbox as
 * something a person must decide about, and there is nothing here to decide.
 *
 * ## Comparison, and why not a dependency
 *
 * Versions here are `major.minor.patch` and nothing else — no pre-release
 * tags, no build metadata — because `app.json` is the only thing that ever
 * produces one and that is the shape it produces. A semver library would be a
 * dependency for a numeric comparison of three integers.
 */

/** `1.2.3` and nothing else. Anything else is not a version this can compare. */
const VERSION = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(value: string): ParsedVersion | null {
  const found = VERSION.exec(value.trim());
  if (found === null) return null;

  const [major, minor, patch] = [found[1], found[2], found[3]].map((part) => Number(part));
  if (major === undefined || minor === undefined || patch === undefined) return null;

  return { major, minor, patch };
}

/**
 * Whether a client that reports `reported` is below `minimum`.
 *
 * **An unreadable or absent version counts as too old**, and that is the
 * decision worth defending. Every build that sends a version sends a
 * well-formed one, so the two ways to arrive here are a build that predates
 * the header — which is exactly the population a floor exists to catch — and
 * something hand-rolled, which has no claim on the benefit of the doubt.
 *
 * It is safe to be strict because the floor is off unless somebody sets it:
 * `minimum` is null on a server that has not decided, and nothing is refused
 * there. Setting it is a deliberate act taken once the fleet reports versions.
 */
export function isClientTooOld(reported: string | undefined, minimum: string | null): boolean {
  if (minimum === null) return false;

  const floor = parseVersion(minimum);
  // A floor nobody can parse is a configuration mistake, and locking a farm
  // out over one would be this server breaking a working app. It reads as no
  // floor, which is the state the server was in before somebody mistyped it.
  if (floor === null) return false;

  if (reported === undefined) return true;
  const client = parseVersion(reported);
  if (client === null) return true;

  if (client.major !== floor.major) return client.major < floor.major;
  if (client.minor !== floor.minor) return client.minor < floor.minor;
  return client.patch < floor.patch;
}

/** The header a client states its version in. */
export const CLIENT_VERSION_HEADER = 'x-steading-client';

import type { SupportBundle } from '@steading/contracts';
import { HttpError } from '../http';

/**
 * Filing a ticket as a GitHub issue (`docs/SUPPORT-LOOP.md` S3, S4 and §3).
 *
 * **The fix happens where the report lands.** An issue can be read, reproduced,
 * branched from, fixed, linked to a PR and closed by the commit, with no
 * transcription between the report and the work — and transcription is where
 * detail is lost. A support inbox would mean copying every ticket into an issue
 * by hand.
 *
 * ## Dedup is what makes the whole thing survivable
 *
 * One device in a crash loop must produce one issue with a count, not four
 * hundred issues. Every bundle carries a fingerprint of the parts that
 * *identify* a defect rather than describe this instance, and an issue is
 * labelled with it — so arrival either finds the open issue and adds evidence,
 * or opens the first one.
 *
 * ## No Octokit
 *
 * Three REST calls. The client library is a dependency and a version treadmill
 * to save writing `fetch` three times.
 */

export interface SupportConfig {
  token: string;
  owner: string;
  repo: string;
  /**
   * Whether the opt-in half — the farm's own records — may be accepted (S5).
   *
   * **The gate lives here rather than in the app**, because the app cannot
   * know a repository's visibility and a build shipped before the change would
   * be wrong forever. While the repository is public, a farm cannot
   * meaningfully consent to its records being world-readable on a prompt in a
   * barn, so the server declines that half and says why.
   */
  acceptRecords: boolean;
}

const API = 'https://api.github.com';

function headers(config: SupportConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

/**
 * A title a person can scan in a list, from a bundle written for a machine.
 *
 * The one human line in the whole artefact (S1). It leads with the first
 * error or refusal because that is what distinguishes one row from the next in
 * a list of forty, and falls back to what the farm said.
 */
export function titleFor(bundle: SupportBundle): string {
  const lead =
    bundle.errors[0] !== undefined
      ? `${bundle.errors[0].where}: ${bundle.errors[0].message}`
      : bundle.rejections[0] !== undefined
        ? `${bundle.rejections[0].entity} refused: ${bundle.rejections[0].reason}`
        : (bundle.said ?? 'A farm reported a problem');

  /**
   * The build goes in the title, not just the body.
   *
   * "Which build are you on" is the first question about any report and the
   * one a machine-first bundle should never need to ask out loud. Two rows in
   * a list, same message, different commit, is a fix that landed — and that is
   * only visible if the title says so.
   */
  const build = bundle.app.build === undefined ? '' : `+${bundle.app.build}`;

  return `[${bundle.app.platform} ${bundle.app.version}${build}] ${lead}`
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

/**
 * The body: the bundle, fenced, and nothing else pretending to be prose.
 *
 * A line of context above it because a human does open these, and then the
 * data — machine-first, which is S1 and the whole point.
 */
function bodyFor(bundle: SupportBundle, gistUrl: string | null): string {
  return [
    bundle.said === undefined ? null : `> ${bundle.said}`,
    bundle.said === undefined ? null : '',
    '```json',
    JSON.stringify(bundle, null, 1),
    '```',
    gistUrl === null ? null : `\nFarm records (sent with consent): ${gistUrl}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

async function call(
  config: SupportConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: headers(config),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (!res.ok) {
    // The status, never the body: a GitHub error can echo the request, and the
    // request carried a token.
    throw new HttpError(502, `Could not reach the issue tracker (${res.status}).`);
  }

  return res.json().catch(() => null);
}

/**
 * The farm's records, as a secret gist (S4).
 *
 * Not in the issue body, for two reasons and the second is load-bearing: a
 * body is capped at 65 KB and a farm's records are not, and **an issue whose
 * body is four megabytes of JSON is an issue nobody opens** — the lean bundle
 * is what gets read first anyway.
 *
 * Secret rather than private: a gist is unlisted and unindexed rather than
 * access-controlled, so it is a URL that must not be published. Acceptable for
 * a farm that opted in, unacceptable as a default — which is exactly why S2
 * makes it opt-in.
 */
async function fileRecords(
  config: SupportConfig,
  fingerprint: string,
  records: string,
): Promise<string | null> {
  const gist = await call(config, '/gists', {
    method: 'POST',
    body: {
      description: `Steading support records — ${fingerprint}`,
      public: false,
      files: { 'records.json': { content: records } },
    },
  });

  const url = (gist as { html_url?: unknown } | null)?.html_url;
  return typeof url === 'string' ? url : null;
}

export interface Filed {
  url: string;
  /** True when this arrival opened the issue rather than adding to one. */
  created: boolean;
}

/**
 * One filing at a time per fingerprint.
 *
 * **The first real use of this loop opened two issues for one fault.** Two
 * reports had been held on a device and were retried together when the support
 * screen opened; they reached here a second apart, both searched for the label,
 * both found nothing — because neither had created its issue yet — and both
 * created one. Issues #95 and #96: same fingerprint, same title, one second
 * between them.
 *
 * Check-then-act, and the check is a network round trip, so the window is wide
 * enough to drive a bus through. Serialising per fingerprint closes it: the
 * second filing waits for the first to finish, then does its own search, finds
 * the issue that now exists, and comments on it — which is what a second report
 * was always supposed to do.
 *
 * Chained rather than shared, and the difference matters. Handing the second
 * caller the first one's promise would return the right URL and silently drop
 * the second bundle, and a second bundle is evidence: it says the fix is still
 * wanted, and it may differ in the field that explains the fault.
 *
 * Keyed by repository as well as fingerprint, so one server filing for two
 * repositories does not serialise them against each other.
 *
 * This is the same single-flight shape as `pullOnce`, `flushOnce` and
 * `refreshSession`, and it has the same limit: one process. There is one
 * server, and a second one would want the tracker itself to enforce this —
 * which it cannot, since GitHub has no unique constraint to lean on.
 */
const filing = new Map<string, Promise<unknown>>();

function keyFor(config: SupportConfig, fingerprint: string): string {
  return `${config.owner}/${config.repo}#${fingerprint}`;
}

/**
 * What this process has already opened, because GitHub will not admit to it yet.
 *
 * **Serialising the calls was necessary and not sufficient.** After the
 * single-flight above, five queued reports of one fault still produced four
 * issues — #113 to #116, one to two seconds apart, each search returning
 * nothing although the previous issue existed and the create had returned its
 * number. The fifth report, twenty seconds later, found #116 and commented.
 *
 * `GET /issues?labels=` is a listing, and GitHub's listings are eventually
 * consistent: a just-created issue is not in them for something between five
 * and twenty seconds. No amount of ordering our own calls helps, because the
 * staleness begins *after* the create returns — which is precisely the moment
 * we know the answer and it does not.
 *
 * So remember it. A create tells us the number; the next report of the same
 * fingerprint uses that instead of asking a question we already know the answer
 * to. This is in-process and deliberately so — the tracker is the durable
 * record, and a restart falls back to a listing that has long since caught up.
 */
const opened = new Map<string, number>();

/**
 * Bounded, because a server that runs for months must not accumulate a row per
 * fingerprint it has ever seen. Insertion order is Map's own, so the oldest
 * goes first, and losing one only costs a listing call that would by then have
 * been correct anyway.
 */
const REMEMBERED = 500;

/**
 * Forgets what this process has opened. Tests only.
 *
 * Module state that outlives a test is a test that passes because of the one
 * before it, and this map is keyed by fingerprint — which fixtures reuse.
 */
export function resetFiling(): void {
  opened.clear();
  filing.clear();
}

function remember(key: string, issue: number): void {
  opened.set(key, issue);
  if (opened.size > REMEMBERED) {
    const oldest = opened.keys().next();
    if (!oldest.done) opened.delete(oldest.value);
  }
}

/**
 * The issue this process opened for that fingerprint, if it is still open.
 *
 * Checked by number rather than trusted, and the distinction is the whole
 * reason this is a round trip rather than a cache hit: §3 wants an **open**
 * issue, so a defect that was fixed and closed and then reported again must
 * open a fresh one instead of reviving a thread somebody deliberately shut.
 *
 * A single issue read by number is strongly consistent — it is the listing that
 * lags, not the record — so this answers correctly in the window where the
 * search does not.
 */
async function rememberedIssue(
  config: SupportConfig,
  key: string,
): Promise<{ number: number; html_url: string } | undefined> {
  const number = opened.get(key);
  if (number === undefined) return undefined;

  // Deleted, transferred, or a tracker having a bad minute: fall through to the
  // listing rather than failing a report over an optimisation.
  const issue = (await call(
    config,
    `/repos/${config.owner}/${config.repo}/issues/${number}`,
  ).catch(() => null)) as { html_url?: string; state?: string } | null;

  if (issue?.state !== 'open' || typeof issue.html_url !== 'string') {
    opened.delete(key);
    return undefined;
  }

  return { number, html_url: issue.html_url };
}

export function fileTicket(
  config: SupportConfig,
  bundle: SupportBundle,
  records: string | undefined,
): Promise<Filed> {
  const key = keyFor(config, bundle.fingerprint);
  const previous = filing.get(key) ?? Promise.resolve();

  // A failed filing must not poison the ones behind it: the next report is
  // entitled to its own attempt at a tracker that may have come back.
  const mine = previous.then(
    () => runFileTicket(config, bundle, records),
    () => runFileTicket(config, bundle, records),
  );

  filing.set(key, mine);
  void mine.catch(() => undefined).finally(() => {
    // Only if nothing queued behind it, or the tail would be dropped.
    if (filing.get(key) === mine) filing.delete(key);
  });

  return mine;
}

async function runFileTicket(
  config: SupportConfig,
  bundle: SupportBundle,
  records: string | undefined,
): Promise<Filed> {
  const label = `fp:${bundle.fingerprint}`;

  /**
   * The records go up first, so the link exists when the issue is written.
   *
   * A gist with no issue is litter; an issue promising a link it does not have
   * is a dead end somebody investigates. Litter is cheaper.
   */
  const gistUrl =
    records !== undefined && config.acceptRecords
      ? await fileRecords(config, bundle.fingerprint, records).catch(() => null)
      : null;

  /**
   * What this process opened first, then the listing.
   *
   * The order is the fix: the listing cannot see an issue created a second ago
   * (see `opened`), and this is exactly the case a queue of held reports
   * produces every time somebody opens the support screen.
   */
  const key = keyFor(config, bundle.fingerprint);
  const remembered = await rememberedIssue(config, key);

  const open =
    remembered !== undefined
      ? null
      : ((await call(
          config,
          `/repos/${config.owner}/${config.repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=1`,
        )) as { number?: number; html_url?: string }[] | null);

  const existing = remembered ?? (Array.isArray(open) ? open[0] : undefined);

  /**
   * Found: the issue accumulates evidence rather than multiplying.
   *
   * A second report of a defect is genuinely useful — it says the fix is still
   * wanted, and a second bundle may differ in the field that explains it — so
   * it is a comment rather than a discarded duplicate.
   */
  if (existing?.number !== undefined && existing.html_url !== undefined) {
    await call(config, `/repos/${config.owner}/${config.repo}/issues/${existing.number}/comments`, {
      method: 'POST',
      body: { body: bodyFor(bundle, gistUrl) },
    });
    // Found by listing or by memory, it is the answer either way — so the next
    // report of this fault skips the listing entirely.
    remember(key, existing.number);
    return { url: existing.html_url, created: false };
  }

  const issue = (await call(config, `/repos/${config.owner}/${config.repo}/issues`, {
    method: 'POST',
    body: {
      title: titleFor(bundle),
      body: bodyFor(bundle, gistUrl),
      // The fingerprint is the label, so the next arrival can find this without
      // a search index that may be minutes behind. It is still labelled for
      // every other reader — a second process, a person filtering the tracker —
      // even though this one now remembers the number as well.
      labels: [label, 'from-a-farm'],
    },
  })) as { number?: number; html_url?: string } | null;

  const url = issue?.html_url;
  if (typeof url !== 'string') throw new HttpError(502, 'The issue tracker did not answer.');

  /**
   * The one moment the number is known and the listing does not have it yet.
   * Everything above exists to use this.
   */
  if (typeof issue?.number === 'number') remember(key, issue.number);

  return { url, created: true };
}

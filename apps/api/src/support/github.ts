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

export function fileTicket(
  config: SupportConfig,
  bundle: SupportBundle,
  records: string | undefined,
): Promise<Filed> {
  const key = `${config.owner}/${config.repo}#${bundle.fingerprint}`;
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

  const open = (await call(
    config,
    `/repos/${config.owner}/${config.repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=1`,
  )) as { number?: number; html_url?: string }[] | null;

  const existing = Array.isArray(open) ? open[0] : undefined;

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
    return { url: existing.html_url, created: false };
  }

  const issue = (await call(config, `/repos/${config.owner}/${config.repo}/issues`, {
    method: 'POST',
    body: {
      title: titleFor(bundle),
      body: bodyFor(bundle, gistUrl),
      // The fingerprint is the label, so the next arrival can find this
      // without a search index that may be minutes behind.
      labels: [label, 'from-a-farm'],
    },
  })) as { html_url?: string } | null;

  const url = issue?.html_url;
  if (typeof url !== 'string') throw new HttpError(502, 'The issue tracker did not answer.');

  return { url, created: true };
}

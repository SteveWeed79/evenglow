/**
 * Whether the server the app talks to can file a report.
 *
 * The decision only, with no network and no filesystem in it, so it can be
 * tested — the same split as `api-origin.mjs`, and for the same reason.
 *
 * ## The gap this closes
 *
 * `Check my setup` read `SUPPORT_GITHUB_TOKEN` out of `.env.local` and said
 * "reporting files issues to SteveWeed79/evenglow". That file configures the
 * server on *this PC*. Once `Use the farm server` pointed the build at the
 * deployed box, the check went on reporting the laptop's configuration for a
 * server the app no longer spoke to — so it read OK on the exact morning
 * "Something is wrong" came back with *this server has nowhere to file a
 * report*.
 *
 * A check that answers about the wrong machine is worse than no check: it is
 * the reason the real fault took a round trip to find.
 */

/**
 * The two support lines out of a dotenv file's text.
 *
 * Deliberately not a full dotenv parser — no quotes, no interpolation, no
 * `export`. It answers one question (is a token set, and where do issues go)
 * and anything cleverer would be a second implementation of something the
 * server already does properly in `env.ts`.
 *
 * **The token's value is never returned**, only whether there is one. This
 * output gets pasted into a chat window.
 */
export function readSupportEnv(text) {
  const value = (key) => {
    if (typeof text !== 'string') return '';
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      // A commented-out line is not a setting. `.env.example` is entirely
      // commented out, and reading it as configuration would report every
      // fresh clone as ready to file.
      .filter((l) => !l.startsWith('#'))
      .find((l) => l.startsWith(`${key}=`));
    return line === undefined ? '' : line.slice(key.length + 1).trim();
  };

  const repo = value('SUPPORT_REPO');
  return { token: value('SUPPORT_GITHUB_TOKEN') !== '', repo: repo === '' ? null : repo };
}

/**
 * What a reply to `POST /support` says about the server's configuration.
 *
 * The probe body is empty, which cannot be a ticket. That is the whole trick:
 * `routes/support.ts` checks its configuration *before* it parses the body, so
 * the two failures are distinguishable and neither files anything.
 *
 *   501  the config gate refused — no token, no repo
 *   400  the gate was passed and the schema refused the empty body
 *
 * So a 400 is the good answer here, and nothing had to be added to the server
 * to ask. No new endpoint, no configuration echoed back over the wire, and no
 * issue created by asking.
 */
export function describeProbe(status) {
  if (status === 501) {
    return {
      state: 'nowhere',
      message: 'this server has nowhere to file a report — no token or repo is set on it',
    };
  }

  if (status === 400) {
    return { state: 'ready', message: 'reports reach this server and it can file them' };
  }

  if (status === 429) {
    return {
      state: 'throttled',
      message: 'the server is rate limiting — five a minute; wait a minute and look again',
    };
  }

  // The route is registered unconditionally, so a 404 means the server predates
  // the support loop rather than having it switched off. Different fix: deploy.
  if (status === 404) {
    return { state: 'missing', message: 'this server has no /support route — it needs a deploy' };
  }

  return { state: 'unclear', message: `the server answered ${status}, which is not a state we know` };
}

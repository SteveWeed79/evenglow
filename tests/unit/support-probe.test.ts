import { describe, expect, it } from 'vitest';
import { describeProbe, readSupportEnv } from '../../scripts/lib/support-probe.mjs';

/**
 * Whether the server the app talks to can file a report — and *which* server
 * that question is about.
 *
 * ## The fault this closes
 *
 * `Check my setup` read `SUPPORT_GITHUB_TOKEN` out of this PC's `.env.local`
 * and printed "reporting files issues to SteveWeed79/steading". That file
 * configures the server running on the laptop. Once `Use the farm server`
 * pointed the build at the deployed box — a different machine, with its own
 * `/etc/steading/api.env` and nothing in it — the check went on reporting the
 * laptop's configuration for a server the app no longer spoke to.
 *
 * So it read OK on the exact morning a handset was being told *this server has
 * nowhere to file a report*. A check that answers about the wrong machine is
 * worse than no check: it sends whoever is debugging in the wrong direction.
 */

describe('reading the two support lines out of a dotenv file', () => {
  it('reports a configured pair without ever returning the token', () => {
    const read = readSupportEnv(
      ['AUTH_SECRET=nope', 'SUPPORT_GITHUB_TOKEN=github_pat_11ABC', 'SUPPORT_REPO=SteveWeed79/steading'].join('\n'),
    );

    expect(read).toEqual({ token: true, repo: 'SteveWeed79/steading' });
    // This output gets pasted into a chat window, so the value must not be in
    // the shape at all rather than merely not printed by today's caller.
    expect(JSON.stringify(read)).not.toContain('github_pat');
  });

  /**
   * `.env.example` is entirely commented out and is the file a fresh clone
   * has. Reading a `#` line as a setting would report every new machine as
   * ready to file, which is the same false OK in a different disguise.
   */
  it('does not read a commented-out line as configuration', () => {
    const example = ['# SUPPORT_GITHUB_TOKEN=', '# SUPPORT_REPO=SteveWeed79/steading'].join('\n');

    expect(readSupportEnv(example)).toEqual({ token: false, repo: null });
  });

  /** The box template comments them without a space, systemd style. */
  it('does not read #SUPPORT_REPO= either', () => {
    expect(readSupportEnv('#SUPPORT_REPO=SteveWeed79/steading').repo).toBeNull();
  });

  it('calls an empty value unset, because systemd would pass it as one', () => {
    expect(readSupportEnv('SUPPORT_GITHUB_TOKEN=\nSUPPORT_REPO=')).toEqual({
      token: false,
      repo: null,
    });
  });

  /**
   * A token with no repo is the half-configured state the old check already
   * called out, kept because it is a real way to get this wrong.
   */
  it('separates a token with nowhere to send it from having neither', () => {
    expect(readSupportEnv('SUPPORT_GITHUB_TOKEN=x')).toEqual({ token: true, repo: null });
  });

  it('survives a missing file rather than throwing', () => {
    for (const nothing of ['', undefined, null]) {
      expect(readSupportEnv(nothing as string)).toEqual({ token: false, repo: null });
    }
  });
});

describe('what the server itself says', () => {
  /**
   * The probe posts an empty body, which cannot become a ticket.
   *
   * `routes/support.ts` checks its configuration *before* it parses the body,
   * so the two refusals are distinguishable — and asking costs no new
   * endpoint, echoes no configuration over the wire, and files nothing.
   */
  it('reads 501 as the config gate, which is the reported fault', () => {
    const { state, message } = describeProbe(501);

    expect(state).toBe('nowhere');
    expect(message).toContain('nowhere to file');
  });

  it('reads 400 as configured, because only a passed gate reaches the schema', () => {
    expect(describeProbe(400).state).toBe('ready');
  });

  /** Five a minute per address. A throttled probe is not an unconfigured one. */
  it('does not mistake the rate limiter for a missing token', () => {
    expect(describeProbe(429).state).toBe('throttled');
  });

  /**
   * The route is registered unconditionally, so a 404 is a server that
   * predates the support loop. Different fault, different fix: deploy.
   */
  it('separates a server without the route from one without a token', () => {
    expect(describeProbe(404).state).toBe('missing');
  });

  it('says so plainly rather than guessing at an answer it does not know', () => {
    const { state, message } = describeProbe(503);

    expect(state).toBe('unclear');
    expect(message).toContain('503');
  });
});

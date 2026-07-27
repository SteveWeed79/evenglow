import { describe, expect, it } from 'vitest';
import { errorBody, HttpError } from '@steading/api/http';

/**
 * The shared failure shape.
 *
 * Worth its own suite because it is the one piece both servers use to answer
 * a failure, and because getting it wrong is quiet: CI caught a 429 being
 * reported as a 500, which a client with backoff would have treated as a
 * server fault and retried straight back into the limiter.
 */

describe('errorBody', () => {
  it('passes an HttpError through with its own message', () => {
    expect(errorBody(new HttpError(401, 'Sign in again.'))).toEqual({
      status: 401,
      body: { error: 'Sign in again.' },
    });
  });

  /**
   * Fastify sets statusCode on its own errors — 429 from the rate limiter,
   * 400 from a body it could not parse. Those are deliberate answers.
   */
  it.each([
    [429, /too many/i],
    [400, /could not be read/i],
    [413, /too large/i],
    [415, /format/i],
  ])('honours a framework %i rather than reporting a server fault', (status, expected) => {
    const framework = Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), {
      statusCode: status,
    });

    const result = errorBody(framework);
    expect(result.status).toBe(status);
    expect(result.body.error).toMatch(expected);
  });

  it('never repeats a framework error message', () => {
    // The text can name a parser, a header or a schema, and this service
    // answers a client anyone can unpack from an APK.
    const framework = Object.assign(
      new Error("Body is not valid JSON but content-type is set to 'application/json'"),
      { statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' },
    );

    const { body } = errorBody(framework);
    expect(body.error).not.toMatch(/JSON|content-type|FST_ERR/i);
  });

  it('does not honour a 5xx statusCode from an unexpected error', () => {
    // A 500 carrying a driver's message must still be flattened — the status
    // is the same either way, the message is what matters.
    const leaky = Object.assign(new Error('E11000 duplicate key on index orgId_1'), {
      statusCode: 500,
    });

    const { status, body } = errorBody(leaky);
    expect(status).toBe(500);
    expect(body.error).toBe('Something went wrong.');
  });

  it.each([undefined, null, 'a string', 42, {}, { statusCode: 'nonsense' }])(
    'flattens %s to a plain 500',
    (thrown) => {
      expect(errorBody(thrown)).toEqual({ status: 500, body: { error: 'Something went wrong.' } });
    },
  );
});

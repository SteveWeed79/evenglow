import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb } from '../support/mongo';

/**
 * The endpoint Google pushes subscription changes to, which was wide open.
 *
 * `POST /billing/notifications` is a Pub/Sub push target: unauthenticated,
 * unthrottled, and reachable from anywhere on the internet.
 *
 * **The state it writes was never forgeable**, and that half of the design was
 * right — the handler takes a purchase token out of the body and then asks
 * *Google* what that purchase is worth now, so an invented payload cannot make
 * a farm entitled. What was open was the **cost**: every request naming a real
 * token spent an outbound Play API call and a database write, with nothing
 * bounding how many. Somebody else's quota and this server's time, available to
 * anybody who could guess or obtain one token.
 *
 * So the assertions here are about who may make the server do work, not about
 * what ends up stored — the second was already safe and the first was not.
 */

const harness = await startTestDb('steading_store_notifications');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'steading_store_notifications';
}

const describeDb = harness ? describe : describe.skip;

const SECRET = 'a-test-secret-long-enough-for-hs256-abcdef';

/** Syntactically valid, so the billing routes are live. Google is never reached. */
const PLAY_ACCOUNT = JSON.stringify({
  client_email: 'billing@steading-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----',
});

const ORG = ulid();
const TOKEN = 'a-purchase-token-this-server-has-seen';
const AUDIENCE = 'https://farm.example.test/billing/notifications';

/**
 * A bare Fastify with only the billing routes, and the Play reader replaced.
 *
 * **The route is deliberately silent** — every outcome is a 200, and the state
 * it writes comes from Google either way — so "did a stranger make this server
 * call the Play API" cannot be seen from outside. That question is the whole
 * point of the gate, so the reader is a parameter and the counter below is what
 * every assertion here actually reads.
 *
 * `billingRoutes` directly rather than `buildServer`, because `buildServer`
 * owns no seam and should not grow one for a test.
 */
async function server(over: Record<string, string> = {}) {
  const Fastify = (await import('fastify')).default;
  const { billingRoutes } = await import('@steading/api/routes/billing');
  const { readEnv } = await import('@steading/api/env');

  const app = Fastify({ logger: false });
  await billingRoutes(
    app,
    readEnv({
      AUTH_SECRET: SECRET,
      MONGODB_URI: harness!.uri,
      MONGODB_DB: 'steading_store_notifications',
      GOOGLE_PLAY_SERVICE_ACCOUNT: PLAY_ACCOUNT,
      GOOGLE_PLAY_PACKAGE: 'dev.swbuild.homefarm',
      ...over,
    }),
    {
      readSubscription: async () => {
        asked += 1;
        return { state: 'lapsed', source: 'play', updatedAt: Date.now() };
      },
    },
  );
  return app;
}

/** How many times Google would have been asked. Reset before every test. */
let asked = 0;

/** A push envelope, as Pub/Sub actually shapes one. */
function envelope(payload: unknown) {
  return { message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') } };
}

async function notify(
  payload: unknown,
  options: { authorization?: string; over?: Record<string, string> } = {},
) {
  const app = await server(options.over);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/notifications',
    headers: options.authorization === undefined ? {} : { authorization: options.authorization },
    payload: envelope(payload) as never,
  });
  await app.close();
  return { status: res.statusCode, body: res.body };
}

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  asked = 0;
  await harness!.db.collection('orgs').deleteMany({});
  await harness!.db.collection('orgs').insertOne({
    _id: ORG as never,
    name: 'Hollow Farm',
    createdAt: new Date(),
    subscription: { state: 'active', source: 'play', updatedAt: Date.now() },
    playPurchaseToken: TOKEN,
  } as never);
});

describeDb('a store notification with no push token', () => {
  /**
   * The audience is unset here, which is the state every box is in until the
   * push subscription is configured. The route keeps working: it is rate
   * limited, it checks the package, and it still asks Google before believing
   * anything.
   */
  it('is still accepted when the server has no audience configured', async () => {
    const answer = await notify({
      packageName: 'dev.swbuild.homefarm',
      subscriptionNotification: { purchaseToken: 'a-token-nobody-has-submitted' },
    });

    expect(answer.status).toBe(200);
    // A token nobody has submitted names no farm, so there was nothing to ask
    // about — the lookup refuses it before Google is involved.
    expect(asked).toBe(0);
  });

  /**
   * **The gate.** With an audience configured, a request carrying no OIDC token
   * is dropped before Google is asked — which is the outbound call this exists
   * to stop a stranger from spending.
   */
  /**
   * **The gate, and `asked` is the assertion.** With an audience configured, a
   * request carrying no OIDC token never reaches the Play API — which is the
   * outbound call this exists to stop a stranger from spending. The status is a
   * 200 either way, which is why the counter is the only thing that can tell
   * the two apart.
   */
  it('never reaches Google when the server expects a token and got none', async () => {
    const answer = await notify(
      { packageName: 'dev.swbuild.homefarm', subscriptionNotification: { purchaseToken: TOKEN } },
      { over: { GOOGLE_PUBSUB_AUDIENCE: AUDIENCE } },
    );

    expect(answer.status).toBe(200);
    expect(asked).toBe(0);

    const org = await harness!.db.collection('orgs').findOne({ _id: ORG as never });
    expect(org?.subscription?.state).toBe('active');
  });

  /** And the same request without a gate does reach it — or the test above proves nothing. */
  it('does reach Google when no audience is configured, which is what makes the gate real', async () => {
    const answer = await notify({
      packageName: 'dev.swbuild.homefarm',
      subscriptionNotification: { purchaseToken: TOKEN },
    });

    expect(answer.status).toBe(200);
    expect(asked).toBe(1);
  });

  it('never reaches Google for something that is not a bearer token', async () => {
    await notify(
      { packageName: 'dev.swbuild.homefarm', subscriptionNotification: { purchaseToken: TOKEN } },
      { authorization: 'Basic bm90LWFuLW9pZGMtdG9rZW4=', over: { GOOGLE_PUBSUB_AUDIENCE: AUDIENCE } },
    );

    expect(asked).toBe(0);
  });

  /**
   * A token with the right issuer, the right audience and the right claims, and
   * the wrong signer. Google's key set is the only thing that separates it from
   * a real one, which is exactly what the verification checks.
   */
  it('never reaches Google for a token this server signed itself', async () => {
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({ email: 'someone@example.test', email_verified: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));

    await notify(
      { packageName: 'dev.swbuild.homefarm', subscriptionNotification: { purchaseToken: TOKEN } },
      { authorization: `Bearer ${forged}`, over: { GOOGLE_PUBSUB_AUDIENCE: AUDIENCE } },
    );

    expect(asked).toBe(0);
    const org = await harness!.db.collection('orgs').findOne({ _id: ORG as never });
    expect(org?.subscription?.state).toBe('active');
  });
});

describeDb('which app a notification is about', () => {
  /**
   * One service account can be subscribed to more than one application's
   * notifications. `packageName` was parsed and then ignored, so a token from
   * another package would have been looked up and asked about under *this*
   * package name — an answer about the wrong thing, or an error.
   */
  it('is checked, rather than parsed and ignored', async () => {
    const answer = await notify({
      packageName: 'com.someone.else',
      subscriptionNotification: { purchaseToken: TOKEN },
    });

    expect(answer.status).toBe(200);
    // Google is never asked about another application's purchase, which is what
    // "checked" means — the status is a 200 whatever happens.
    expect(asked).toBe(0);
    const org = await harness!.db.collection('orgs').findOne({ _id: ORG as never });
    expect(org?.subscription?.state).toBe('active');
  });

  /**
   * A notification naming no package is let through: older ones did not carry
   * the field, and the token lookup refuses anything this server has never seen
   * anyway.
   */
  it('is not required, because older notifications did not carry it', async () => {
    const answer = await notify({
      subscriptionNotification: { purchaseToken: 'a-token-nobody-has-submitted' },
    });

    expect(answer.status).toBe(200);
  });
});

describeDb('how many notifications one caller may send', () => {
  /**
   * Sixty a minute — far above anything Pub/Sub sends a box holding a handful
   * of farms, far below a rate at which somebody else's Play quota is worth
   * attacking.
   *
   * **A 429, and this test is why.** The route was written to answer 200 on the
   * reasoning that Pub/Sub retries anything else; asserting it inverted the
   * argument. Retrying *is* the right response to being throttled — a
   * legitimate push loses a delay and nothing else — while a 200 tells Google
   * the notification landed, and a real subscription change caught in a burst
   * is then lost for good.
   */
  it('is bounded, where it used to be unbounded', async () => {
    const app = await server();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/billing/notifications',
        payload: envelope({
          packageName: 'dev.swbuild.homefarm',
          subscriptionNotification: { purchaseToken: 'a-token-nobody-has-submitted' },
        }) as never,
      });

    const answers = [];
    for (let i = 0; i < 65; i += 1) answers.push(await send());
    await app.close();

    expect(String(answers[0]?.headers['x-ratelimit-limit'])).toBe('60');

    // The first sixty are read and answered; the rest are turned away, which is
    // what "bounded" means and what the route did not do before.
    expect(answers.slice(0, 60).every((a) => a.statusCode === 200)).toBe(true);
    expect(answers.slice(60).every((a) => a.statusCode === 429)).toBe(true);
  });
});

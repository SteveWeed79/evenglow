import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { startTestDb } from '../support/mongo';

/**
 * Spending a promotion code, against a real database.
 *
 * The pure half is in `tests/unit/billing.test.ts`. What needs a database is
 * everything about *claiming*: a code with one use cannot be spent twice, two
 * phones redeeming at the same instant cannot both win, and a farm that
 * presses the button again on bad signal must not be told it did something
 * wrong.
 *
 * The last one matters most and is the easiest to get backwards. Every other
 * write path in this app is idempotent by design — the mutation queue insists
 * on it — and a redeem route that punished a retry would be the one place a
 * dropped response cost somebody a subscription.
 */

const harness = await startTestDb('homefarm_promo');

if (harness) {
  process.env.MONGODB_URI = harness.uri;
  process.env.MONGODB_DB = 'homefarm_promo';
}

const describeDb = harness ? describe : describe.skip;

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await harness?.db.collection('promoCodes').deleteMany({});
});

async function promo() {
  return import('@homefarm/api/db/promo-codes');
}

describeDb('spending a code', () => {
  it('grants what it was minted with', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({ code, grant: { days: 365 }, maxRedemptions: 1 });

    const result = await redeemPromoCode(code, ulid(), ulid());

    expect(result).toEqual({ ok: true, grant: { days: 365 } });
  });

  it('refuses a code nobody minted', async () => {
    const { mintPromoCode, redeemPromoCode } = await promo();

    expect(await redeemPromoCode(mintPromoCode(), ulid(), ulid())).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  /**
   * Single use means single use, and the second farm is refused rather than
   * quietly given a subscription nobody paid for.
   */
  it('cannot be spent by a second farm once its uses are gone', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({ code, grant: { days: null }, maxRedemptions: 1 });

    expect((await redeemPromoCode(code, ulid(), ulid())).ok).toBe(true);
    expect(await redeemPromoCode(code, ulid(), ulid())).toEqual({ ok: false, reason: 'spent' });
  });

  it('lets exactly as many farms through as it was minted for', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({ code, grant: { days: null }, maxRedemptions: 3 });

    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await redeemPromoCode(code, ulid(), ulid()));

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results[3]).toEqual({ ok: false, reason: 'spent' });
  });

  /**
   * **The race, and the reason claiming is one conditional update.**
   *
   * Read the document, check the count, then write, and two callers both pass
   * the check — so a code minted for one farm pays for two. The filter carries
   * every condition, so the database decides and exactly one caller can win.
   */
  it('cannot be claimed twice by two farms redeeming at once', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({ code, grant: { days: null }, maxRedemptions: 1 });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeemPromoCode(code, ulid(), ulid())),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describeDb('the same farm, twice', () => {
  /**
   * A retry is not a second redemption. Two hands on one farm, or one hand
   * pressing again on bad signal, gets the grant it already had — and the
   * code's remaining uses are untouched.
   */
  it('is idempotent, and does not spend a second use', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    const org = ulid();
    await createPromoCode({ code, grant: { days: 90 }, maxRedemptions: 2 });

    const first = await redeemPromoCode(code, org, ulid());
    const again = await redeemPromoCode(code, org, ulid());

    expect(first).toEqual({ ok: true, grant: { days: 90 } });
    expect(again).toEqual({ ok: true, grant: { days: 90 } });

    // The second use is still there for somebody else.
    expect((await redeemPromoCode(code, ulid(), ulid())).ok).toBe(true);
  });
});

describeDb('a code that should not work any more', () => {
  it('refuses one that has expired', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({
      code,
      grant: { days: null },
      maxRedemptions: 1,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await redeemPromoCode(code, ulid(), ulid())).toEqual({ ok: false, reason: 'expired' });
  });

  /**
   * The honest answer to "that code got posted somewhere" is to turn it off,
   * not to hope. Checked before the count, so disabling a half-spent code
   * stops the rest of it.
   */
  it('refuses one that was turned off by hand', async () => {
    const { createPromoCode, hashPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({ code, grant: { days: null }, maxRedemptions: 10 });

    // The hash is the `_id`, so the driver's default ObjectId typing has to be
    // widened here — the collection genuinely keys on a hex digest.
    await harness!.db
      .collection<{ _id: string; disabledAt?: Date }>('promoCodes')
      .updateOne({ _id: hashPromoCode(code) }, { $set: { disabledAt: new Date() } });

    expect(await redeemPromoCode(code, ulid(), ulid())).toEqual({ ok: false, reason: 'expired' });
  });
});

describeDb('what the database holds', () => {
  /**
   * A dump or a stray log line must not hand somebody a working code — the
   * same reason invites and join codes are hashed.
   */
  it('never stores the code itself', async () => {
    const { createPromoCode, mintPromoCode } = await promo();
    const code = mintPromoCode();
    await createPromoCode({ code, grant: { days: null }, maxRedemptions: 1 });

    const rows = await harness!.db
      .collection<{ _id: string }>('promoCodes')
      .find({})
      .toArray();

    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?._id).toHaveLength(64);
  });

  it('records which farm spent it, so a list can be read a year later', async () => {
    const { createPromoCode, mintPromoCode, redeemPromoCode } = await promo();
    const code = mintPromoCode();
    const org = ulid();
    await createPromoCode({ code, grant: { days: null }, maxRedemptions: 1 });
    await redeemPromoCode(code, org, ulid());

    const [row] = await harness!.db
      .collection<{ _id: string; redeemedBy: { orgId: string }[] }>('promoCodes')
      .find({})
      .toArray();

    expect(row?.redeemedBy).toHaveLength(1);
    expect(row?.redeemedBy[0]?.orgId).toBe(org);
  });
});

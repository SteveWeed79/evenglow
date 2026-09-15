import { describe, expect, it } from 'vitest';
import {
  AGE_CONFIRMATION,
  AGE_NOT_CONFIRMED,
  AGE_WHY,
  MINIMUM_AGE,
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  googleSignInSchema,
  inviteAcceptSchema,
  joinCodeRedeemSchema,
  signupSchema,
} from '@homefarm/contracts';
import type { LegalDocument } from '@homefarm/contracts';

/**
 * The age floor as a wire contract, without a database — `UNCONSIDERED.md` `[3]`.
 *
 * `tests/isolation/age-gate.test.ts` proves the routes behave; this proves the
 * shapes they parse, which is where three of the four doors are actually shut.
 * It runs everywhere, and that matters here: the half that needs mongod is the
 * half a laptop skips, and "the schema requires it" is the claim the whole
 * design rests on.
 */

const PASSWORD = 'a properly long passphrase';

describe('the assertion on the wire', () => {
  /**
   * Enumerated rather than looped, so a door added later is absent from this
   * list in a way somebody reading it notices.
   */
  const creating = [
    ['signup', signupSchema, {
      orgId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      orgName: 'A Farm',
      email: 'sam@example.test',
      password: PASSWORD,
      name: 'Sam',
    }],
    ['an invitation', inviteAcceptSchema, {
      token: 'a-token-long-enough-to-pass',
      email: 'sam@example.test',
      password: PASSWORD,
      name: 'Sam',
    }],
    ['a join code', joinCodeRedeemSchema, {
      code: 'ABC123',
      email: 'sam@example.test',
      password: PASSWORD,
      name: 'Sam',
    }],
  ] as const;

  for (const [door, schema, body] of creating) {
    it(`refuses ${door} with no assertion`, () => {
      expect(schema.safeParse(body).success).toBe(false);
    });

    /**
     * The reason it is `z.literal(true)` and not `z.boolean()`: a boolean
     * would put "somebody said no" on the wire and leave refusing it to a
     * handler that can be written without the check.
     */
    it(`refuses ${door} when the answer is no`, () => {
      expect(schema.safeParse({ ...body, ageConfirmed: false }).success).toBe(false);
    });

    it(`accepts ${door} when the answer is yes`, () => {
      expect(schema.safeParse({ ...body, ageConfirmed: true }).success).toBe(true);
    });
  }

  /**
   * The exception, and the one that would be a regression if it changed.
   *
   * `/auth/google` signs in and signs up through one body. A required field
   * here would refuse every build already on a handset on the route somebody
   * uses to get back into their own account, so the route checks it on the
   * branch that inserts a user and the schema does not.
   */
  it('lets a Google sign-in through with no assertion, because it is also a sign-in', () => {
    expect(googleSignInSchema.safeParse({ idToken: 'anything' }).success).toBe(true);
    expect(
      googleSignInSchema.safeParse({
        idToken: 'anything',
        orgId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        orgName: 'A Farm',
      }).success,
    ).toBe(true);
  });

  it('still refuses no from a Google body, so the value cannot be meaningless', () => {
    expect(
      googleSignInSchema.safeParse({ idToken: 'anything', ageConfirmed: false }).success,
    ).toBe(false);
  });
});

describe('the floor is one number', () => {
  function prose(document: LegalDocument): string {
    return document.blocks
      .map((block) =>
        block.kind === 'paragraph' || block.kind === 'heading'
          ? block.text
          : block.kind === 'list'
            ? block.items.join(' ')
            : '',
      )
      .join(' ');
  }

  /**
   * The failure this guards against is the one that was already here: the
   * number lived in the policy, in the terms and nowhere else, so the app
   * could disagree with both and nothing would say so. Moving it is one edit
   * now, and a document left behind fails here.
   */
  it('is the number the policy and the terms actually print', () => {
    for (const document of [PRIVACY_POLICY, TERMS_OF_SERVICE]) {
      expect(prose(document)).toContain(String(MINIMUM_AGE));
    }
  });

  it('is the number the app shows and the server refuses with', () => {
    expect(AGE_CONFIRMATION).toContain(String(MINIMUM_AGE));
    expect(AGE_NOT_CONFIRMED).toContain(String(MINIMUM_AGE));
  });

  /**
   * The refusal is reachable from one place only — the sign-in tab's Google
   * button, where nothing asked — so it has to say where the box is. A rule
   * without a way to satisfy it is a dead end on somebody's first morning.
   */
  it('tells the one person who can see it what to do about it', () => {
    expect(AGE_NOT_CONFIRMED).toContain('Set up an account');
  });

  /**
   * The hint exists to refuse the obvious misreading: that the app is for
   * adults. A child feeding hens on the family handset is the use this was
   * built for, and nothing here touches them.
   */
  it('says the app itself has no age limit, only an account', () => {
    expect(AGE_WHY).toContain('account');
  });
});

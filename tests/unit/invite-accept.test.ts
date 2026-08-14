import { describe, expect, it } from 'vitest';
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  looksLikeJoinCode,
  normalizeJoinCode,
  ROLE_WORDS,
} from '@steading/contracts';

/**
 * Telling a join code from an invite link.
 *
 * A farm could mint an invitation, share it, and watch it go nowhere: the
 * server has published `GET /invites/:token` and `POST /invites/accept` since
 * invites were built, and **nothing in the app ever called either**. The invite
 * half of membership was a token in a text message and a dead end.
 *
 * Both now land in one box, because the person holding one did not choose which
 * they were given. This is the function that decides which door to knock on —
 * the server remains the authority on both, so the cost of a wrong guess is a
 * refusal rather than a wrong farm.
 */

const CODE = 'K4M9PT';
/** 32 random bytes as base64url, which is what `mintInviteToken` produces. */
const TOKEN = 'sT7pQ2xR9vLmK3nB8wY6zA1cE5dF0gH4jI7kL2mN9oP';

describe('a six-character code', () => {
  it('is recognised', () => {
    expect(looksLikeJoinCode(CODE)).toBe(true);
  });

  /** Crockford is case-free and folds I/L to 1 and O to 0 — a hand typing it
      across a yard is understood rather than told they are wrong. */
  it('is recognised however it was typed', () => {
    expect(looksLikeJoinCode('k4m9pt')).toBe(true);
    expect(looksLikeJoinCode('  K4M9PT  ')).toBe(true);
    expect(looksLikeJoinCode('K4M9-PT')).toBe(true);
  });

  it('folds the letters Crockford treats as digits', () => {
    // O for 0 and I for 1: a code read aloud and typed by ear still resolves.
    expect(normalizeJoinCode('KOM9PT')).toBe('K0M9PT');
    expect(looksLikeJoinCode('KOM9PT')).toBe(true);
  });

  it('is exactly six, not "about six"', () => {
    expect(looksLikeJoinCode('K4M9P')).toBe(false);
    expect(looksLikeJoinCode('K4M9PTX')).toBe(false);
  });

  it('agrees with the alphabet it is minted from', () => {
    const minted = [...Array(JOIN_CODE_LENGTH)]
      .map((_, index) => JOIN_CODE_ALPHABET[index % JOIN_CODE_ALPHABET.length])
      .join('');

    expect(minted).toHaveLength(JOIN_CODE_LENGTH);
    expect(looksLikeJoinCode(minted)).toBe(true);
  });
});

describe('a long invite link', () => {
  it('is not mistaken for a code', () => {
    expect(looksLikeJoinCode(TOKEN)).toBe(false);
  });

  /**
   * The two cannot collide, and it is length that guarantees it rather than
   * the alphabet.
   *
   * Six base64url characters would pass the alphabet check — `aB3dEf`
   * uppercases to six perfectly good Crockford ones — so a short token would be
   * ambiguous. No such token exists: `mintInviteToken` is 32 random bytes,
   * which is always 43 characters of base64url, and 43 is not 6.
   */
  it('is always far longer than a code could be', () => {
    expect(TOKEN.length).toBe(43);
    expect(TOKEN.length).toBeGreaterThan(JOIN_CODE_LENGTH);
    expect(looksLikeJoinCode(TOKEN)).toBe(false);
  });

  it('sends anything unrecognisable down the invite branch, where the server refuses it', () => {
    for (const wrong of ['', '   ', 'not a code at all', '!!!!!!']) {
      expect(looksLikeJoinCode(wrong), wrong).toBe(false);
    }
  });
});

describe('what an invitation says it makes you', () => {
  /**
   * The wire name and the spoken name differ, and the screen shows the spoken
   * one. Somebody deciding whether to take up an invitation that leaves their
   * own farm behind should read "Manager", not "admin".
   */
  it('names every role in words', () => {
    expect(ROLE_WORDS.owner).toBe('Owner');
    expect(ROLE_WORDS.admin).toBe('Manager');
    expect(ROLE_WORDS.hand).toBe('Farm hand');
  });
});

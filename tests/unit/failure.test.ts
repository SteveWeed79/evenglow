import { describe, expect, it } from 'vitest';
import { describeLogFailure } from '@steading/app/sync/failure';
import { InvalidMutationError, StorageFullError } from '@steading/app/sync/queue';

/**
 * The message a keeper sees when a log does not land.
 *
 * Worth its own suite because every write path used to discard the rejection
 * entirely: the Tally cleared its count before awaiting the commit, so a throw
 * left zero on screen with nothing queued and nothing said. These messages are
 * the visible half of that fix.
 */

describe('describeLogFailure', () => {
  it('passes a full device through with its own wording', () => {
    const message = describeLogFailure(new StorageFullError());

    // Written for this screen, and it names the action that helps.
    expect(message).toContain('out of space');
    expect(message).toContain('Sync');
  });

  it('passes a rejected payload through with its own wording', () => {
    expect(describeLogFailure(new InvalidMutationError('That flock has a bad value.'))).toBe(
      'That flock has a bad value.',
    );
  });

  it('does not surface a raw platform error to the user', () => {
    // An IndexedDB abort reads like "AbortError: transaction aborted", which
    // tells a keeper nothing and reads as the app blaming them.
    const raw = new DOMException('transaction aborted', 'AbortError');
    const message = describeLogFailure(raw);

    expect(message).not.toContain('AbortError');
    expect(message).not.toContain('transaction');
  });

  it('says the count is still there, because after the fix it is', () => {
    // The message is load-bearing: it tells the user not to walk away, and it
    // is only true because Tally restores the count it optimistically cleared.
    expect(describeLogFailure(new Error('anything'))).toContain('still here');
  });

  it('handles a thrown non-error without crashing the log path', () => {
    for (const thrown of [undefined, null, 'a string', 42, { message: 'nope' }]) {
      expect(typeof describeLogFailure(thrown)).toBe('string');
      expect(describeLogFailure(thrown).length).toBeGreaterThan(0);
    }
  });
});

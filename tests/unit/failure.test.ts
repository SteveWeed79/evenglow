import { describe, expect, it } from 'vitest';
import { describeLogFailure } from '@steading/core/sync/failure';
import { InvalidMutationError, StorageFullError } from '@steading/core/sync/queue';

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

  it('leads with the sentence a person can act on, then names the cause', () => {
    /**
     * This used to assert the opposite — that the platform's own words never
     * reached the screen, because "AbortError: transaction aborted" tells a
     * keeper nothing and reads as the app blaming them.
     *
     * Right about the first line, wrong to stop there. Discarding the detail
     * threw away the only evidence a failure produced, and it cost two rounds
     * of "it will not save anywhere" with nothing to go on — not the call, not
     * the file, not even whether it was storage, the network or a missing
     * global. A person can ignore a second line. Nobody can debug a missing
     * one.
     */
    const raw = new DOMException('transaction aborted', 'AbortError');
    const message = describeLogFailure(raw);

    // What to do comes first and is unchanged.
    expect(message.split('\n')[0]).toContain('That did not save');
    // What went wrong comes after it.
    expect(message).toContain('transaction aborted');
  });

  it('says only the actionable sentence when there is no detail to add', () => {
    // An error with nothing in it must not produce a dangling blank line.
    expect(describeLogFailure(new Error(''))).toBe(
      'That did not save. Your count is still here — try again.',
    );
    expect(describeLogFailure(undefined)).toBe(
      'That did not save. Your count is still here — try again.',
    );
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

'use client';

import { type ActiveWithdrawal, withdrawalMessage } from '@/lib/withdrawal';

/**
 * The one place a warning outranks speed (UX-SPEC §3).
 *
 * A band, not a modal (R10). It stays put, it does not interrupt, and it does
 * not block the rest of the screen — but committing a log while it is showing
 * takes one deliberate confirm tap.
 */
export function WithdrawalBanner({
  withdrawal,
}: {
  withdrawal: ActiveWithdrawal;
}): React.ReactElement {
  return (
    <p className="withdrawal" role="status">
      {withdrawalMessage(withdrawal)}
    </p>
  );
}

import { newId, type SupportBundle } from '@homefarm/contracts';
import { apiBase, apiUrl } from '../api';
import { localStore } from '../db/store';
import type { StoredTicket } from '../db/port';
import { PRODUCT_NAME } from '@homefarm/contracts';

/**
 * Tickets, held until they can be sent (`docs/SUPPORT-LOOP.md` S6 and S7).
 *
 * The same promise the mutation queue makes and for the same reason: the farm
 * is in a barn and the problem happened *now*. Nothing here is in the outbox —
 * a ticket does not sync between a farm's devices, does not belong to the
 * org's history, and must never be replayed onto the server as a mutation.
 *
 * ## The channel must not depend on the thing most likely to be broken
 *
 * **This is S7 and it is the reason there are two doors.** If what is broken
 * is sync, then a ticket travelling over the sync transport cannot leave
 * either — the device with the most to report is the one that can report
 * least. So `POST /support` is the ordinary path, and the share sheet is a
 * button that says what it is, for the farm whose sync has been failing for a
 * week and who needs to *choose* the other way out rather than wait for a
 * retry that will not succeed.
 *
 * No token on the send. The support route is deliberately unauthenticated,
 * because a report gated behind the credential the farm cannot renew is a
 * report that cannot be filed on the morning it matters.
 */

export interface Filed {
  ok: boolean;
  /** Where it landed, when the tracker said. */
  url?: string | undefined;
  /** Set when the server accepted the report but refused the records half. */
  note?: string | undefined;
  /** Set when it did not go. The ticket stays queued. */
  error?: string | undefined;
}

/**
 * Writes the ticket down first, then tries to send it.
 *
 * **In that order, always.** A send that succeeds and is never recorded is a
 * report nobody can prove they filed; a ticket recorded and not yet sent is
 * exactly the state the queue exists to hold. The same argument the mutation
 * queue makes about durability before delivery.
 */
export async function raiseTicket(
  bundle: SupportBundle,
  records?: string,
): Promise<{ id: string; filed: Filed }> {
  const id = newId();

  await localStore().enqueueTicket({
    id,
    at: bundle.at,
    fingerprint: bundle.fingerprint,
    bundle: JSON.stringify(bundle),
    ...(records === undefined ? {} : { records }),
    attempts: 0,
  });

  return { id, filed: await sendTicket(id) };
}

/** Every ticket the device is still holding, oldest first. */
export async function pendingTickets(): Promise<StoredTicket[]> {
  return localStore().pendingTickets();
}

export async function listTickets(limit?: number): Promise<StoredTicket[]> {
  return localStore().listTickets(limit);
}

/** Explicit, and the only way a ticket leaves without being sent. */
export async function dropTicket(id: string): Promise<void> {
  await localStore().dropTicket(id);
}

/**
 * Sends one ticket, by id.
 *
 * Returns rather than throws, because every caller is a screen deciding what
 * to say — and a thrown error on the support path would be the app failing to
 * report that it is failing.
 */
export async function sendTicket(id: string): Promise<Filed> {
  const ticket = (await localStore().pendingTickets()).find((t) => t.id === id);
  if (ticket === undefined) return { ok: true };

  return deliver(ticket);
}

/**
 * Tries every ticket the device is holding.
 *
 * Called when there is reason to think the situation changed — the support
 * screen opening, or a farm asking. **Not on a timer and not from the sync
 * loop**: a ticket about a broken sync must not be retried by the machinery it
 * is about, and a device in a crash loop retrying reports on a schedule is a
 * device spending its battery on its own bad news.
 */
export async function flushTickets(): Promise<number> {
  let sent = 0;
  for (const ticket of await localStore().pendingTickets()) {
    const filed = await deliver(ticket);
    if (filed.ok) sent += 1;
  }
  return sent;
}

export async function deliver(ticket: StoredTicket): Promise<Filed> {
  /**
   * No origin, no send — and no attempt recorded either.
   *
   * An unconfigured build and a barn with no signal are indistinguishable
   * from inside `fetch` (see `boot/config.ts`), and counting attempts against
   * a ticket that was never on a network would make the screen say it had
   * tried eleven times when it had tried none. The share sheet is the whole
   * answer here, and the ticket keeps for the day an address is set.
   */
  if (apiBase() === null) {
    return { ok: false, error: 'This app has no farm server to send a report to.' };
  }

  let res: Response;
  try {
    res = await fetch(apiUrl('support'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bundle: JSON.parse(ticket.bundle) as unknown,
        ...(ticket.records === undefined ? {} : { records: ticket.records }),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reach the server.';
    await localStore().recordTicketAttempt(ticket.id, message);
    return { ok: false, error: message };
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const said = (body as { error?: unknown } | null)?.error;
    const message = typeof said === 'string' ? said : `The server refused the report (${res.status}).`;
    await localStore().recordTicketAttempt(ticket.id, message);
    return { ok: false, error: message };
  }

  const filedUrl = (body as { url?: unknown } | null)?.url;
  const note = (body as { note?: unknown } | null)?.note;

  await localStore().markTicketSent(
    ticket.id,
    Date.now(),
    typeof filedUrl === 'string' ? filedUrl : null,
  );

  return {
    ok: true,
    ...(typeof filedUrl === 'string' ? { url: filedUrl } : {}),
    ...(typeof note === 'string' ? { note } : {}),
  };
}

/**
 * The ticket as text, for the other door (S7).
 *
 * What goes out through the share sheet — into a message, a mail client, a
 * note, whatever the farm has. It needs no server, no account and no signal
 * beyond whatever the app it is shared into uses, which is the entire point:
 * this is the path that works when `POST /support` is what is broken.
 *
 * **The lean bundle only.** A farm's records are megabytes and no share target
 * would take them as a message; the records half belongs to the route that can
 * put it somewhere. The text says so rather than leaving somebody to wonder
 * why the option disappeared.
 */
export function ticketAsText(bundle: SupportBundle): string {
  return [
    `${PRODUCT_NAME} report ${bundle.fingerprint}`,
    bundle.said === undefined ? null : `\n${bundle.said}\n`,
    JSON.stringify(bundle),
  ]
    .filter((line) => line !== null)
    .join('\n');
}

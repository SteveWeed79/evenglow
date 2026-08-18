import type { Env } from '../env';

/**
 * Getting a message to a person, behind a seam.
 *
 * ## The deliverable is a sender, not one flow
 *
 * `PASSWORD-RECOVERY.md` §1 puts this first because it changes what the work is
 * worth. Password reset is the first customer; the queue behind it is real:
 * **invites are built and stranded** — `POST /invites` binds a token to an
 * address, hands it to the owner, and there the trail ends, so today somebody
 * reads a 43-character token down the phone. `SUPPORT-LOOP.md` §6 has no way to
 * tell a farm their report mattered. `[148]` — "there is no way to tell a farm
 * anything" — stops being structural the moment this exists.
 *
 * So the shape is `sendEmail({ to, subject, text })`, one module, provider
 * behind it, exactly as `blobsFor(orgId)` is the seam for photo bytes.
 *
 * ## Two providers, and why the design document has one
 *
 * `PASSWORD-RECOVERY.md` §8.1 chose Postmark on deliverability and said the
 * port exists "so the choice stays a file rather than a migration". Taking that
 * seriously costs about fifteen lines per provider — both are a POST with a
 * token header — so both are here and the choice is an environment variable.
 *
 * **The document weighed cost at scale and not cost at floor**, which is the
 * axis that actually applies. Its own words: *"Volume is a handful a month, so
 * cost-at-scale — the one axis SES wins — does not apply."* True, and it means
 * the deciding number is the *monthly minimum*, not the per-thousand rate.
 * Postmark's free tier is a hundred messages and is described as being for
 * testing; the paid floor is real money against a project whose entire
 * infrastructure is about $25 a year and whose farms pay $39
 * (`ACCESS-AND-BILLING.md` §4.1). Resend's free tier is three thousand a month,
 * which is roughly a hundred times this flow's volume.
 *
 * So: start on Resend, keep Postmark one variable away for the day inbox
 * placement disappoints. That is not a re-decision of §8.1 — it is what §8.1's
 * own port was for.
 *
 * ## No SDK, either way
 *
 * Both providers are one authenticated POST of JSON. An SDK would be a
 * dependency, a supply-chain surface and a version to keep current, in exchange
 * for `fetch` — which Style says to reach for first, and which is right here.
 */

export interface Email {
  to: string;
  subject: string;
  /**
   * Plain text only, on purpose.
   *
   * Every message this server sends is a short operational sentence and a code.
   * HTML would buy nothing, and it costs: an HTML part is the half that gets
   * clipped, rewritten by the client, or filed as marketing — and a
   * multipart message with a mismatched text alternative is a spam signal in
   * itself. `PASSWORD-RECOVERY.md` §7 lists `html` in the port's shape; it is
   * left out here because nothing needed it and an unused branch that has never
   * been sent is not a feature, it is an untested path.
   */
  text: string;
}

export type MailProvider = 'resend' | 'postmark' | 'log';

/** Why a send did not happen, when the caller is allowed to care. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super('No mail provider is configured.');
    this.name = 'MailNotConfiguredError';
  }
}

export interface Mailer {
  send(message: Email): Promise<void>;
}

/**
 * Whether this server can send at all.
 *
 * Asked at the edge of a route rather than discovered at send time, so a box
 * with no mail configured refuses with a sentence instead of erroring halfway
 * through a flow — the same shape `SUPPORT_GITHUB_TOKEN` and
 * `GOOGLE_PLAY_SERVICE_ACCOUNT` already have.
 */
export function canSendMail(env: Env): boolean {
  return env.mail !== null;
}

async function post(url: string, token: string, body: unknown, header: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', [header]: token },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    /**
     * The provider's own words go to the journal and never to the caller.
     *
     * A rejection body can name the sending domain, the account, and which
     * address bounced — and the caller here is somebody who typed an email
     * address into a public route. `/auth/forgot` answers the same either way
     * (§5), so this exists to be read by whoever runs the box.
     */
    const detail = await res.text().catch(() => '');
    throw new Error(`Mail provider answered ${res.status}: ${detail.slice(0, 300)}`);
  }
}

export function mailerFor(env: Env): Mailer | null {
  const config = env.mail;
  if (config === null) return null;

  const { provider, token, from, replyTo } = config;

  return {
    async send(message: Email): Promise<void> {
      if (provider === 'log') {
        /**
         * A development box that wants to walk the flow without a provider.
         *
         * Deliberately **not** the default: an unconfigured server refuses at
         * the edge rather than pretending to send, because a reset that
         * silently goes nowhere is the failure this whole document exists to
         * prevent. Choosing `log` is an explicit act.
         */
        console.log(
          `[mail:log] to=${message.to} subject=${message.subject}\n${message.text}`,
        );
        return;
      }

      if (provider === 'resend') {
        await post(
          'https://api.resend.com/emails',
          `Bearer ${token}`,
          {
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(replyTo === null ? {} : { reply_to: replyTo }),
          },
          'authorization',
        );
        return;
      }

      await post(
        'https://api.postmarkapp.com/email',
        token,
        {
          From: from,
          To: message.to,
          Subject: message.subject,
          TextBody: message.text,
          ...(replyTo === null ? {} : { ReplyTo: replyTo }),
          MessageStream: 'outbound',
        },
        'x-postmark-server-token',
      );
    },
  };
}

/**
 * Sends, and says whether it got through — without letting the answer reach a
 * caller who must not learn it.
 *
 * **Never throws.** `PASSWORD-RECOVERY.md` §8.3 is explicit: a provider outage
 * must not surface differently from a success, or it reintroduces the
 * enumeration §5 removes. The code is minted and stored before this is called,
 * so a failed send is a farmer who waits and asks again rather than a broken
 * row.
 *
 * The boolean is for the journal and for tests, not for the response body.
 */
export async function trySend(mailer: Mailer | null, message: Email): Promise<boolean> {
  if (mailer === null) return false;
  try {
    await mailer.send(message);
    return true;
  } catch (error) {
    console.error(`mail: send failed — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

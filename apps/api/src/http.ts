/**
 * Thrown by server helpers, converted to a response at the route boundary.
 * Messages are user-facing, so they stay plain and literal (UX-SPEC §6).
 *
 * Deliberately free of any framework type. The conversion to a response is the
 * only part that knows what is serving — a Next handler today, Fastify from
 * S3b — and it lives with the adapter rather than here.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * The body every adapter sends for a failure, so the two servers cannot answer
 * the same condition differently while both are running.
 *
 * An unexpected error never reaches the client as text: it can carry query
 * shape or schema detail, and this bundle is read by anyone with the APK.
 */
/**
 * A framework's own client errors already carry the right status. Replacing
 * them with 500 is not a cosmetic loss: a 429 turned into a 500 tells a client
 * to treat throttling as a server fault and retry into the limiter instead of
 * waiting, and a 400 hidden behind "something went wrong" sends someone
 * looking for an outage that is not there.
 *
 * The status is honoured; the message is not. A framework error's text can
 * name a parser, a header, or a schema, and this service answers a client
 * anyone can unpack from an APK.
 */
function clientErrorMessage(status: number): string {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (status === 413) return 'That is too large to send.';
  if (status === 415) return 'That request was sent in a format the server does not accept.';
  return 'That request could not be read.';
}

export function errorBody(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message } };
  }

  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, body: { error: clientErrorMessage(status) } };
  }

  console.error('Unhandled route error:', error);
  return { status: 500, body: { error: 'Something went wrong.' } };
}

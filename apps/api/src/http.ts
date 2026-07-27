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
export function errorBody(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message } };
  }

  console.error('Unhandled route error:', error);
  return { status: 500, body: { error: 'Something went wrong.' } };
}

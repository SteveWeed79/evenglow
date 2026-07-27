/**
 * Thrown by server helpers, converted to a response at the route boundary.
 * Messages are user-facing, so they stay plain and literal (UX-SPEC §6).
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface ErrorPayload {
  status: number;
  body: { error: string };
}

/**
 * Framework-neutral on purpose: the shape a route sends back, not a Response
 * object. Fastify serialises it, and the sync tests can assert on it without
 * standing up a server.
 */
export function errorResponse(error: unknown): ErrorPayload {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message } };
  }

  // Never leak an unexpected error's text — it can carry query or schema detail.
  console.error('Unhandled route error:', error);
  return { status: 500, body: { error: 'Something went wrong.' } };
}

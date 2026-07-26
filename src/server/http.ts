import { NextResponse } from 'next/server';

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

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // Never leak an unexpected error's text — it can carry query or schema detail.
  console.error('Unhandled route error:', error);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

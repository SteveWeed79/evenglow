import { NextResponse } from 'next/server';
import { errorBody } from '@steading/api/http';

export { HttpError } from '@steading/api/http';

/**
 * The Next adapter over the shared error shape.
 *
 * Thin on purpose: what a failure says is decided in the API package, so the
 * Next routes and the Fastify routes cannot answer the same condition
 * differently while both are serving. This file goes away with the rest of the
 * Next surface in S7.
 */
export function errorResponse(error: unknown): NextResponse {
  const { status, body } = errorBody(error);
  return NextResponse.json(body, { status });
}

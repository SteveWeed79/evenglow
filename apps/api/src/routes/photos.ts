import type { FastifyInstance } from 'fastify';
import { canMutate } from '@steading/contracts';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { blobsFor } from '../db/blobs';
import { scoped, type Tenanted } from '../db/scoped';
import type { Env } from '../env';

/**
 * Only what this route reads. The full shape is `photoCreateSchema`'s, and
 * restating it here would be a second declaration to drift.
 */
interface PhotoRecord extends Tenanted {
  contentType?: string;
  /** Set by a `photo:update` mutation once the bytes have landed. */
  uploadedAt?: number;
}

/**
 * A photo's bytes, in and out.
 *
 * ## The half `photoShape` has been promising since it was written
 *
 * *"Metadata only — the Blob is uploaded separately, which is why
 * `uploadedAt` is optional: the record syncs before the bytes do."* The record
 * half has worked for months: a second phone sees that a photo exists and the
 * gallery says honestly that this device does not have the image. This is the
 * other half, and it is additive exactly as that note predicted — no schema
 * change, no redesign, one new field being set on a record that already
 * allowed it.
 *
 * ## Why bytes are not a mutation
 *
 * Everything else this app writes goes through the envelope: ULID, clientSeq,
 * idempotent upsert, per-mutation result. A photo cannot. Twenty-five
 * megabytes of JPEG in a JSON batch would blow the 100-mutation cap into a
 * request nothing can retry sensibly, and a failed photo would take a
 * morning's egg tallies down with it.
 *
 * So the metadata is a mutation and the bytes are a transfer. The transfer is
 * idempotent by id, does not block the flush, and its completion is recorded
 * by an ordinary `photo:update` mutation setting `uploadedAt` — which means
 * the fact that a photo reached the server is itself a synced record, visible
 * to the farm's other devices through the machinery that already exists.
 *
 * ## 404, never 403
 *
 * The testing rules are explicit and this is the route they matter most on: a
 * photo id from another farm answers 404, exactly as a document id does. A 403
 * would confirm the id exists, and here the thing whose existence is being
 * confirmed is a picture of somebody's yard.
 *
 * The record is checked before the bytes for the same reason. A byte store
 * with no matching record in this org must behave as though nothing is there.
 */

/** Fastify's default body limit is 1 MB. A resized photo runs to a few. */
const MAX_BYTES = 25_000_000;

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'] as const;

export async function photoRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /**
   * Raw bodies for image types only.
   *
   * Registered on this instance rather than globally: a parser that turns any
   * body into a Buffer would quietly change how `/sync` reads a malformed
   * JSON batch, and that route's error behaviour is tested.
   */
  await app.register(async (scope) => {
    for (const type of ACCEPTED) {
      scope.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) => {
        done(null, body);
      });
    }

    scope.put<{ Params: { id: string } }>('/photos/:id', async (request, reply) => {
      // Bytes are a write, so identity, org and role are re-derived from the
      // database rather than read off the token (invariant 8).
      const claims = await requireMutationClaims(request.headers.authorization, env.AUTH_SECRET);

      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        return reply.status(400).send({ error: 'That request carried no image.' });
      }

      const scopeDb = await scoped(claims.orgId);
      const record = await scopeDb.col<PhotoRecord>('photos').findOne({ _id: request.params.id });

      // No record in THIS org — which covers a photo that does not exist and
      // one belonging to another farm, deliberately indistinguishably.
      if (!record) {
        return reply.status(404).send({ error: 'That photo is not on this farm.' });
      }

      /**
       * Which permission a PUT actually needs, and it is not one answer.
       *
       * The role matrix lets a hand CREATE a photo and not UPDATE one. Gating
       * every upload on `update` would have meant a hand takes a photo, its
       * metadata syncs, and its bytes are refused for ever — the record half
       * of the feature working and the byte half silently not, which is the
       * worst shape a permission bug can take.
       *
       * So the first upload is the create being completed: bytes arriving for
       * a photo the farm has not yet recorded as uploaded are the other half
       * of a mutation that was already allowed. Replacing the image on an
       * established photo is a genuine update.
       *
       * Keyed on the RECORD's `uploadedAt` rather than on whether bytes
       * happen to be present, because that keeps the retry honest: a client
       * whose upload succeeded but whose answer was lost has not set
       * `uploadedAt` yet, so its second attempt is still the same create — and
       * a retry that 403s is an upload that can never finish.
       */
      const op = record.uploadedAt === undefined ? 'create' : 'update';
      if (!canMutate(claims.role, 'photo', op)) {
        return reply.status(403).send({ error: 'Your role cannot change this photo.' });
      }

      const store = await blobsFor(claims.orgId);

      const contentType =
        typeof record.contentType === 'string' && ACCEPTED.includes(record.contentType as never)
          ? record.contentType
          : 'image/jpeg';

      await store.put(request.params.id, bytes, contentType);

      /**
       * 200 on a repeat, not 409.
       *
       * A client that timed out waiting for the answer to a successful upload
       * has to be able to try again. `put` replaces, so twice is once — the
       * same property the mutation upsert gives the rest of the app.
       */
      return reply.status(200).send({ id: request.params.id, byteSize: bytes.byteLength });
    });
  });

  /**
   * Read-only, so the token alone decides — the same call `/snapshot` makes,
   * and for the same reason: there is no mutation here to re-derive a role
   * for, and tenancy is the scoped layer's job either way.
   */
  app.get<{ Params: { id: string } }>('/photos/:id', async (request, reply) => {
    const claims = await requireClaims(request.headers.authorization, env.AUTH_SECRET);

    const scopeDb = await scoped(claims.orgId);
    const record = await scopeDb.col<PhotoRecord>('photos').findOne({ _id: request.params.id });
    if (!record) {
      return reply.status(404).send({ error: 'That photo is not on this farm.' });
    }

    const found = await (await blobsFor(claims.orgId)).get(request.params.id);
    // The record exists and the bytes have not arrived yet. A real state —
    // the record syncs first — and not an error on either side.
    if (!found) {
      return reply.status(404).send({ error: 'That photo has not been uploaded yet.' });
    }

    return reply
      .status(200)
      .header('content-type', found.blob.contentType)
      .header('content-length', String(found.blob.byteSize))
      // A photo never changes: the id is a ULID minted for these exact bytes,
      // and a replace is the same picture re-encoded. Immutable saves every
      // second device re-fetching what it already holds.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(found.stream);
  });
}

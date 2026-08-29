import type { FastifyInstance } from 'fastify';
import { canMutate, MAX_PHOTO_BYTES } from '@homefarm/contracts';
import { requireClaims, requireMutationClaims } from '../auth/require';
import { bearerFrom, verifyAccessToken } from '../auth/tokens';
import { errorBody } from '../http';
import { blobsFor } from '../db/blobs';
import { ACCEPTED_IMAGE_TYPES, isImageType, sniffImageType } from './image-bytes';
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
  /** Set by a `photo:delete`. The record survives; the bytes do not. */
  archivedAt?: Date | null;
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

/**
 * Fastify's default body limit is 1 MB and a resized photo runs to a few
 * hundred kilobytes, so this has to be raised — but only to the same number the
 * contract enforces on the record.
 *
 * **Taken from `MAX_PHOTO_BYTES` rather than written again here.** The two
 * limits guard the same thing from opposite ends: the contract refuses an
 * oversized *record* at the boundary, this refuses oversized *bytes*. A local
 * copy of the number is a second declaration to drift, and drift in either
 * direction is a bug — a larger ceiling here accepts bytes for a record that
 * was refused, and a smaller one refuses bytes for a record that was accepted,
 * which the transfer loop would retry for ever (see `sync/photos.ts`).
 */
const MAX_BYTES = MAX_PHOTO_BYTES;

/**
 * The types this route takes, from one declaration shared with the sniffer —
 * a second list here is a second thing to keep in step with what the bytes are
 * actually checked against.
 */
const ACCEPTED = ACCEPTED_IMAGE_TYPES;

export async function photoRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /**
   * Raw bodies for image types only.
   *
   * Registered on this instance rather than globally: a parser that turns any
   * body into a Buffer would quietly change how `/sync` reads a malformed
   * JSON batch, and that route's error behaviour is tested.
   */
  await app.register(async (scope) => {
    /**
     * Sixty a minute per address, on the one route that reads three megabytes.
     *
     * **The scope had no limiter at all**, which made it the cheapest thing on
     * this server to point traffic at: every request buys 3 MB of parsing
     * before anything looks at who sent it. The sibling billing route got 60 a
     * minute for precisely this reasoning and this route is the larger target.
     *
     * Sixty rather than the auth routes' three or five, because the legitimate
     * caller is a device catching up: `sync/photos.ts` moves five per pass and
     * ticks every thirty seconds, so an honest farm clearing a backlog runs at
     * ten a minute — and a farm's several handsets share one address behind a
     * house router. Six times the honest ceiling, and still a bound.
     */
    await scope.register(import('@fastify/rate-limit'), { max: 60, timeWindow: '1 minute' });

    /**
     * A valid token before three megabytes are read, not after.
     *
     * Fastify parses the body between `onRequest` and the handler, so
     * authenticating inside the handler means an **anonymous** request already
     * bought `MAX_BYTES` of buffer before it was refused. The limiter above
     * bounds how often; this bounds who, and it is the half that costs nothing
     * to get right.
     *
     * **This is a gate, not an authorization**, and the distinction matters
     * because invariant 8 is about the second thing. All it proves is that the
     * caller holds a token this server signed and has not expired — no
     * database, no org, no role. The handler still calls
     * `requireMutationClaims`, which re-derives identity, org and role from the
     * database and is the only thing that decides anything. A signature check
     * that can only ever REFUSE cannot fail open.
     *
     * The GET below is registered outside this scope and needs none of it: it
     * has no body to parse.
     */
    scope.addHook('onRequest', async (request, reply) => {
      const token = bearerFrom(request.headers.authorization);
      if (token === null) {
        return reply.status(401).send({ error: 'Not signed in.' });
      }

      try {
        await verifyAccessToken(token, env.AUTH_SECRET);
      } catch (error) {
        const { status, body } = errorBody(error);
        return reply.status(status).send(body);
      }

      return undefined;
    });

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

      /**
       * What the bytes are, rather than what anybody said they were.
       *
       * **Nothing looked at them before.** The declared content type chose the
       * parser and the record's content type chose what came back out, so the
       * store held whatever a farm account cared to send, filed as an image.
       * With a React Native `Image` reading it that is close to harmless, and
       * that is the reason to fix it now rather than the reason not to: the day
       * a photo URL is opened in a WebView or a browser, the bytes decide and
       * the label does not.
       */
      const actual = sniffImageType(bytes);
      if (actual === null) {
        return reply.status(415).send({ error: 'That file is not an image this app can store.' });
      }

      /**
       * The record's type has to agree, and a mismatch is refused rather than
       * quietly corrected.
       *
       * Storing PNG bytes under the JPEG the record claims would leave the
       * farm's own record disagreeing with its image — and the record is what
       * every other device reads. A client whose two halves disagree has a bug
       * worth being told about; re-labelling silently would hide it and leave
       * the second device to find out.
       *
       * A record with no type, or one written before this existed, is taken at
       * the bytes' word: there is nothing to disagree with.
       */
      const claimed = record.contentType;
      if (isImageType(claimed) && claimed !== actual) {
        return reply
          .status(415)
          .send({ error: 'Those bytes are not the kind of image that photo says it is.' });
      }

      const store = await blobsFor(claims.orgId);

      // The sniffed type, not the claimed one: it is the only one of the two
      // that has been checked against anything.
      await store.put(request.params.id, bytes, actual);

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
    if (!found) {
      /**
       * Two different absences, told apart.
       *
       * A record whose bytes have not arrived is an ordinary state — the
       * record syncs first — and the gallery says honestly that this device
       * does not have the image. A record that was **deleted** has had its
       * bytes removed on purpose, and the image is not coming. Answering
       * "not uploaded yet" for that one sends a farm looking for a phone
       * that still holds it, which is a search that cannot end.
       */
      return reply.status(404).send({
        error:
          record.archivedAt === undefined || record.archivedAt === null
            ? 'That photo has not been uploaded yet.'
            : 'That photo was deleted.',
      });
    }

    return reply
      .status(200)
      .header('content-type', found.blob.contentType)
      .header('content-length', String(found.blob.byteSize))
      /**
       * Never sniffed, whatever the bytes look like.
       *
       * The PUT checks the leading bytes against the type it is told, so what
       * is stored is an image — this is the second half of that, and it is the
       * half that survives a record written before the check existed. A browser
       * or a WebView that guesses at a content type is how stored bytes become
       * executable, and the guess is what this turns off.
       */
      .header('x-content-type-options', 'nosniff')
      // A photo never changes: the id is a ULID minted for these exact bytes,
      // and a replace is the same picture re-encoded. Immutable saves every
      // second device re-fetching what it already holds.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(found.stream);
  });
}

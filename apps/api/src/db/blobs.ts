import { GridFSBucket, ObjectId } from 'mongodb';
import type { Readable } from 'node:stream';
import { db } from './client';

/**
 * Where a photo's bytes live on the server.
 *
 * ## GridFS, because a photo does not fit in a document
 *
 * `photoShape` allows 25 MB and a BSON document caps at 16. GridFS is part of
 * the driver already — no new dependency, no bucket to provision, no
 * credentials to keep out of a bundle (invariant 12). An object store would be
 * the right answer at a scale this product does not have, and would arrive
 * with a secret and a second thing to back up.
 *
 * ## The ONLY module that opens a bucket, for `scoped`'s reason
 *
 * `scoped.ts` exists so that tenancy is a mechanism rather than a policy:
 * every filter carries `orgId` because there is nowhere else to write one. The
 * same argument applies to bytes, and more sharply — a photo of a farm is not
 * a row that leaks a count, it is a picture of somebody's animals and
 * somebody's yard.
 *
 * So this file mirrors it exactly. `blobsFor(orgId)` is the only way in, every
 * write stamps `orgId` into the file's metadata, and every read filters on it.
 * There is no unscoped variant and no escape hatch.
 *
 * ## Named by the photo's own id
 *
 * `filename` is the record's ULID. A GridFS `_id` would be a second identifier
 * to store and to keep in step; the ULID is already unique, already minted on
 * the device, and already the thing the rest of the app holds. Lookups are by
 * `filename` plus `metadata.orgId`, which is the pair that has to match.
 */

/** What a caller may know about stored bytes without reading them. */
export interface StoredBlob {
  byteSize: number;
  contentType: string;
  uploadedAt: Date;
}

export interface Blobs {
  /**
   * Writes bytes for one photo, replacing anything already there.
   *
   * **Replace rather than reject**, which is what makes the upload idempotent:
   * a client that retries after a timeout it never saw the answer to must not
   * get a 409 for succeeding twice. The old revision is deleted after the new
   * one lands, so an interrupted replace leaves the old bytes rather than
   * nothing.
   */
  put(id: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The bytes, or null when this org has none under that id. */
  get(id: string): Promise<{ stream: Readable; blob: StoredBlob } | null>;
  /** What is stored, without moving the bytes. */
  head(id: string): Promise<StoredBlob | null>;
  remove(id: string): Promise<void>;
}

const BUCKET = 'photoBytes';

export async function blobsFor(orgId: string): Promise<Blobs> {
  const database = await db();
  const bucket = new GridFSBucket(database, { bucketName: BUCKET });

  /** Every lookup in this file goes through here. There is no other filter. */
  async function findOne(id: string): Promise<{ _id: ObjectId; blob: StoredBlob } | null> {
    const [file] = await bucket
      .find({ filename: id, 'metadata.orgId': orgId })
      // Newest first, so an interrupted replace that left two revisions
      // answers with the one that finished last rather than an arbitrary one.
      .sort({ uploadDate: -1 })
      .limit(1)
      .toArray();

    if (!file) return null;

    return {
      _id: file._id,
      blob: {
        byteSize: file.length,
        contentType:
          typeof file.metadata?.contentType === 'string'
            ? file.metadata.contentType
            : 'image/jpeg',
        uploadedAt: file.uploadDate,
      },
    };
  }

  return {
    async put(id, bytes, contentType): Promise<void> {
      const previous = await findOne(id);

      await new Promise<void>((resolve, reject) => {
        const stream = bucket.openUploadStream(id, {
          metadata: { orgId, contentType },
        });
        stream.on('error', reject);
        stream.on('finish', () => resolve());
        stream.end(bytes);
      });

      /**
       * The old revision goes only after the new one is safely written.
       *
       * The other order is a window where a crash loses the photo entirely.
       * This order's worst case is two revisions on disk until the next
       * replace, and `findOne` already prefers the newer.
       */
      if (previous) await bucket.delete(previous._id);
    },

    async get(id): Promise<{ stream: Readable; blob: StoredBlob } | null> {
      const found = await findOne(id);
      if (!found) return null;

      return { stream: bucket.openDownloadStream(found._id), blob: found.blob };
    },

    async head(id): Promise<StoredBlob | null> {
      const found = await findOne(id);
      return found === null ? null : found.blob;
    },

    async remove(id): Promise<void> {
      const found = await findOne(id);
      if (found) await bucket.delete(found._id);
    },
  };
}

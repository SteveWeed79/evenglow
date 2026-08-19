import { photoCreateSchema } from '@homefarm/contracts';
import { localStore } from '../db/store';

/**
 * Photos kept against a machine, a group or a planting.
 *
 * Metadata only — `photoShape` has said so since it was written, and the bytes
 * live on the device that took them (`apps/mobile/src/photos/store.ts`). A
 * second phone reads these records and knows a photo exists without having the
 * image, which is why `uploadedAt` is optional and why the gallery says which
 * device has it rather than showing an empty frame.
 */

export interface Photo {
  id: string;
  subjectId: string;
  contentType: string;
  byteSize: number;
  capturedAt: number;
  uploadedAt?: number;
  caption?: string;
}

const stored = photoCreateSchema.partial();

export async function listPhotos(): Promise<Photo[]> {
  const records = await localStore().readRecordsByEntity('photo');

  return records
    .filter((record) => !record.deleted)
    .flatMap((record) => {
      const parsed = stored.safeParse(record.value);
      const { subjectId, contentType, byteSize, capturedAt, uploadedAt, caption } = parsed.success
        ? parsed.data
        : {};

      if (subjectId === undefined || capturedAt === undefined) return [];

      return [
        {
          id: record.targetId,
          subjectId,
          contentType: contentType ?? 'image/jpeg',
          byteSize: byteSize ?? 0,
          capturedAt,
          ...(uploadedAt === undefined ? {} : { uploadedAt }),
          ...(caption === undefined ? {} : { caption }),
        } satisfies Photo,
      ];
    })
    // Newest first: the one just taken is the one being looked for.
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

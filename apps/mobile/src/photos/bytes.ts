import type { PhotoBytes } from '@steading/core/sync/photos';
import { hasBytes, photoFile } from './store';

/**
 * The device's photo files, as the transfer expects them.
 *
 * `packages/core` compiles for a server as well as a handset and cannot import
 * expo-file-system, so the transfer states the shape it needs and this
 * supplies it — the same seam as `setApiBase`, `setAccessToken` and the SQL
 * driver, and for the same reason: the sync modules must not know which
 * platform they are on.
 *
 * A thin adapter on purpose. Everything about where a photo lives, what it is
 * named and why it is under `Paths.document` rather than the cache stays in
 * `store.ts`, which is the file that knows.
 */
export const deviceBytes: PhotoBytes = {
  has(id) {
    return hasBytes(id);
  },

  async read(id) {
    const file = photoFile(id);
    // The record says bytes exist and the file is gone — a photo cleared by
    // the OS or removed out from under the app. Null rather than a throw: the
    // transfer treats it as nothing to send, which is the truth.
    if (!file.exists) return null;
    return file.bytes();
  },

  async write(id, data) {
    const file = photoFile(id);
    /**
     * Created before writing, and only when absent.
     *
     * `photoFile` resolves a path inside the photos directory but does not
     * make the file; a download landing on a device that has never taken a
     * photo is the case where nothing has created it yet.
     */
    if (!file.exists) file.create({ intermediates: true });
    file.write(data);
  },
};

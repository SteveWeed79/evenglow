import { describe, expect, it } from 'vitest';
import {
  canMutate,
  ENTITIES,
  isAppendOnly,
  isRole,
  isUploadStamp,
  OPS,
  ROLES,
} from '@steading/contracts';

describe('role matrix', () => {
  it('recognises exactly the three roles', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'hand']);
    expect(isRole('owner')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it.each(['owner', 'admin'] as const)('%s may perform every operation', (role) => {
    for (const entity of ENTITIES) {
      for (const op of OPS) expect(canMutate(role, entity, op)).toBe(true);
    }
  });

  describe('hand', () => {
    it('may record every append-only observation', () => {
      for (const entity of ENTITIES.filter(isAppendOnly)) {
        expect(canMutate('hand', entity, 'create')).toBe(true);
      }
    });

    it('may never edit an append-only observation', () => {
      for (const entity of ENTITIES.filter(isAppendOnly)) {
        expect(canMutate('hand', entity, 'update')).toBe(false);
      }
    });

    /**
     * A hand may take back what a hand may write.
     *
     * The person who mis-logged the tally is standing at the coop with the
     * phone in their hand. Sending them to find the owner, who then removes a
     * record they never saw from a description given hours later, is worse for
     * the data than letting them fix it — and it is why this used to read
     * `create` only.
     */
    it('may take back an append-only observation it recorded', () => {
      for (const entity of ENTITIES.filter(isAppendOnly)) {
        expect(canMutate('hand', entity, 'delete')).toBe(true);
      }
    });

    it('is read-only on the entities that define the farm', () => {
      for (const entity of ['flock', 'equipment', 'maintenance'] as const) {
        for (const op of OPS) expect(canMutate('hand', entity, op)).toBe(false);
      }
    });

    it('may complete an assigned chore but not define new work', () => {
      expect(canMutate('hand', 'task', 'update')).toBe(true);
      expect(canMutate('hand', 'task', 'create')).toBe(false);
      expect(canMutate('hand', 'task', 'delete')).toBe(false);
    });

    it('may attach a photo but not edit or remove one', () => {
      expect(canMutate('hand', 'photo', 'create')).toBe(true);
      expect(canMutate('hand', 'photo', 'update')).toBe(false);
      expect(canMutate('hand', 'photo', 'delete')).toBe(false);
    });
  });
});

/**
 * The exception that lets a hand finish a photo.
 *
 * `photo:update` stays refused above, and that is deliberate: `canMutate` also
 * gates the byte PUT, so granting it there would let a hand replace the image
 * on an established photo. The stamp is expressed on the mutation instead.
 */
describe('the photo upload stamp', () => {
  it('is a photo update carrying nothing but uploadedAt', () => {
    expect(isUploadStamp('photo', 'update', { uploadedAt: 1 })).toBe(true);
  });

  it('is not a stamp once anything travels beside it', () => {
    // The whole point of the narrowing: a hand must not smuggle a caption or a
    // re-linked subject through on the back of an upload.
    expect(isUploadStamp('photo', 'update', { uploadedAt: 1, caption: 'mine now' })).toBe(false);
    expect(isUploadStamp('photo', 'update', { caption: 'mine now' })).toBe(false);
    expect(isUploadStamp('photo', 'update', { uploadedAt: 1, subjectId: 'x' })).toBe(false);
    expect(isUploadStamp('photo', 'update', {})).toBe(false);
  });

  it('is not a stamp on another entity or another op', () => {
    expect(isUploadStamp('flock', 'update', { uploadedAt: 1 })).toBe(false);
    expect(isUploadStamp('photo', 'create', { uploadedAt: 1 })).toBe(false);
    expect(isUploadStamp('photo', 'delete', { uploadedAt: 1 })).toBe(false);
  });

  it('refuses anything that is not a plain object', () => {
    for (const payload of [null, undefined, 'uploadedAt', 7, ['uploadedAt']]) {
      expect(isUploadStamp('photo', 'update', payload)).toBe(false);
    }
  });
});

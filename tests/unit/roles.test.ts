import { describe, expect, it } from 'vitest';
import { ENTITIES, isAppendOnly, OPS } from '@/lib/contracts/mutation';
import { canMutate, isRole, ROLES } from '@/lib/contracts/roles';

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

    it('may never update or delete an append-only observation', () => {
      for (const entity of ENTITIES.filter(isAppendOnly)) {
        expect(canMutate('hand', entity, 'update')).toBe(false);
        expect(canMutate('hand', entity, 'delete')).toBe(false);
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

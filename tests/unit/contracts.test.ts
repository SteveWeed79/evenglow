import { describe, expect, it } from 'vitest';
import {
  aOrAn,
  entityNoun,
  OPS,
  roleRefusal,
  appendOnlyIsNeverEdited,
  canMutate,
  eggLogCreateSchema,
  ENTITIES,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  isAppendOnly,
  isOpAllowed,
  isUlid,
  maintenanceCreateSchema,
  MAX_BATCH_SIZE,
  mutationSchema,
  newId,
  payloadSchemaFor,
  syncRequestSchema,
} from '@steading/contracts';
import { makeMutation } from '../support/fixtures';

describe('ULIDs', () => {
  it('mints ids that satisfy the wire contract', () => {
    for (let i = 0; i < 50; i++) expect(isUlid(newId())).toBe(true);
  });

  it('rejects a 26-character string that is not a ULID', () => {
    // Length alone would let this become an _id.
    expect(isUlid(' '.repeat(26))).toBe(false);
    expect(isUlid('IIIIIIIIIIIIIIIIIIIIIIIIII')).toBe(false);
  });
});

describe('mutation envelope', () => {
  it('accepts a well-formed mutation', () => {
    expect(mutationSchema.safeParse(makeMutation()).success).toBe(true);
  });

  it('rejects unknown fields', () => {
    const withExtra = { ...makeMutation(), sneaky: true };
    expect(mutationSchema.safeParse(withExtra).success).toBe(false);
  });

  it('rejects a payload-supplied orgId on the batch (C2)', () => {
    const body = { orgId: 'org-b', mutations: [makeMutation()] };
    expect(syncRequestSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a batch over the hard cap', () => {
    const tooMany = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => makeMutation());
    expect(syncRequestSchema.safeParse({ mutations: tooMany }).success).toBe(false);
  });

  it('accepts a batch at exactly the cap', () => {
    const exact = Array.from({ length: MAX_BATCH_SIZE }, () => makeMutation());
    expect(syncRequestSchema.safeParse({ mutations: exact }).success).toBe(true);
  });

  it('rejects a malformed deviceId', () => {
    expect(mutationSchema.safeParse(makeMutation({ deviceId: 'device-1' })).success).toBe(false);
  });

  it('rejects a negative clientSeq', () => {
    expect(mutationSchema.safeParse(makeMutation({ clientSeq: -1 })).success).toBe(false);
  });
});

describe('append-only entities (D3)', () => {
  /**
   * Immutable in value, removable in whole. The refusal that matters is
   * `update` — an observation's value never changes, which is what makes these
   * unable to conflict. A delete archives, and an archive is repeatable, so it
   * cannot conflict either.
   */
  it.each(ENTITIES.filter(isAppendOnly))('%s can be written and taken back, never edited', (entity) => {
    expect(appendOnlyIsNeverEdited(entity)).toBe(true);
    expect(isOpAllowed(entity, 'create')).toBe(true);
    expect(isOpAllowed(entity, 'update')).toBe(false);
    expect(isOpAllowed(entity, 'delete')).toBe(true);
  });

  it.each(ENTITIES.filter((e) => !isAppendOnly(e)))('%s supports all three ops', (entity) => {
    for (const op of ['create', 'update', 'delete'] as const) {
      expect(isOpAllowed(entity, op)).toBe(true);
    }
  });

  it('every entity has at least a create schema', () => {
    for (const entity of ENTITIES) {
      expect(payloadSchemaFor(entity, 'create')).toBeDefined();
    }
  });
});

describe('entity payloads', () => {
  it('an egg log needs exactly one subject', () => {
    const base = { occurredAt: 1, count: 18 };
    const flockId = newId();
    const birdId = newId();

    expect(eggLogCreateSchema.safeParse({ ...base, flockId }).success).toBe(true);
    expect(eggLogCreateSchema.safeParse({ ...base, birdId }).success).toBe(true);
    // Neither, or both, is unresolvable at apply time.
    expect(eggLogCreateSchema.safeParse(base).success).toBe(false);
    expect(eggLogCreateSchema.safeParse({ ...base, flockId, birdId }).success).toBe(false);
  });

  it('a maintenance schedule needs at least one trigger', () => {
    const base = { equipmentId: newId(), title: 'Engine oil' };

    expect(maintenanceCreateSchema.safeParse(base).success).toBe(false);
    expect(maintenanceCreateSchema.safeParse({ ...base, intervalHours: 250 }).success).toBe(true);
    expect(maintenanceCreateSchema.safeParse({ ...base, intervalDays: 180 }).success).toBe(true);
  });

  /**
   * The inspection checklist (P15) is bounded at both ends: a list longer than
   * a walkaround gets skipped wholesale, and a blank line is a row somebody
   * would stand in front of a machine trying to interpret.
   */
  it('bounds a schedule checklist', () => {
    const base = { equipmentId: newId(), title: 'Engine oil', intervalHours: 250 };

    expect(maintenanceCreateSchema.safeParse({ ...base, checks: ['Drain plug'] }).success).toBe(true);
    expect(maintenanceCreateSchema.safeParse({ ...base, checks: [] }).success).toBe(true);
    expect(maintenanceCreateSchema.safeParse({ ...base, checks: [''] }).success).toBe(false);
    expect(
      maintenanceCreateSchema.safeParse({ ...base, checks: Array(21).fill('Grease') }).success,
    ).toBe(false);
  });

  it('rejects unknown payload fields', () => {
    const payload = { occurredAt: 1, count: 18, flockId: newId(), nope: 1 };
    expect(eggLogCreateSchema.safeParse(payload).success).toBe(false);
  });

  describe('inventory', () => {
    const base = { name: 'Layer pellets', kind: 'feed', unit: 'bag', quantity: 6 } as const;

    it('accepts a stock item', () => {
      expect(inventoryCreateSchema.safeParse(base).success).toBe(true);
    });

    it('allows a fractional quantity', () => {
      // Half a bale is a real quantity; forcing integers would make the user lie.
      expect(inventoryCreateSchema.safeParse({ ...base, quantity: 2.5 }).success).toBe(true);
    });

    it('refuses a negative quantity', () => {
      expect(inventoryCreateSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
    });

    it('links a part to the machine it services', () => {
      const withMachine = { ...base, kind: 'part', equipmentId: newId(), reorderBelow: 2 };
      expect(inventoryCreateSchema.safeParse(withMachine).success).toBe(true);
    });

    it('rejects an equipmentId that is not a ULID', () => {
      expect(inventoryCreateSchema.safeParse({ ...base, equipmentId: 'tractor' }).success).toBe(
        false,
      );
    });

    it('rejects an unknown unit rather than storing free text', () => {
      expect(inventoryCreateSchema.safeParse({ ...base, unit: 'truckload' }).success).toBe(false);
    });

    it('allows a partial update', () => {
      expect(inventoryUpdateSchema.safeParse({ quantity: 3 }).success).toBe(true);
    });
  });
});

describe('inventory authorization', () => {
  it('is mutable, so a hand may not change stock levels', () => {
    // Inventory defines what things are, not what happened — the same line
    // that keeps flocks and equipment out of a hand's reach.
    for (const op of ['create', 'update', 'delete'] as const) {
      expect(canMutate('hand', 'inventory', op)).toBe(false);
      expect(canMutate('owner', 'inventory', op)).toBe(true);
      expect(canMutate('admin', 'inventory', op)).toBe(true);
    }
  });
});


/**
 * The sentence a farmer reads when their role will not let them do something.
 *
 * `pnpm db:verify` printed "Your role cannot update a eggLog." against a real
 * database - two mistakes in five words, both from building a sentence out of
 * an enum: a schema name nobody has ever seen, behind the wrong article.
 */
describe('what a refusal says out loud', () => {
  it('uses the farm word, never the schema name', () => {
    expect(roleRefusal('update', 'eggLog')).toBe('Your role cannot change an egg count.');
    expect(roleRefusal('create', 'flock')).toBe('Your role cannot record a group.');
    expect(roleRefusal('delete', 'medication')).toBe('Your role cannot remove a treatment.');
  });

  it('gets the article right in front of a vowel', () => {
    expect(aOrAn('egg count')).toBe('an egg count');
    expect(aOrAn('animal')).toBe('an animal');
    expect(aOrAn('group')).toBe('a group');
  });

  it('has a word for every entity, so no sentence can fall back to an enum', () => {
    for (const entity of ENTITIES) {
      const noun = entityNoun(entity);
      expect(noun.length).toBeGreaterThan(0);
      // A schema name would give itself away with a capital in the middle.
      expect(noun).toBe(noun.toLowerCase());
    }
  });

  it('never leaks a camelCase schema name into a sentence', () => {
    for (const entity of ENTITIES) {
      for (const op of OPS) {
        const said = roleRefusal(op, entity);
        expect(said).not.toMatch(/[a-z][A-Z]/);
        expect(said.endsWith('.')).toBe(true);
      }
    }
  });
});

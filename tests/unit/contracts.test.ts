import { describe, expect, it } from 'vitest';
import {
  appendOnlyOpsAreCreateOnly,
  eggLogCreateSchema,
  isOpAllowed,
  maintenanceCreateSchema,
  payloadSchemaFor,
} from '@steading/contracts';
import {
  ENTITIES,
  isAppendOnly,
  MAX_BATCH_SIZE,
  mutationSchema,
  syncRequestSchema,
} from '@steading/contracts';
import { isUlid, newId } from '@steading/contracts';
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
  it.each(ENTITIES.filter(isAppendOnly))('%s accepts create only', (entity) => {
    expect(appendOnlyOpsAreCreateOnly(entity)).toBe(true);
    expect(isOpAllowed(entity, 'create')).toBe(true);
    expect(isOpAllowed(entity, 'update')).toBe(false);
    expect(isOpAllowed(entity, 'delete')).toBe(false);
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

  it('rejects unknown payload fields', () => {
    const payload = { occurredAt: 1, count: 18, flockId: newId(), nope: 1 };
    expect(eggLogCreateSchema.safeParse(payload).success).toBe(false);
  });
});

import { ulid } from 'ulid';
import { MUTATION_SCHEMA_VERSION, type Mutation } from '@homefarm/contracts';

const DEVICE_ID = '00000000-0000-4000-8000-000000000001';

let seq = 0;

/** A well-formed mutation, so each test only has to state what it is varying. */
export function makeMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    schemaVersion: MUTATION_SCHEMA_VERSION,
    id: ulid(),
    targetId: ulid(),
    entity: 'eggLog',
    op: 'create',
    payload: { occurredAt: 1_700_000_000_000, flockId: ulid(), count: 18 },
    deviceId: DEVICE_ID,
    clientSeq: seq++,
    clientTs: 1_700_000_000_000,
    ...overrides,
  };
}

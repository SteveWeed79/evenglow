import { describe, expect, it } from 'vitest';
import {
  ENTITIES,
  equipmentUpdateSchema,
  flockUpdateSchema,
  isAppendOnly,
  medicationUpdateSchema,
  partitionClears,
  payloadSchemaFor,
  taskCreateSchema,
  taskUpdateSchema,
  type Entity,
} from '@homefarm/contracts';
import { updateFor } from '@homefarm/api/sync/apply';

/**
 * `null` means "remove this field", and the rules about where it may say so.
 *
 * The defect behind this: naming an optional field with `undefined` beside it
 * cleared the handset and stopped there, because `JSON.stringify` drops the key
 * and the server's `$set` then leaves the old value standing. Two screens did
 * exactly that in shipped builds — the *Need to redo this* button on Jobs, and
 * every optional field on a treatment — so a farm could un-tick a chore or
 * revise a withdrawal to nothing and have the change hold on one phone and
 * nowhere else.
 *
 * These pin the three decisions in `contracts/clearing.ts` that make the fix
 * safe rather than merely present: which fields may be cleared, which may not,
 * and the fact that a nested `null` is still a value.
 */

describe('what an update may clear', () => {
  it('accepts null for a field a create could have omitted', () => {
    expect(flockUpdateSchema.safeParse({ breedId: null }).success).toBe(true);
    expect(flockUpdateSchema.safeParse({ bornAt: null }).success).toBe(true);
    expect(flockUpdateSchema.safeParse({ processAtWeeks: null }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ completedAt: null }).success).toBe(true);
  });

  it('keeps the value itself parsing, so clearing is an addition and not a swap', () => {
    expect(flockUpdateSchema.safeParse({ breedId: 'australorp' }).success).toBe(true);
    expect(flockUpdateSchema.safeParse({ breedId: 12 }).success).toBe(false);
  });

  /**
   * A cleared required field is a record no reader can parse, which the client
   * drops from every list — indistinguishable, to whoever just edited it, from
   * the app losing their animals.
   */
  it('refuses null for a field the record cannot do without', () => {
    expect(flockUpdateSchema.safeParse({ name: null }).success).toBe(false);
    expect(flockUpdateSchema.safeParse({ count: null }).success).toBe(false);
    expect(medicationUpdateSchema.safeParse({ name: null }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ title: null }).success).toBe(false);
  });

  /**
   * A field with a default is never absent — a reader applies the default as it
   * parses — so "clear it" and "set it to the default" would be two spellings
   * of one act, and the second already works.
   */
  it('refuses null for a field that carries a default', () => {
    expect(taskUpdateSchema.safeParse({ recurrence: null }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ recurrence: 'weekly' }).success).toBe(true);
  });

  it('refuses null on a create, where there is nothing to remove', () => {
    const complete = { title: 'Fix the gate', recurrence: 'none' as const };

    expect(taskCreateSchema.safeParse({ ...complete, completedAt: null }).success).toBe(false);
    expect(taskCreateSchema.safeParse(complete).success).toBe(true);
  });

  /**
   * Every mutable entity, so the next one added cannot arrive without this.
   *
   * The check is the property rather than a list: wherever an update schema
   * accepts a field that the create schema would have let you leave out, it
   * must accept `null` for it. An entity wired straight to
   * `z.object(shape).partial().strict()` — the old spelling — fails here.
   *
   * Fields an update does not accept at all are not this rule's business.
   * `note` is the one instance: its update carries `body` and nothing else,
   * because what a note is *about* is fixed when it is written.
   */
  it('holds for every entity that can be updated', () => {
    const mutable = ENTITIES.filter(
      (entity: Entity) => !isAppendOnly(entity) && payloadSchemaFor(entity, 'update') !== undefined,
    );

    // A guard on the guard: an empty list would make this pass vacuously.
    expect(mutable.length).toBeGreaterThan(8);

    const shapeOf = (schema: unknown): Record<string, unknown> =>
      (schema as { shape?: Record<string, unknown> }).shape ?? {};

    const omittable = (field: unknown): boolean => {
      const probe = (
        field as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
      ).safeParse(undefined);
      return probe.success && probe.data === undefined;
    };

    const unclearable: string[] = [];
    let checked = 0;

    for (const entity of mutable) {
      const update = payloadSchemaFor(entity, 'update');
      const create = payloadSchemaFor(entity, 'create');
      if (update === undefined || create === undefined) continue;

      const editable = new Set(Object.keys(shapeOf(update)));

      for (const [key, field] of Object.entries(shapeOf(create))) {
        if (!editable.has(key) || !omittable(field)) continue;
        checked += 1;
        if (!update.safeParse({ [key]: null }).success) unclearable.push(`${entity}.${key}`);
      }
    }

    expect(unclearable).toEqual([]);
    // Names a real number of fields rather than passing on an empty walk.
    expect(checked).toBeGreaterThan(30);
  });
});

/**
 * An update carries what was edited, and nothing else (H9).
 *
 * `.partial()` makes a key optional; it does **not** strip a `.default()`, and
 * `ZodOptional` delegates to its inner schema for a missing key rather than
 * short-circuiting:
 *
 *   z.optional(z.enum(['none','weekly']).default('none')).parse(undefined)
 *     -> 'none'
 *
 * So every defaulted field wrote itself into every update that did not mention
 * it, and the server `$set` what it was handed. The describe above states the
 * rule that a defaulted field is not *clearable*; this one states the rule that
 * it is not *sent*, and only one of the two was being enforced.
 */
describe('what an update must not invent', () => {
  it('adds nothing to an empty payload', () => {
    expect(taskUpdateSchema.parse({})).toEqual({});
    expect(equipmentUpdateSchema.parse({})).toEqual({});
  });

  it('adds nothing beside the field that was edited', () => {
    expect(taskUpdateSchema.parse({ title: 'Check the water trough' })).toEqual({
      title: 'Check the water trough',
    });
    expect(equipmentUpdateSchema.parse({ name: 'Kubota' })).toEqual({ name: 'Kubota' });
  });

  /**
   * The report that this cost a farm, spelled out.
   *
   * `JobsScreen` un-ticks a job by sending `{ completedAt: null }` — the legacy
   * path, for a task with no completion event. That payload used to arrive as
   * `{ completedAt: null, recurrence: 'none' }`, so un-ticking a weekly chore
   * quietly converted it to a one-off; `taskDues` then returns nothing after
   * its next completion and the job never appears again.
   */
  it('does not turn a weekly chore into a one-off when it is un-ticked', () => {
    const sent = taskUpdateSchema.parse({ completedAt: null });

    expect(sent).toEqual({ completedAt: null });
    expect(Object.hasOwn(sent, 'recurrence')).toBe(false);
  });

  /**
   * Every mutable entity, so the next defaulted field added cannot arrive
   * carrying this bug — the same shape as the clearability walk above, and the
   * reason that one is a property rather than a list.
   */
  it('holds for every entity that can be updated', () => {
    const mutable = ENTITIES.filter(
      (entity: Entity) => !isAppendOnly(entity) && payloadSchemaFor(entity, 'update') !== undefined,
    );

    // A guard on the guard: an empty list would make this pass vacuously.
    expect(mutable.length).toBeGreaterThan(8);

    const invented: string[] = [];
    const cannotBeEmpty: string[] = [];
    let checked = 0;

    for (const entity of mutable) {
      const update = payloadSchemaFor(entity, 'update');
      if (update === undefined) continue;

      const parsed = update.safeParse({});
      if (!parsed.success) {
        // An update with a required field of its own, which is a different
        // rule and not this one's business. Collected rather than ignored so
        // the exception has to stay the one we know about.
        cannotBeEmpty.push(entity);
        continue;
      }

      checked += 1;
      for (const key of Object.keys(parsed.data as Record<string, unknown>)) {
        invented.push(`${entity}.${key}`);
      }
    }

    expect(invented).toEqual([]);
    /**
     * `note` is the one, and it is hand-built rather than made by
     * `updateSchemaOf`: `z.object({ body: z.string().min(1) }).strict()`,
     * because what a note is *about* is fixed when it is written and only the
     * body can be edited. The sibling walk above names the same exception.
     */
    expect(cannotBeEmpty).toEqual(['note']);
    // Names a real number of schemas rather than passing on an empty walk.
    expect(checked).toBeGreaterThan(8);
  });

  /**
   * And the other half of the same coin: a CREATE still applies its defaults.
   *
   * Stripping the default from the update shape must not reach the create
   * shape, which is built from the raw fields — a create that stopped
   * defaulting `recurrence` would write records the due engine cannot read.
   */
  it('leaves a create still applying its defaults', () => {
    expect(taskCreateSchema.parse({ title: 'Water the trough' })).toMatchObject({
      recurrence: 'none',
    });
  });
});

describe('partitionClears', () => {
  it('splits a payload into what it sets and what it removes', () => {
    expect(partitionClears({ count: 12, breedId: null, name: 'The hens' })).toEqual({
      set: { count: 12, name: 'The hens' },
      clear: ['breedId'],
    });
  });

  it('reports nothing to clear for an ordinary edit', () => {
    expect(partitionClears({ count: 12 })).toEqual({ set: { count: 12 }, clear: [] });
  });

  /**
   * `flock.careIntervals` is `{ worming: null }` for *"never ask about
   * worming"* — a value the farm chose. The clearing rule stops at the first
   * level so the two can live side by side: `careIntervals: null` drops the
   * farm's whole opinion, `careIntervals: { worming: null }` records one.
   */
  it('leaves a null one level down alone', () => {
    expect(partitionClears({ careIntervals: { worming: null } })).toEqual({
      set: { careIntervals: { worming: null } },
      clear: [],
    });
  });

  it('does not mistake an empty string, a zero or an empty array for a clear', () => {
    expect(partitionClears({ note: '', count: 0, purposes: [] }).clear).toEqual([]);
  });
});

describe('what the applier hands Mongo', () => {
  const stamp = {
    updatedAt: new Date('2026-08-16T09:00:00Z'),
    updatedBy: 'user',
    updatedByDevice: 'device',
  };

  it('sets what changed and unsets what was cleared', () => {
    expect(updateFor({ count: 18, breedId: null }, stamp)).toEqual({
      $set: { count: 18, ...stamp },
      $unset: { breedId: '' },
    });
  });

  /**
   * Mongo refuses an empty `$unset`, so an ordinary edit must not carry one —
   * that is every head-count change on the farm, and it would fail on all of
   * them. Only a live database catches it end to end; this catches it here.
   */
  it('leaves $unset out entirely when nothing is cleared', () => {
    const update = updateFor({ count: 18 }, stamp);

    expect(update).not.toHaveProperty('$unset');
    expect(update).toEqual({ $set: { count: 18, ...stamp } });
  });

  it('still stamps the edit when the payload is nothing but clears', () => {
    expect(updateFor({ completedAt: null }, stamp)).toEqual({
      $set: { ...stamp },
      $unset: { completedAt: '' },
    });
  });

  it('never writes a null into the document', () => {
    const update = updateFor({ dose: null, reason: null, name: 'Baytril' }, stamp);

    expect(Object.values(update.$set)).not.toContain(null);
    expect(update.$unset).toEqual({ dose: '', reason: '' });
  });
});

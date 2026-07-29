import { beforeEach, describe, expect, it } from 'vitest';
import { newId, NOTE_SUBJECTS, noteCreateSchema, payloadSchemaFor } from '@steading/contracts';
import { listNotes, noteCounts, notesOn } from '@steading/core/read/notes';
import { localStore } from '@steading/core/db/store';
import { enqueue } from '@steading/core/sync/queue';
import { freshStore } from '../support/store';
import { mount, routeProps } from '../support/screen';
import { seedSecureStore } from '../support/native/modules';

import { GroupScreen } from '../../apps/mobile/src/screens/GroupScreen';
import { MachineScreen } from '../../apps/mobile/src/screens/MachineScreen';

/**
 * Notes on a thing — the answer to "can two people on this farm talk".
 *
 * The property that makes it worth having is the offline one: a note written
 * in a barn is durable before it has been anywhere, and it arrives on the
 * other person's phone through the same pull the rest of the app uses. That
 * is what the last test here proves, and it is the reason this is a note on a
 * thing rather than a chat.
 */

const GROUP = newId();
const MACHINE = newId();

async function aFarm(): Promise<void> {
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: GROUP,
    payload: { name: 'The goats', species: 'goat', count: 4, purposes: ['milk'] },
  });
  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: MACHINE,
    payload: { name: 'The tractor', hasHourMeter: true },
  });
}

beforeEach(async () => {
  await freshStore();
  seedSecureStore({
    'steading.claims': JSON.stringify({
      userId: 'u1',
      orgId: '01J000000000000000000ORG1',
      role: 'hand',
      name: 'Sam',
    }),
  });
});

describe('the contract', () => {
  it('is create-only, like every other observation', () => {
    expect(payloadSchemaFor('note', 'create')).toBeDefined();
    expect(payloadSchemaFor('note', 'update')).toBeUndefined();
    expect(payloadSchemaFor('note', 'delete')).toBeUndefined();
  });

  it('refuses a subject that is not a thing anyone stands in front of', () => {
    const base = { occurredAt: 1, subjectId: newId(), body: 'hello' };
    expect(noteCreateSchema.safeParse({ ...base, subjectEntity: 'flock' }).success).toBe(true);
    // A note on an egg count, or on another note, is not something anyone means.
    expect(noteCreateSchema.safeParse({ ...base, subjectEntity: 'eggLog' }).success).toBe(false);
    expect(noteCreateSchema.safeParse({ ...base, subjectEntity: 'note' }).success).toBe(false);
  });

  it('refuses an empty note', () => {
    const parsed = noteCreateSchema.safeParse({
      occurredAt: 1,
      subjectEntity: 'flock',
      subjectId: newId(),
      body: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('covers every subject it claims to', () => {
    for (const subject of NOTE_SUBJECTS) {
      const parsed = noteCreateSchema.safeParse({
        occurredAt: 1,
        subjectEntity: subject,
        subjectId: newId(),
        body: 'hello',
      });
      expect(parsed.success, subject).toBe(true);
    }
  });
});

describe('leaving one', () => {
  it('writes it against the thing, signed with the cached name', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type(`note-body-${GROUP}`, 'Left teat looks hard, watch her');
    await screen.press(`note-save-${GROUP}`);

    const [note] = await listNotes();
    expect(note).toMatchObject({
      subjectEntity: 'flock',
      subjectId: GROUP,
      body: 'Left teat looks hard, watch her',
      authorName: 'Sam',
    });
  });

  it('shows it back with who wrote it', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type(`note-body-${GROUP}`, 'Gate latch is loose');
    await screen.press(`note-save-${GROUP}`);

    expect(screen.text()).toContain('Gate latch is loose');
    expect(screen.text()).toContain('Sam');
    // Said once, where it matters.
    expect(screen.text()).toContain('cannot be taken back');
  });

  it('clears the box so the next note starts empty', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type(`note-body-${GROUP}`, 'Gate latch is loose');
    await screen.press(`note-save-${GROUP}`);

    expect(screen.get(`note-body-${GROUP}`).props.value).toBe('');
  });

  it('will not send an empty one', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    expect(screen.get(`note-save-${GROUP}`).props.accessibilityState.disabled).toBe(true);
    await screen.type(`note-body-${GROUP}`, '   ');
    expect(screen.get(`note-save-${GROUP}`).props.accessibilityState.disabled).toBe(true);
  });

  it('says who wrote it even when the device never learned a name', async () => {
    seedSecureStore({});
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type(`note-body-${GROUP}`, 'Gate latch is loose');
    await screen.press(`note-save-${GROUP}`);

    // Unattributed rather than falsely attributed to this device.
    expect(screen.text()).toContain('Someone on the farm');
  });
});

describe('staying on its own thing', () => {
  it('keeps a note about the goats off the tractor', async () => {
    await aFarm();

    const group = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await group.type(`note-body-${GROUP}`, 'Worming is overdue');
    await group.press(`note-save-${GROUP}`);

    const machine = await mount(<MachineScreen {...routeProps({ machineId: MACHINE })} />);
    expect(machine.text()).not.toContain('Worming is overdue');
    expect(machine.text()).toContain('Notes');
  });

  it('does not match on the id alone', async () => {
    // A flock id and an equipment id come out of the same ULID space. Sharing
    // one is not reachable today and the filter must not depend on that.
    const shared = newId();
    const notes = [
      { id: newId(), occurredAt: 1, subjectEntity: 'flock' as const, subjectId: shared, body: 'a' },
      { id: newId(), occurredAt: 2, subjectEntity: 'equipment' as const, subjectId: shared, body: 'b' },
    ];

    expect(notesOn(notes, 'flock', shared).map((n) => n.body)).toEqual(['a']);
    expect(noteCounts(notes).get(`equipment:${shared}`)).toBe(1);
  });
});

describe('reaching the other person', () => {
  it('is durable before it has been anywhere', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.type(`note-body-${GROUP}`, 'Fixed the fence by the lane');
    await screen.press(`note-save-${GROUP}`);

    // In the outbox, waiting — nothing about writing it touched the network.
    const queued = await localStore().readOutboxBySeq();
    expect(queued.filter((m) => m.entity === 'note')).toHaveLength(1);
    expect(await listNotes()).toHaveLength(1);
  });

  it('arrives on a second device through the ordinary pull', async () => {
    // A different phone on the same farm: its own store, nothing of its own
    // in it, hydrating from the server.
    await freshStore();
    await aFarm();

    const id = newId();
    await localStore().applyPulled(
      [
        {
          id: newId(),
          entity: 'note',
          op: 'create',
          targetId: id,
          payload: {
            occurredAt: Date.now(),
            subjectEntity: 'flock',
            subjectId: GROUP,
            body: 'Moved them to the top field',
            authorName: 'Alex',
          },
          deviceId: '00000000-0000-4000-8000-000000000002',
          clientSeq: 0,
          clientTs: Date.now(),
          schemaVersion: 1,
          serverTs: Date.now(),
        },
      ],
      { through: Date.now(), throughId: id },
    );

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    expect(screen.text()).toContain('Moved them to the top field');
    expect(screen.text()).toContain('Alex');
  });
});

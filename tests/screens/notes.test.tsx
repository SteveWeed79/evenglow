import { beforeEach, describe, expect, it } from 'vitest';
import {
  isAppendOnly,
  mayChangeNote,
  newId,
  NOTE_SUBJECTS,
  noteCreateSchema,
  noteUpdateSchema,
  payloadSchemaFor,
} from '@homefarm/contracts';
import { decideProjection } from '@homefarm/api/sync/projections';
import { listNotes, noteCounts, notesOn } from '@homefarm/core/read/notes';
import { localStore } from '@homefarm/core/db/store';
import { enqueue } from '@homefarm/core/sync/queue';
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
    'homefarm.claims': JSON.stringify({
      userId: 'u1',
      orgId: '01J000000000000000000ORG1',
      role: 'hand',
      name: 'Sam',
    }),
  });
});

describe('the contract', () => {
  it('can be taken back, unlike every other observation', () => {
    // A note is a message rather than a measurement — see notes.ts.
    expect(payloadSchemaFor('note', 'create')).toBeDefined();
    expect(payloadSchemaFor('note', 'update')).toBeDefined();
    expect(payloadSchemaFor('note', 'delete')).toBeDefined();
    expect(isAppendOnly('note')).toBe(false);
  });

  it('lets an edit change the words and nothing else', () => {
    expect(noteUpdateSchema.safeParse({ body: 'fixed' }).success).toBe(true);
    // Moving a note to another animal is not an edit; nor is back-dating it.
    expect(noteUpdateSchema.safeParse({ body: 'x', subjectId: newId() }).success).toBe(false);
    expect(noteUpdateSchema.safeParse({ body: 'x', occurredAt: 1 }).success).toBe(false);
    expect(noteUpdateSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('lets you change your own, and lets the farm owner change any', () => {
    expect(mayChangeNote('hand', 'u1', 'u1')).toBe(true);
    expect(mayChangeNote('hand', 'u1', 'u2')).toBe(false);
    expect(mayChangeNote('admin', 'u1', 'u2')).toBe(true);
    expect(mayChangeNote('owner', 'u1', 'u2')).toBe(true);
    // Fails closed on an unknown author (invariant 10).
    expect(mayChangeNote('hand', 'u1', undefined)).toBe(false);
    expect(mayChangeNote('owner', 'u1', undefined)).toBe(true);
  });

  it('refuses an edit on someone else’s note at apply time', () => {
    // The client hides the button; this is the half that enforces it, and it
    // reads the server's own stamp rather than anything the client sent.
    const asHand = decideProjection('note', 'update', { body: 'x' }, {
      existing: { _id: 'n1', createdBy: 'u2' },
      actor: { userId: 'u1', role: 'hand' },
    });
    expect(asHand.kind).toBe('rejected');

    const asOwner = decideProjection('note', 'update', { body: 'x' }, {
      existing: { _id: 'n1', createdBy: 'u2' },
      actor: { userId: 'u1', role: 'owner' },
    });
    expect(asOwner.kind).toBe('update');

    const own = decideProjection('note', 'delete', {}, {
      existing: { _id: 'n1', createdBy: 'u1' },
      actor: { userId: 'u1', role: 'hand' },
    });
    expect(own.kind).toBe('archive');
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

    await screen.press(`notes-open-${GROUP}`);
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

    await screen.press(`notes-open-${GROUP}`);
    await screen.type(`note-body-${GROUP}`, 'Gate latch is loose');
    await screen.press(`note-save-${GROUP}`);

    expect(screen.text()).toContain('Gate latch is loose');
    expect(screen.text()).toContain('Sam');
  });

  it('clears the box so the next note starts empty', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press(`notes-open-${GROUP}`);
    await screen.type(`note-body-${GROUP}`, 'Gate latch is loose');
    await screen.press(`note-save-${GROUP}`);

    expect(screen.get(`note-body-${GROUP}`).props.value).toBe('');
  });

  it('will not send an empty one', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);

    expect(screen.get(`note-save-${GROUP}`).props.accessibilityState.disabled).toBe(true);
    await screen.type(`note-body-${GROUP}`, '   ');
    expect(screen.get(`note-save-${GROUP}`).props.accessibilityState.disabled).toBe(true);
  });

  it('says who wrote it even when the device never learned a name', async () => {
    seedSecureStore({});
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    await screen.press(`notes-open-${GROUP}`);
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
    await group.press(`notes-open-${GROUP}`);
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

    await screen.press(`notes-open-${GROUP}`);
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

describe('how it is displayed', () => {
  it('stays out of the way until it is opened', async () => {
    await aFarm();
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);

    // Collapsed: the composer is not on screen competing with the nine action
    // rows underneath it.
    expect(screen.has(`notes-open-${GROUP}`)).toBe(true);
    expect(screen.has(`note-body-${GROUP}`)).toBe(false);

    await screen.press(`notes-open-${GROUP}`);
    expect(screen.has(`note-body-${GROUP}`)).toBe(true);

    await screen.press(`notes-close-${GROUP}`);
    expect(screen.has(`note-body-${GROUP}`)).toBe(false);
  });

  it('shows the count and the newest note without opening', async () => {
    await aFarm();
    for (const body of ['Gate latch is loose', 'Moved them to the top field']) {
      await enqueue({
        entity: 'note',
        op: 'create',
        targetId: newId(),
        payload: {
          occurredAt: body.startsWith('Moved') ? 2 : 1,
          subjectEntity: 'flock',
          subjectId: GROUP,
          body,
          authorName: 'Alex',
        },
      });
    }

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    const collapsed = screen.get(`notes-open-${GROUP}`);

    expect(collapsed.props.accessibilityLabel).toContain('2 notes');
    // The newest, because it is almost always the one that matters.
    expect(screen.text()).toContain('Moved them to the top field');
  });
});

describe('taking one back', () => {
  async function aNoteFrom(authorId: string): Promise<string> {
    const id = newId();
    await enqueue({
      entity: 'note',
      op: 'create',
      targetId: id,
      payload: {
        occurredAt: Date.now(),
        subjectEntity: 'flock',
        subjectId: GROUP,
        body: 'Gate latch is loos',
        authorName: 'Sam',
        authorId,
      },
    });
    return id;
  }

  it('fixes a typo without losing who wrote it or when', async () => {
    await aFarm();
    const id = await aNoteFrom('u1');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);
    // The note is the control: its options live inside it, not underneath it.
    await screen.press(`note-${id}`);
    await screen.press(`note-edit-open-${id}`);
    await screen.type(`note-edit-${id}`, 'Gate latch is loose');
    await screen.press(`note-edit-save-${id}`);

    const [note] = await listNotes();
    expect(note).toMatchObject({
      body: 'Gate latch is loose',
      authorName: 'Sam',
      subjectId: GROUP,
    });
  });

  it('takes two taps to delete, and then it is out of the thread', async () => {
    await aFarm();
    const id = await aNoteFrom('u1');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);
    await screen.press(`note-${id}`);

    await screen.press(`note-delete-${id}`);
    expect(await listNotes()).toHaveLength(1);

    await screen.press(`note-delete-${id}`);
    expect(await listNotes()).toHaveLength(0);
  });

  /**
   * A note somebody may not change is plain text, not a button that does
   * nothing when tapped. The mark on the right is the promise, and it is only
   * drawn where the promise holds.
   */
  it('offers nothing on somebody else’s note, and does not pretend to', async () => {
    await aFarm();
    const mine = await aNoteFrom('u1');
    const theirs = await aNoteFrom('u2');

    // Signed in as the hand u1.
    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);

    expect(screen.get(`note-${theirs}`).props.onPress).toBeUndefined();
    expect(screen.get(`note-${mine}`).props.onPress).toBeDefined();

    // And selecting theirs is not possible, so no options can appear on it.
    await screen.press(`note-${mine}`);
    expect(screen.has(`note-edit-open-${mine}`)).toBe(true);
    expect(screen.has(`note-edit-open-${theirs}`)).toBe(false);
    expect(screen.has(`note-delete-${theirs}`)).toBe(false);
  });

  it('lets an owner change anyone’s', async () => {
    seedSecureStore({
      'homefarm.claims': JSON.stringify({
        userId: 'u1',
        orgId: '01J000000000000000000ORG1',
        role: 'owner',
        name: 'Sam',
      }),
    });
    await aFarm();
    const theirs = await aNoteFrom('u2');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);
    await screen.press(`note-${theirs}`);

    expect(screen.has(`note-edit-open-${theirs}`)).toBe(true);
  });
});

/**
 * "Having the change-it or leave-it button take up that much space for a single
 * note seems pointless. Could the user select the note and have those options
 * within?"
 *
 * Every note this person could change used to render two full-width buttons,
 * permanently — so a five-note thread drew ten of them under five lines of
 * text, and the controls outweighed the thing they were about. A note is
 * written once and read many times; changing or deleting one is the exception.
 */
describe('the options live inside the note', () => {
  async function aNote(body: string): Promise<string> {
    const id = newId();
    await enqueue({
      entity: 'note',
      op: 'create',
      targetId: id,
      payload: {
        occurredAt: Date.now(),
        subjectEntity: 'flock',
        subjectId: GROUP,
        body,
        authorName: 'Sam',
        authorId: 'u1',
      },
    });
    return id;
  }

  it('shows nothing until the note is tapped', async () => {
    await aFarm();
    const id = await aNote('Gate latch is loose');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);

    expect(screen.has(`note-edit-open-${id}`)).toBe(false);
    expect(screen.has(`note-delete-${id}`)).toBe(false);

    await screen.press(`note-${id}`);
    expect(screen.has(`note-edit-open-${id}`)).toBe(true);
    expect(screen.has(`note-delete-${id}`)).toBe(true);
  });

  it('folds away on a second tap', async () => {
    await aFarm();
    const id = await aNote('Gate latch is loose');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);

    await screen.press(`note-${id}`);
    await screen.press(`note-${id}`);

    expect(screen.has(`note-edit-open-${id}`)).toBe(false);
  });

  /**
   * One at a time, which is the whole point. Per-row state would fix the
   * default and still allow every row open at once — the same wall, one tap
   * later.
   */
  it('opens one note at a time', async () => {
    await aFarm();
    const first = await aNote('Gate latch is loose');
    const second = await aNote('Water butt is low');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);

    await screen.press(`note-${first}`);
    await screen.press(`note-${second}`);

    expect(screen.has(`note-edit-open-${second}`)).toBe(true);
    expect(screen.has(`note-edit-open-${first}`)).toBe(false);
  });

  /**
   * Turning to another note abandons an edit in progress.
   *
   * The editor replaces the row while it is open, so it has its own way out —
   * "Leave it as it was". What it cannot see is somebody opening a DIFFERENT
   * note, and without the reset that half-typed draft would still be sitting
   * there on the way back, with nothing to say it had ever been open.
   */
  it('abandons a half-typed edit when another note is opened', async () => {
    await aFarm();
    const first = await aNote('Gate latch is loos');
    const second = await aNote('Water butt is low');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);
    await screen.press(`note-${first}`);
    await screen.press(`note-edit-open-${first}`);
    await screen.type(`note-edit-${first}`, 'half typed');

    // Turn to the other note, then back.
    await screen.press(`note-${second}`);
    await screen.press(`note-${first}`);

    // The note as written, not the abandoned draft.
    expect(screen.has(`note-edit-${first}`)).toBe(false);
    expect(screen.text()).toContain('Gate latch is loos');
    expect(screen.text()).not.toContain('half typed');
  });

  /** And the editor's own way out still works, because it is its own mode. */
  it('leaves the note as it was when the edit is cancelled', async () => {
    await aFarm();
    const id = await aNote('Gate latch is loos');

    const screen = await mount(<GroupScreen {...routeProps({ groupId: GROUP })} />);
    await screen.press(`notes-open-${GROUP}`);
    await screen.press(`note-${id}`);
    await screen.press(`note-edit-open-${id}`);
    await screen.type(`note-edit-${id}`, 'half typed');
    await screen.press(`note-edit-cancel-${id}`);

    expect(screen.has(`note-edit-${id}`)).toBe(false);
    expect(screen.text()).toContain('Gate latch is loos');
  });
});

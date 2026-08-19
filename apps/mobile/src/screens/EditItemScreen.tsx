import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { INVENTORY_KINDS, INVENTORY_UNITS } from '@homefarm/contracts';
import { listInventory } from '@homefarm/core/read/iron';
import {
  Chip,
  Confirm,
  Failure,
  Field,
  Primary,
  TextField,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave, useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { SPACE } from '../theme/tokens';

/**
 * Correcting something on the shelf, and taking it off.
 *
 * ## What could not be changed, and what it cost
 *
 * The shelf card has always had a stepper for the quantity, so the *number*
 * could be corrected from the moment it existed. Everything that decides what
 * the number **means** could not: a sack entered as `kg` when it is bought in
 * bags, a reorder threshold set before the farm knew how fast it went, a part
 * that was never linked to the machine it services. `partsDue` reads that link
 * to warn before a service window, and a mis-typed name is the row somebody
 * scrolls past twice a week.
 *
 * ## Taking it off the shelf
 *
 * Archived, never deleted (P13): every adjustment — bought, used, spoiled,
 * lost — stays exactly where it was, and the feed logs that drew on it go on
 * costing what they cost. What changes is that it stops being offered when
 * somebody records a feed or looks for a part.
 *
 * **No guard on a quantity still on the shelf**, deliberately. A part the farm
 * no longer stocks may well have three left in the drawer, and refusing until
 * the count reached zero would teach people to type a zero they do not mean —
 * which is worse than an archived item with a number on it, because the
 * adjustment history would then carry a use that never happened.
 */
export function EditItemScreen({ route }: ScreenProps<'EditItem'>): React.ReactElement {
  const { itemId } = route.params;
  const nav = useNav();
  const log = useLog();

  const items = useLive(listInventory);
  const item = items?.find((candidate) => candidate.id === itemId) ?? null;

  const [edits, setEdits] = useState<{
    name: string;
    kind: string;
    unit: string;
    reorderBelow: number;
    supplier: string;
    note: string;
  } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (items === null) return <Loading title="Shelf" />;
  if (item === null) return <Missing title="Shelf" what="That item" />;

  const current = edits ?? {
    name: item.name,
    kind: item.kind,
    unit: item.unit,
    reorderBelow: item.reorderBelow ?? 0,
    supplier: item.supplier ?? '',
    note: item.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'inventory',
        op: 'update',
        targetId: itemId,
        payload: {
          name: current.name.trim() || item.name,
          kind: current.kind,
          unit: current.unit,
          // Zero means "never nag", which is a real answer and different from
          // a threshold of nought — so it clears rather than storing one.
          reorderBelow: current.reorderBelow > 0 ? current.reorderBelow : null,
          supplier: current.supplier.trim() === '' ? null : current.supplier.trim(),
          note: current.note.trim() === '' ? null : current.note.trim(),
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'inventory',
        op: 'delete',
        targetId: itemId,
        payload: { reason: 'No longer kept' },
      });
    });
  };

  return (
    <Screen title={`Change ${item.name}`} back>
      <Field label="What is it called?">
        <TextField
          value={current.name}
          onChangeText={(name) => change({ name })}
          maxLength={120}
          testID="edit-item-name"
        />
      </Field>

      <Field label="What kind of thing is it?">
        <View style={styles.chips}>
          {INVENTORY_KINDS.map((kind) => (
            <Chip
              key={kind}
              label={kind}
              selected={current.kind === kind}
              testID={`kind-${kind}`}
              onPress={() => change({ kind })}
            />
          ))}
        </View>
      </Field>

      {/* The unit the farm actually buys it in. A sack entered as kilos when
          it comes in bags makes every count a translation. */}
      <Field label="Counted in">
        <View style={styles.chips}>
          {INVENTORY_UNITS.map((unit) => (
            <Chip
              key={unit}
              label={unit}
              selected={current.unit === unit}
              testID={`unit-${unit}`}
              onPress={() => change({ unit })}
            />
          ))}
        </View>
      </Field>

      <Field
        label="Tell me when it drops below"
        hint="Zero to never be told. Set it high enough that there is time to order."
      >
        <TextField
          value={current.reorderBelow === 0 ? '' : String(current.reorderBelow)}
          onChangeText={(text) => change({ reorderBelow: Number(text.replace(/[^\d.]/g, '')) })}
          keyboardType="decimal-pad"
          maxLength={8}
          placeholder="2"
          testID="edit-item-reorder"
        />
      </Field>

      <Field label="Where it comes from">
        <TextField
          value={current.supplier}
          onChangeText={(supplier) => change({ supplier })}
          placeholder="The co-op"
          maxLength={120}
          testID="edit-item-supplier"
        />
      </Field>

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="Keeps badly once opened"
          maxLength={500}
          multiline
          testID="edit-item-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-item" />

      <Panel label="Take it off the shelf">
        <Body>
          Every adjustment stays — what was bought, used, lost and spoiled — and the feeds that
          drew on it go on costing what they cost. It stops being offered when you record a feed
          or look for a part.
        </Body>
        <Failure message={archived.failure} />
        <Confirm
          label="Take it off"
          armedLabel="Tap again to take it off"
          onConfirm={archive}
          testID="archive-item"
        />
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
});

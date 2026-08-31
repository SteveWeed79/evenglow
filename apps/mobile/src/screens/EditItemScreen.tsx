import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { INVENTORY_KINDS, INVENTORY_UNITS } from '@homefarm/contracts';
import { listInventory, scoopGramsFrom, scoopIn, takesScoop } from '@homefarm/core/read/iron';
import {
  Chip,
  Confirm,
  Failure,
  Field,
  NumberField,
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
 *
 * ## The scoop lives here now, and it had nowhere to live before
 *
 * Reported: *"I don't see where the user can add the weight that their scoop
 * holds."* It could be added, and only in one place — `FeedScreen` — behind
 * four conditions stacked on each other: the typed feed had to match a shelf
 * sack by name, the measure had to be scoops, the sack had to be counted in
 * lb or kg, and **the scoop had to be unanswered**. Answer it once and the
 * field vanished for good, so a scoop entered as 20 lb instead of 2 was
 * permanent from the UI and quietly multiplied every feed by ten.
 *
 * A sack's scoop is a fact about the sack, like its unit and its reorder
 * level, so it belongs on the screen where the sack is described — findable
 * by somebody looking for it rather than only by somebody who happened to be
 * mid-feed. `FeedScreen` still asks, because the moment of noticing is worth
 * catching; it now points here to change an answer instead of hiding it.
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
    /** What one scoop holds, in whatever `unit` currently says. See `retare`. */
    scoop: string;
    supplier: string;
    note: string;
  } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (items === null) return <Loading title="Shelf" />;
  if (item === null) return <Missing title="Shelf" what="That item" />;

  const stored = scoopIn(item);

  const current = edits ?? {
    name: item.name,
    kind: item.kind,
    unit: item.unit,
    reorderBelow: item.reorderBelow ?? 0,
    scoop: stored === null ? '' : String(stored),
    supplier: item.supplier ?? '',
    note: item.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  const asks = takesScoop(current);

  /**
   * Changing what the sack is counted in must not resize the scoop.
   *
   * The field states the scoop in the sack's own unit, so correcting a sack
   * from lb to kg would otherwise leave "2" standing and silently mean 2 kg —
   * a scoop that grew by a factor of two and a bit because somebody fixed an
   * unrelated typo. The weight is what is real, so it is held and the number
   * is re-expressed around it.
   */
  const retare = (unit: string): void => {
    const grams = scoopGramsFrom(current.unit, Number(current.scoop));
    const held = grams === null ? null : scoopIn({ unit, scoopGrams: grams });
    change({ unit, scoop: held === null ? current.scoop : String(held) });
  };

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
          /**
           * Emptied means "I do not know what my scoop holds any more", which
           * is a real answer: it puts the sack back to the estimate and stops
           * the shelf drawing down for scoops, rather than freezing whatever
           * was said. Null is how the wire says that (`contracts/clearing.ts`).
           *
           * Sent on every save, including where the field is not shown — a
           * feed corrected from lb to bags can no longer state a scoop, and
           * leaving the old grams behind would have the shelf drawing down on
           * a figure the screen has stopped displaying.
           */
          scoopGrams: scoopGramsFrom(current.unit, Number(current.scoop)),
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
              onPress={() => retare(unit)}
            />
          ))}
        </View>
      </Field>

      {/* Feed counted by weight only — see `takesScoop`. Asking what a scoop
          of bedding holds, or of a feed counted in bales, is asking for a
          number that could not be used for anything. */}
      {asks ? (
        <Field
          label="What does one scoop hold?"
          hint={
            stored === null
              ? 'Weigh the scoop once — a full one, of this sack. Until you do, a scoop is logged as an estimate and the shelf is left alone.'
              : 'Change it if you have a different scoop, or empty it to go back to an estimate.'
          }
        >
          <NumberField
            value={current.scoop}
            onChangeText={(scoop) => change({ scoop })}
            placeholder="2"
            suffix={current.unit}
            accessibilityLabel="What one scoop of this holds"
            testID="edit-item-scoop"
          />
        </Field>
      ) : null}

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

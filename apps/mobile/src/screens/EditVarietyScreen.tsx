import { useCallback, useState } from 'react';
import { listPlantings, listVarieties } from '@steading/core/read/growing';
import {
  Confirm,
  Failure,
  Field,
  Primary,
  Stepper,
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

/**
 * Correcting a variety, and dropping one the farm no longer grows.
 *
 * ## Why the days matter more than the name
 *
 * `daysToMaturity` anchors every harvest date this app predicts. The library's
 * figure is a starting point and the farm is the authority about the farm — the
 * same argument `growout.ts` makes for `processAtWeeks` — and until this screen
 * the only way to disagree with sixty-five days was to add a second variety
 * with the same name.
 *
 * **Zero means "no opinion" and is sent as a clear**, not as zero days. A
 * variety with no maturity figure produces no predicted harvest, which is the
 * honest state for something nobody has grown before; a stored zero would
 * predict a harvest on the day it was sown.
 *
 * ## Dropping one that has been planted
 *
 * Allowed, unlike a bed with a crop in it. A variety is a description rather
 * than a place: the plantings keep their own copy of what matters and go on
 * reading normally, and the only effect is that it stops being offered when
 * somebody picks what to plant next. That is exactly what "we do not grow this
 * any more" means.
 */
export function EditVarietyScreen({ route }: ScreenProps<'EditVariety'>): React.ReactElement {
  const { varietyId } = route.params;
  const nav = useNav();
  const log = useLog();

  const varieties = useLive(listVarieties);
  const plantings = useLive(listPlantings);
  const variety = varieties?.find((candidate) => candidate.id === varietyId) ?? null;

  const [edits, setEdits] = useState<{
    name: string;
    crop: string;
    days: number;
    note: string;
  } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (varieties === null) return <Loading title="Variety" />;
  if (variety === null) return <Missing title="Variety" what="That variety" />;

  const current = edits ?? {
    name: variety.name,
    crop: variety.crop,
    days: variety.daysToMaturity ?? 0,
    note: variety.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  const planted = (plantings ?? []).filter((planting) => planting.varietyId === varietyId).length;

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'variety',
        op: 'update',
        targetId: varietyId,
        payload: {
          name: current.name.trim() || variety.name,
          crop: current.crop.trim() || variety.crop,
          // Zero is "no opinion", and it is a clear rather than a stored zero —
          // which would predict a harvest on the day of sowing.
          daysToMaturity: current.days > 0 ? current.days : null,
          note: current.note.trim() === '' ? null : current.note.trim(),
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'variety',
        op: 'delete',
        targetId: varietyId,
        payload: { reason: 'No longer grown here' },
      });
    });
  };

  return (
    <Screen title={`Change ${variety.name}`} back>
      <Field label="What is it called?" hint="The variety. 'Black Futsu', 'Roma'.">
        <TextField
          value={current.name}
          onChangeText={(name) => change({ name })}
          maxLength={80}
          testID="edit-variety-name"
        />
      </Field>

      <Field label="What kind of thing is it?" hint="The crop. 'Pumpkin', 'Tomato'.">
        <TextField
          value={current.crop}
          onChangeText={(crop) => change({ crop })}
          maxLength={60}
          testID="edit-variety-crop"
        />
      </Field>

      <Field
        label="Ready after"
        hint="Days from sowing or transplanting. Zero if you would rather the app said nothing."
      >
        <Stepper
          value={current.days}
          onChange={(days) => change({ days })}
          steps={[5, 25]}
          min={0}
          suffix="days"
          testID="edit-variety-days"
        />
      </Field>

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="Did badly in the wet year"
          maxLength={500}
          multiline
          testID="edit-variety-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-variety" />

      <Panel label="Stop growing it">
        <Body>
          {planted === 0
            ? 'It stops being offered when you pick something to plant.'
            : `The ${planted === 1 ? 'planting' : `${planted} plantings`} of it and everything harvested off ${
                planted === 1 ? 'it' : 'them'
              } stay exactly as they are. It stops being offered when you pick something to plant.`}
        </Body>
        <Failure message={archived.failure} />
        <Confirm
          label="Stop growing it"
          armedLabel="Tap again to drop it"
          onConfirm={archive}
          testID="archive-variety"
        />
      </Panel>
    </Screen>
  );
}

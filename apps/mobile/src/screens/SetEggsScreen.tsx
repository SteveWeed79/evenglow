import { useCallback, useState } from 'react';
import {
  candlingDay,
  EGG_SOURCES,
  INCUBATION_DAYS,
  INCUBATION_METHODS,
  laysEggs,
  newId,
  SPECIES_TRAITS,
  type Species,
} from '@steading/contracts';
import {
  Choice,
  DayPick,
  Failure,
  Field,
  Primary,
  Stepper,
  TextField,
  useSaver,
} from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';

/**
 * A set of eggs going under.
 *
 * Its own route rather than a `useState` branch inside the list, for the
 * reason `navigation/Root.tsx` gives at length: a screen that draws a back
 * arrow has to have one that works, and on Android the hardware button has to
 * agree with it. A half-filled form is exactly where that matters.
 */

const SOURCE_LABELS = { own: 'My own', bought: 'Bought', gifted: 'Given' } as const;
const METHOD_LABELS = { incubator: 'Incubator', broody: 'Under a broody' } as const;

export function SetEggsScreen(): React.ReactElement {
  const nav = useNav();
  const log = useLog();

  const [label, setLabel] = useState('');
  const [species, setSpecies] = useState<Species>('chicken');
  const [eggsSet, setEggsSet] = useState(12);
  const [setAt, setSetAt] = useState(() => startOfDay(Date.now()));
  const [source, setSource] = useState<(typeof EGG_SOURCES)[number]>('own');
  const [method, setMethod] = useState<(typeof INCUBATION_METHODS)[number]>('incubator');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'incubation',
        op: 'create',
        targetId: newId(),
        payload: {
          species,
          label: label.trim() || `${SPECIES_TRAITS[species].label} set`,
          setAt,
          eggsSet,
          source,
          method,
        },
      });
    });
  }, [save, log, species, label, setAt, eggsSet, source, method]);

  /** Only the birds. A goat cannot be set under a broody. */
  const layers = (Object.keys(SPECIES_TRAITS) as Species[]).filter(
    (s) => laysEggs(s) && INCUBATION_DAYS[s] !== undefined,
  );
  const days = INCUBATION_DAYS[species] ?? 21;

  return (
    <Screen title="Set some eggs" back>
      <Field label="What are they?">
        <Choice
          options={layers}
          value={species}
          onChange={setSpecies}
          labels={Object.fromEntries(layers.map((s) => [s, SPECIES_TRAITS[s].label]))}
        />
      </Field>

      <Field label="What will you call this set?">
        <TextField
          value={label}
          onChangeText={setLabel}
          placeholder={`${SPECIES_TRAITS[species].label} set`}
          maxLength={80}
          testID="incubation-label"
        />
      </Field>

      <Field label="How many eggs?">
        <Stepper value={eggsSet} onChange={setEggsSet} steps={[1, 6, 12]} min={1} suffix="eggs" />
      </Field>

      <Field label="Set on">
        <DayPick value={setAt} onChange={setSetAt} />
      </Field>

      <Field label="Where did they come from?">
        <Choice options={EGG_SOURCES} value={source} onChange={setSource} labels={SOURCE_LABELS} />
      </Field>

      <Field label="Under what?">
        <Choice
          options={INCUBATION_METHODS}
          value={method}
          onChange={setMethod}
          labels={METHOD_LABELS}
        />
      </Field>

      <Panel label="Your dates">
        <Body>
          Candle on {when(setAt, candlingDay(days))}, hatch about {when(setAt, days)}. Both land
          on Today by themselves — the candling two days before, the hatch three weeks before,
          because one is a job and the other is a thing to be ready for.
        </Body>
      </Panel>

      <Failure message={failure} />

      <Primary label="Set them" disabled={saving} onPress={commit} testID="save-incubation" />
    </Screen>
  );
}

const DAY_MS = 86_400_000;

function when(from: number, days: number): string {
  return new Date(from + days * DAY_MS).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

import { useCallback, useState } from 'react';
import { newId } from '@steading/contracts';
import { listGroups } from '@steading/core/read/groups';
import {
  Choice,
  Failure,
  Field,
  DayPick,
  Primary,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * Naming one animal inside a group.
 *
 * Sex is asked for because it is what makes an animal a possible dam, and a
 * birth date because it is what makes a growth curve mean anything. Both are
 * optional: a keeper who knows their goat is a doe and not when she was born
 * should be able to record the doe.
 */

const SEX_LABELS = { female: 'Female', male: 'Male', unknown: 'Not sure' } as const;

export function AddAnimalScreen({ route }: ScreenProps<'AddAnimal'>): React.ReactElement {
  const { groupId } = route.params;
  const log = useLog();

  const groups = useLive(listGroups);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [sex, setSex] = useState<'female' | 'male' | 'unknown'>('female');
  const [knowsBirth, setKnowsBirth] = useState(false);
  const [bornAt, setBornAt] = useState(() => {
    // Defaults to this spring rather than to today: an animal being named is
    // almost never one born this morning.
    const now = new Date();
    return new Date(now.getFullYear(), 2, 15).getTime();
  });

  const { saving, failure, save } = useSaver(useLeave());

  const commit = useCallback(() => {
    if (group === null) return;
    void save(async () => {
      await log({
        entity: 'animal',
        op: 'create',
        targetId: newId(),
        payload: {
          flockId: groupId,
          name: name.trim(),
          species: group.species,
          sex,
          ...(tag.trim() === '' ? {} : { tag: tag.trim() }),
          ...(knowsBirth ? { bornAt } : {}),
          ...(group.breed === undefined ? {} : { breed: group.breed }),
        },
      });
    });
  }, [save, log, group, groupId, name, sex, tag, knowsBirth, bornAt]);

  if (groups === null) return <Loading title="Animal" />;
  if (group === null) return <Missing title="Animal" what="That group" />;

  return (
    <Screen title="Name an animal" back>
      <Field label="What do you call her?">
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="Bramble, Number 14, the big ram"
          maxLength={80}
          testID="animal-name"
        />
      </Field>

      <Field label="Tag or band (optional)">
        <TextField value={tag} onChangeText={setTag} placeholder="Blue 07" maxLength={40} />
      </Field>

      <Field label="Sex" hint="This is what decides whether she can be recorded as in kid.">
        <Choice
          options={['female', 'male', 'unknown'] as const}
          value={sex}
          onChange={setSex}
          labels={SEX_LABELS}
        />
      </Field>

      <Toggle label="I know when they were born" value={knowsBirth} onChange={setKnowsBirth} />

      {knowsBirth ? (
        <Field label="Born">
          <DayPick value={bornAt} onChange={setBornAt} withYear />
        </Field>
      ) : null}

      <Failure message={failure} />

      <Primary
        label={`Add ${name.trim() || 'this animal'}`}
        disabled={saving || name.trim() === ''}
        onPress={commit}
        testID="save-animal"
      />
    </Screen>
  );
}

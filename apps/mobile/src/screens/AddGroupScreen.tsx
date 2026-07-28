import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  FLOCK_PURPOSES,
  type FlockPurpose,
  newId,
  SPECIES_TRAITS,
  type Species,
} from '@steading/contracts';
import { describeLogFailure } from '@steading/core/sync/failure';
import { defaultGroupName } from '@steading/core/naming';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useGroups } from '../hooks/useGroups';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Adds a group of animals.
 *
 * Species chips rather than a picker, grouped so a long list stays scannable
 * at arm's length (UX-SPEC §5). A native picker would be one tap fewer and a
 * modal wheel that cannot be read in sunlight.
 *
 * **Purpose is asked, not inferred.** A hen can lay and can be eaten; which
 * one a keeper intends is a fact about the keeper, and it is what decides
 * whether this group ever gets a processing countdown. Asking here is the only
 * honest place to ask it.
 */

const GROUPINGS = [
  { title: 'Poultry', group: 'poultry' as const },
  { title: 'Ratites', group: 'ratite' as const },
  { title: 'Ruminants', group: 'ruminant' as const },
  { title: 'Other stock', group: 'other' as const },
];

const PURPOSE_LABELS: Record<FlockPurpose, string> = {
  eggs: 'Eggs',
  meat: 'Meat',
  milk: 'Milk',
  fibre: 'Fibre',
  breeding: 'Breeding',
  work: 'Work',
  guarding: 'Guarding',
  companion: 'Pets',
};

export function AddGroupScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const log = useLog();
  const { groups } = useGroups();
  const { colors } = useTheme();

  const [species, setSpecies] = useState<Species>('chicken');
  const [name, setName] = useState('');
  const [count, setCount] = useState(0);
  const [purposes, setPurposes] = useState<FlockPurpose[]>(['eggs']);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const traits = SPECIES_TRAITS[species];

  /**
   * What this group will be called if nothing is typed — shown as the
   * placeholder, so the field states its own default rather than sitting there
   * looking already answered.
   */
  const suggested = defaultGroupName(
    traits.label,
    groups.map((g) => g.name),
  );

  const togglePurpose = useCallback((purpose: FlockPurpose) => {
    void Haptics.selectionAsync();
    setPurposes((current) =>
      current.includes(purpose) ? current.filter((p) => p !== purpose) : [...current, purpose],
    );
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    try {
      await log({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: {
          name: name.trim() || suggested,
          species,
          count,
          ...(purposes.length > 0 ? { purposes } : {}),
        },
      });
    } catch (error) {
      /**
       * `saving` must come back down. The guard at the top reads it, so
       * leaving it true on a throw makes the button permanently dead until the
       * screen is closed and reopened — with the typed-in work still on screen
       * and nothing said about why.
       */
      setSaving(false);
      setFailure(describeLogFailure(error));
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  }, [saving, log, name, suggested, species, count, purposes, onDone]);

  return (
    <Screen title="Add stock" back>
      <Text style={[styles.label, { color: colors.muted }]}>What do you keep?</Text>

      {GROUPINGS.map(({ title, group }) => {
        const options = (Object.keys(SPECIES_TRAITS) as Species[]).filter(
          (s) => SPECIES_TRAITS[s].group === group,
        );
        return (
          <View key={group} style={styles.section}>
            <Text style={[styles.groupTitle, { color: colors.muted }]}>{title}</Text>
            <View style={styles.chips}>
              {options.map((option) => (
                <Chip
                  key={option}
                  label={SPECIES_TRAITS[option].label}
                  selected={species === option}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setSpecies(option);
                  }}
                />
              ))}
            </View>
          </View>
        );
      })}

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.muted }]}>Why do you keep them?</Text>
        <Body>This is what decides whether the app ever counts them down to a date.</Body>
        <View style={styles.chips}>
          {FLOCK_PURPOSES.map((purpose) => (
            <Chip
              key={purpose}
              label={PURPOSE_LABELS[purpose]}
              selected={purposes.includes(purpose)}
              onPress={() => togglePurpose(purpose)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.muted }]}>
          What are they called? ({traits.collective})
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={suggested}
          placeholderTextColor={colors.muted}
          maxLength={80}
          style={[
            styles.field,
            { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
          ]}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.muted }]}>How many?</Text>
        <View style={styles.counter}>
          {[1, 5, 10].map((step) => (
            <Chip
              key={step}
              label={`+${step}`}
              selected={false}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCount((c) => c + step);
              }}
            />
          ))}
          <Chip
            label="−"
            selected={false}
            disabled={count === 0}
            onPress={() => setCount((c) => Math.max(0, c - 1))}
          />
          <Text style={[styles.count, { color: colors.ink }]}>{count}</Text>
        </View>
      </View>

      {failure ? (
        <Panel>
          <Body>{failure}</Body>
        </Panel>
      ) : null}

      <Pressable
        onPress={() => void save()}
        disabled={saving}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.save,
          { backgroundColor: colors.lantern, opacity: saving || pressed ? 0.75 : 1 },
        ]}
      >
        <Text style={styles.saveLabel}>Add {name.trim() || suggested}</Text>
      </Pressable>
    </Screen>
  );
}

function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.lantern : colors.raised,
          borderColor: selected ? colors.lanternInk : colors.border,
          opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {/* Ink on brass when selected: the lantern is a fill, and a label on top
          of it reads where a brass label on plaster would not. */}
      <Text style={[styles.chipLabel, { color: selected ? '#241c14' : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: SPACE.sm },
  groupTitle: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: TAP.gap },
  chip: {
    minHeight: TAP.min,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
  field: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
  },
  counter: { flexDirection: 'row', alignItems: 'center', gap: TAP.gap, flexWrap: 'wrap' },
  count: { fontFamily: FONTS.display, fontSize: TYPE.hero, fontVariant: ['tabular-nums'] },
  save: {
    minHeight: TAP.primary,
    borderRadius: RADII.softHead,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.lg,
  },
  saveLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede, color: '#241c14' },
});

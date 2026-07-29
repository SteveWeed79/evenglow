import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { describeLogFailure } from '@steading/core/sync/failure';
import { loggedConfirmation } from '@steading/core/voice';
import { Arch } from './Arch';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The signature control (UX-SPEC §3).
 *
 * Steppers, never a numeric keyboard (R5): the count is entered through a
 * glove, in the dark, by someone holding a bucket. The commit never awaits the
 * network (R6) — `onCommit` returns once the mutation is durable locally,
 * which is one SQLite transaction, not a request.
 *
 * **The arch is not decoration here.** Arch means something you can act on,
 * and this is the thing the app exists to be acted on. It is drawn rather than
 * styled because RN has no elliptical radius — see `Arch.tsx`.
 */

export interface TallyProps {
  label: string;
  unit: string;
  steps?: readonly number[];
  /**
   * When set, committing takes a second deliberate tap and the value is
   * recorded as acknowledged. Used for an open withdrawal window (W2) — the
   * only case where a warning is allowed to cost a tap.
   */
  requireConfirm?: boolean;
  /** The sentence shown after a successful log. Defaults to the plain one. */
  confirm?: (value: number) => string;
  onCommit: (value: number, acknowledged: boolean) => void | Promise<void>;
}

export function Tally({
  label,
  unit,
  steps = [1, 6, 12],
  requireConfirm = false,
  confirm,
  onCommit,
}: TallyProps): React.ReactElement {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();

  const [count, setCount] = useState(0);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * The count is a fraction of the SHORTER edge, so it is the same size in
   * the hand whichever way the phone is held. `clamp()` has no RN form.
   */
  const countSize = Math.min(width, height) * TYPE.tally;

  const bump = useCallback((by: number) => {
    setCount((c) => Math.max(0, c + by));
    // A new tap means they are working the problem; the stale message would
    // otherwise sit under a count they are actively rebuilding.
    setFailure(null);
    /**
     * Through a glove this is often the only proof the tap registered.
     *
     * The web build could only ask for a flat 8ms buzz. This is the real
     * thing, and it is one of the few places going native is felt rather than
     * merely argued for.
     */
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const commit = useCallback(async () => {
    if (count === 0) return;

    // One confirm tap while a withdrawal is open. Not a modal, and not a
    // block — the log still happens, it is just deliberate.
    if (requireConfirm && !armed) {
      setArmed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    const committed = count;
    const acknowledged = requireConfirm;

    // Optimistic: clear immediately so the next tally can start, and let the
    // queue carry the work. Nothing here waits.
    setCount(0);
    setArmed(false);
    setFailure(null);

    try {
      await onCommit(committed, acknowledged);
    } catch (error) {
      /**
       * Put the count back.
       *
       * The optimistic clear is right while the write succeeds, but on a throw
       * it is indistinguishable from success — the number goes to zero either
       * way — and the mutation is NOT queued, because enqueue aborts its
       * transaction as a unit. Without this the count is simply gone, silently,
       * which is the exact failure this app exists to prevent.
       */
      setCount(committed);
      setArmed(acknowledged);
      setFailure(describeLogFailure(error));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // One short sentence — the whole whimsy allowance on this path.
    setConfirmation(confirm ? confirm(committed) : loggedConfirmation(committed, unit));
    setTimeout(() => setConfirmation(null), 3_000);
  }, [count, unit, confirm, onCommit, requireConfirm, armed]);

  return (
    <Arch
      fill={colors.raised}
      stroke={colors.border}
      strokeWidth={colors.borderWidth}
      style={styles.arch}
    >
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>

      <Text
        style={[styles.count, { color: colors.ink, fontSize: countSize, lineHeight: countSize * 1.05 }]}
        accessibilityLiveRegion="polite"
        // Shrinks rather than wraps. Three digits at 22% of the short edge is
        // wider than a phone, and a tally that wrapped to two lines would move
        // the commit button under a thumb already travelling towards it.
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {count}
      </Text>
      <Text style={[styles.unit, { color: colors.muted }]}>{unit}</Text>

      <View style={styles.steps}>
        {steps.map((step) => (
          <Step key={step} label={`+${step}`} onPress={() => bump(step)} testID={`tally-plus-${step}`} />
        ))}
        <Step
          label="−"
          onPress={() => bump(-1)}
          disabled={count === 0}
          accessibilityLabel="Subtract one"
        />
      </View>

      <Pressable
        onPress={() => void commit()}
        disabled={count === 0}
        accessibilityRole="button"
        accessibilityState={{ disabled: count === 0 }}
        testID="tally-commit"
        style={({ pressed }) => [
          styles.commit,
          {
            // Armed is the withdrawal state: the same button, saying something
            // different, rather than a second control to find.
            backgroundColor: armed ? colors.rowan : colors.lantern,
            opacity: count === 0 ? 0.4 : pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={[styles.commitLabel, { color: armed ? '#fff' : '#241c14' }]}>
          {armed ? `Log ${count} ${unit} anyway` : `Log ${count} ${unit}`}
        </Text>
      </Pressable>

      {failure ? (
        <Text style={[styles.failure, { color: colors.rowan }]} accessibilityLiveRegion="assertive">
          {failure}
        </Text>
      ) : null}

      <Text style={[styles.confirmation, { color: colors.leaf }]} accessibilityLiveRegion="polite">
        {confirmation ?? ' '}
      </Text>
    </Arch>
  );
}

function Step({
  label,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      style={({ pressed }) => [
        styles.step,
        {
          backgroundColor: colors.ground,
          borderColor: colors.border,
          opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.stepLabel, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  arch: {
    paddingTop: SPACE.xl + SPACE.lg,
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
    alignItems: 'center',
    gap: SPACE.sm,
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  count: { fontFamily: FONTS.display, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: FONTS.body, fontSize: TYPE.lede },
  steps: {
    flexDirection: 'row',
    gap: TAP.gap,
    marginTop: SPACE.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  step: {
    minWidth: TAP.min,
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
  },
  stepLabel: { fontFamily: FONTS.data, fontSize: TYPE.lede },
  commit: {
    minHeight: TAP.primary,
    alignSelf: 'stretch',
    borderRadius: RADII.softHead,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.md,
  },
  commitLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  failure: { fontFamily: FONTS.body, fontSize: TYPE.body, textAlign: 'center' },
  confirmation: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    textAlign: 'center',
    minHeight: TYPE.body * 1.4,
  },
});

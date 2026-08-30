import { useCallback, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { describeLogFailure } from '@homefarm/core/sync/failure';
import { loggedConfirmation } from '@homefarm/core/voice';
import { Surface } from './Surface';
import { NumberField } from './Form';
import { Touch } from './Touch';
import { tallySize } from '../theme/tally';
import { useFade } from '../theme/motion';
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
  /**
   * Offers a typed entry alongside the steps.
   *
   * **R5's own exception**, which reads "steppers, never a keyboard, *unless
   * the value can exceed 99*". A herd's morning milking is five gallons and a
   * hay feed is sixty pounds; both are twenty-odd taps of the largest step,
   * and twenty taps is not a control, it is a toll. The fix is not a bigger
   * step — a bigger step only moves the ceiling, and the farm that has to
   * reach past it is always the one with the most animals.
   *
   * **Off by default, and that matters more than the feature.** The egg tally
   * is the screen this app is judged on and a keyboard has no business on it:
   * a basket is a dozen or two, reachable in three taps, and the steppers are
   * what a glove can hit. This is a door for the number the steps cannot
   * reach, not a replacement for them — they stay on screen and stay working
   * with the field open, because someone who typed 600 and then drew another
   * half pint should not have to retype the total.
   */
  typed?: boolean;
  onCommit: (value: number, acknowledged: boolean) => void | Promise<void>;
}

/**
 * The ceiling on a typed count.
 *
 * Not a schema limit — a fat-finger one. The steps could never produce seven
 * digits and neither can a farm; a slipped keystroke that turns sixty pounds
 * into six hundred thousand writes a record no report can survive, and an
 * append-only log does not forget it. Sticking visibly at the cap is how the
 * control says so.
 */
const TYPED_MAX = 999_999;

export function Tally({
  label,
  unit,
  steps = [1, 6, 12],
  requireConfirm = false,
  confirm,
  typed = false,
  onCommit,
}: TallyProps): React.ReactElement {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();

  const [count, setCount] = useState(0);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const saidOpacity = useFade(confirmation !== null);

  /**
   * A fraction of the shorter edge, bounded by the column it has to share and
   * by a floor and a ceiling. See `theme/tally.ts` — the fraction alone put a
   * 94px numeral on a 430pt-tall screen the moment a phone was turned sideways.
   */
  const countSize = tallySize(width, height);

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

  /**
   * The typed count.
   *
   * The field renders the count itself rather than keeping a draft beside it,
   * so the two controls can never disagree: a `+5` tapped with the keyboard
   * open moves the field, and the clear on commit empties it. The price is the
   * decimal point — a half-typed "2." would round-trip through the number and
   * come back "2" — which is why the field is whole-numbers-only. A tally
   * counts whole things anyway; the steps could not produce a fraction either.
   */
  const enter = useCallback((text: string) => {
    const said = Number(text);
    setCount(text === '' || !Number.isFinite(said) ? 0 : Math.min(TYPED_MAX, Math.trunc(said)));
    setFailure(null);
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

  /**
   * The one gradient the whole interface is allowed (UX-SPEC §2), on the one
   * control it is for. The `glow` token carries its own alpha per theme, so it
   * is brightest at 5am and faintest at noon without this knowing which.
   */
  return (
    <Surface
      fill={colors.raised}
      stroke={colors.border}
      strokeWidth={colors.borderWidth}
      glow={colors.glow}
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

      {/**
        * The door stays open once it is opened, because closing it is a
        * control nobody asked for: the steps never left, so there is nothing
        * to go back to.
        */}
      {!typed ? null : typing ? (
        <View style={styles.typed}>
          <NumberField
            value={count === 0 ? '' : String(count)}
            onChangeText={enter}
            placeholder="0"
            suffix={unit}
            whole
            accessibilityLabel={`How many ${unit}`}
            testID="tally-typed"
          />
        </View>
      ) : (
        <Step label="Type it" onPress={() => setTyping(true)} testID="tally-type" />
      )}

      <Touch affordance="brass"
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
        <Text style={[styles.commitLabel, { color: armed ? '#fff' : colors.lanternOn }]}>
          {armed ? `Log ${count} ${unit} anyway` : `Log ${count} ${unit}`}
        </Text>
      </Touch>

      {/* Ink, not rowan. This is the most important sentence the component can
          say — a log that did not save — and it is announced assertively, so
          it must also be *readable*: rowan measures 3.1:1 on the lamplight
          ground, which is under R7's floor and under AA. Urgency comes from
          the live region and the position, not from a colour that costs
          legibility to get. */}
      {failure ? (
        <Text style={[styles.failure, { color: colors.ink }]} accessibilityLiveRegion="assertive">
          {failure}
        </Text>
      ) : null}

      {/* ## Two things were wrong with this line
          It was set in `leaf`, which measures **3.51:1 on the daylight
          ground** — an accent token, floor 3:1, doing the job of body text.
          `Tally`'s *failure* line had exactly this bug in rowan and was moved
          to `ink` when `contrast.test.ts` was written; the success line six
          rows below it was missed. It is the one sentence a farmer reads every
          morning, and it was the least legible text in the app.

          `inkQuiet` rather than `ink` because it is an exhale — nothing
          depends on it being read — and that tier is what the app now has for
          exactly this. 3.51:1 to 8.08:1.

          The height was already reserved, so the fade touches no layout and
          rides the native driver. The commit is durable before this runs. */}
      <Animated.Text
        style={[styles.confirmation, { color: colors.inkQuiet, opacity: saidOpacity }]}
        accessibilityLiveRegion="polite"
      >
        {confirmation ?? ' '}
      </Animated.Text>
    </Surface>
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
    <Touch affordance="border"
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
    </Touch>
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
  typed: { alignSelf: 'stretch', marginTop: SPACE.md },
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { reportTrouble } from '../hooks/useTrouble';
import { describeLogFailure } from '@homefarm/core/sync/failure';
import { Arch } from './Arch';
import { Icon, type IconName } from './Icon';
import { Body, Panel } from './Panel';
import { useRevealOnFocus } from './reveal';
import { Touch } from './Touch';
import { useFade } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The parts every logging screen is made of.
 *
 * Twenty screens each rolling their own chip, stepper and primary button is
 * twenty chances for the tap target to shrink below `TAP.min` and for a label
 * to pick up the wrong colour. These were extracted once the fourth screen
 * copied the third one's `styles.chip` verbatim — that repetition is a
 * measurement, not an aesthetic complaint.
 *
 * Nothing here talks to the store. `useSaver` is the single exception and it
 * only wraps the write path every form already had, because the *shape* of a
 * failed save — put `saving` back down, say why, keep the typed work on screen
 * — is the part that was being got wrong when it was written by hand.
 */

// ── labels and layout ────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      {hint === undefined ? null : <Body>{hint}</Body>}
      {children}
    </View>
  );
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  maxLength = 120,
  multiline = false,
  keyboardType,
  secret = false,
  caps = false,
  accessibilityLabel,
  testID,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'email-address';
  /**
   * A password. Masked, and every keyboard convenience that would corrupt one
   * turned off.
   *
   * Here rather than in the account screen because a field that masks its
   * contents but still autocorrects them is a bug nobody sees until somebody
   * cannot sign in, and it should be impossible to build by forgetting a prop.
   */
  secret?: boolean;
  /** A code read off somebody else's screen. Uppercase, never autocorrected. */
  caps?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  // Says where it is when it is focused, so the screen can scroll it clear of
  // the keyboard. See reveal.tsx — the window no longer resizes for us.
  const revealed = useRevealOnFocus<TextInput>();

  return (
    <TextInput
      {...revealed}
      value={value}
      onChangeText={onChangeText}
      {...(placeholder === undefined ? {} : { placeholder })}
      placeholderTextColor={colors.muted}
      maxLength={maxLength}
      multiline={multiline}
      {...(keyboardType === undefined ? {} : { keyboardType })}
      {...(secret ? { secureTextEntry: true, textContentType: 'password' as const } : {})}
      {...(secret || caps || keyboardType === 'email-address'
        ? { autoCorrect: false, autoCapitalize: caps ? ('characters' as const) : ('none' as const) }
        : {})}
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      {...(testID === undefined ? {} : { testID })}
      style={[
        styles.input,
        multiline ? styles.multiline : null,
        { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
      ]}
    />
  );
}

// ── choices ──────────────────────────────────────────────────────────────────

export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touch affordance="check"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      {...(testID === undefined ? {} : { testID })}
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
      <Text style={[styles.chipLabel, { color: selected ? colors.lanternOn : colors.ink }]}>{label}</Text>
    </Touch>
  );
}

/**
 * One-of-many, as chips rather than a picker.
 *
 * A native picker is one tap fewer and a modal wheel that cannot be read in
 * sunlight (UX-SPEC §5). Chips also show every option at once, which is what
 * lets someone pick the right cause of death without learning the list first.
 */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /**
   * Keyed loosely rather than by `T`, because half the callers build their
   * options from records — the animals in a group, the machines on the farm —
   * and a `Record<T, string>` cannot be produced for ids only known at
   * runtime. Where the options are a fixed enum, the caller declares its own
   * table as `Record<Kind, string>` and gets the exhaustiveness there.
   */
  labels: Readonly<Record<string, string>>;
}): React.ReactElement {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <Chip
          key={option}
          // Falls back to the raw value rather than rendering an empty chip: a
          // blank tap target is worse than an ugly one.
          label={labels[option] ?? option}
          selected={value === option}
          testID={`choice-${option}`}
          onPress={() => {
            void Haptics.selectionAsync();
            onChange(option);
          }}
        />
      ))}
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Optional, because a toggle whose label is unique needs no other handle. */
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touch affordance="check"
      {...(testID === undefined ? {} : { testID })}
      onPress={() => {
        void Haptics.selectionAsync();
        onChange(!value);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [
        styles.toggle,
        {
          backgroundColor: value ? colors.lantern : colors.raised,
          borderColor: value ? colors.lanternInk : colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.toggleLabel, { color: value ? colors.lanternOn : colors.ink }]}>{label}</Text>
    </Touch>
  );
}

/**
 * A number, by steps.
 *
 * The same argument as the Tally (R5): the person entering this is wearing a
 * glove. The difference is that a Tally is the whole screen and commits
 * itself, and this is one row of a form that does not.
 */
export function Stepper({
  value,
  onChange,
  steps = [1, 5, 10],
  min = 0,
  suffix,
  negative = false,
  testID = 'step',
}: {
  value: number;
  onChange: (next: number) => void;
  steps?: readonly number[];
  min?: number;
  suffix?: string;
  /**
   * Prefix for this stepper's chips, so two on one form can be told apart.
   *
   * The shelf form has a quantity and a reorder threshold, both stepped, and
   * with one shared prefix a test could only ever reach whichever rendered
   * last — which is the threshold, not the one anybody cares about.
   */
  testID?: string;
  /**
   * Whether a step reads as taking away.
   *
   * The value is always the magnitude — how many — and the arithmetic does not
   * change. What changes is the sign on the chips, because on a screen headed
   * "Record a loss" a `+5` invites you to read it as five more animals. It is
   * five fewer, and the one word the buttons say should not contradict the one
   * word at the top of the screen.
   *
   * The corrective chip flips with them: where a step takes away, the
   * correction gives back. Both still move the same underlying count, so `min`
   * and the disabled state need no special case.
   */
  negative?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();

  const bump = useCallback(
    (by: number) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(Math.max(min, value + by));
    },
    [onChange, value, min],
  );

  return (
    <View style={styles.stepper}>
      {steps.map((step) => (
        <Chip
          key={step}
          label={`${negative ? '−' : '+'}${step}`}
          selected={false}
          testID={`${testID}-${negative ? 'minus' : 'plus'}-${step}`}
          onPress={() => bump(step)}
        />
      ))}
      <Chip
        label={negative ? '+' : '−'}
        selected={false}
        disabled={value <= min}
        testID={`${testID}-correct`}
        onPress={() => bump(-1)}
      />
      <Text style={[styles.stepperValue, { color: colors.ink }]}>
        {value}
        {suffix === undefined ? '' : ` ${suffix}`}
      </Text>
    </View>
  );
}

/**
 * A decimal typed rather than stepped.
 *
 * The exception to R5, and it is narrow: a weight of 6.4 lb and an hour meter
 * reading of 1,247 cannot be reached by tapping. Everything countable stays on
 * the stepper.
 */
export function NumberField({
  value,
  onChangeText,
  placeholder,
  suffix,
  accessibilityLabel,
  testID,
  whole = false,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  suffix?: string;
  accessibilityLabel?: string;
  testID?: string;
  /**
   * Digits only, and the number pad rather than the decimal one.
   *
   * For a field standing in for a stepper, where the value is a count of
   * whole things — fluid ounces in a pail, pounds in a scoop, hours on a
   * meter. Offering a decimal point there is offering a keystroke that can
   * only produce a number the control it replaces could never have made.
   */
  whole?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const revealed = useRevealOnFocus<TextInput>();

  return (
    <View style={styles.number}>
      <TextInput
        {...revealed}
        value={value}
        // One decimal point, digits only. Typing "1.2.3" into a weight field
        // and having it parse as NaN is a silent zero in a growth curve.
        onChangeText={(text) =>
          onChangeText(
            whole
              ? text.replace(/[^0-9]/g, '')
              : text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'),
          )
        }
        keyboardType={whole ? 'number-pad' : 'decimal-pad'}
        inputMode={whole ? 'numeric' : 'decimal'}
        maxLength={12}
        {...(placeholder === undefined ? {} : { placeholder })}
        placeholderTextColor={colors.muted}
        {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
        {...(testID === undefined ? {} : { testID })}
        style={[
          styles.numberField,
          { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
        ]}
      />
      {suffix === undefined ? null : (
        <Text style={[styles.suffix, { color: colors.muted }]}>{suffix}</Text>
      )}
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date, as month chips and a day field.
 *
 * Not a native picker, for the reason `SiteSetupScreen` gives: the wheel
 * cannot be read in sunlight and it opens over the form.
 *
 * The year is a pair of nudges rather than a field, because every date entered
 * on these screens is this year or a year or two either side — a mating last
 * autumn, a doe born three springs ago. Twelve chips for months and two
 * arrows for years is the shape of what people actually enter.
 */
export function DayPick({
  value,
  onChange,
  withYear = false,
}: {
  /** Epoch millis, at local midnight. */
  value: number;
  onChange: (next: number) => void;
  /** Shows the year alongside, for a date that is not obviously this one. */
  withYear?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const date = new Date(value);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  /**
   * What is in the box while it is being typed into, or null when it is not.
   *
   * The field used to read `String(day)` straight off the clamped date, and
   * commit only when the text parsed to 1 or more. So clearing it did nothing —
   * the empty string parsed to 0, no commit happened, and the old digit
   * reappeared before the next keystroke landed. Changing a hatch date from
   * the 9th to the 21st meant fighting the box for the first digit.
   *
   * A draft lets the field hold states the date cannot: empty, mid-typing, or
   * a number this month has no room for. The date only moves when the draft
   * means something, and the draft is dropped on blur so the canonical clamped
   * value is what is left on screen.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const revealed = useRevealOnFocus<TextInput>();

  const set = useCallback(
    (nextYear: number, nextMonth: number, nextDay: number) => {
      // Clamped rather than rolled over: picking 31 and then February should
      // land on the 28th, not silently become the 3rd of March.
      const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
      onChange(new Date(nextYear, nextMonth, Math.min(Math.max(1, nextDay), lastDay)).getTime());
    },
    [onChange],
  );

  return (
    <View style={styles.day}>
      <View style={styles.chips}>
        {MONTHS.map((label, index) => (
          <Chip
            key={label}
            label={label}
            selected={month === index}
            onPress={() => {
              void Haptics.selectionAsync();
              // A month change re-clamps the day, so a half-typed one is stale.
              setDraft(null);
              set(year, index, day);
            }}
          />
        ))}
      </View>

      <View style={styles.dayRow}>
        <TextInput
          ref={revealed.ref}
          onFocus={revealed.onFocus}
          value={draft ?? String(day)}
          onChangeText={(text) => {
            const digits = text.replace(/[^0-9]/g, '').slice(0, 2);
            setDraft(digits);

            // An empty box is a legitimate thing to be holding halfway through
            // a change. It is not a date, so nothing is committed for it.
            const next = Number(digits);
            if (digits !== '' && next >= 1) set(year, month, next);
          }}
          // Both: the draft is dropped so the clamped date shows, and the
          // screen is told there is no longer a field to keep above the fold.
          onBlur={() => {
            setDraft(null);
            revealed.onBlur();
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          accessibilityLabel="Day of the month"
          testID="day-of-month"
          style={[
            styles.dayField,
            { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
          ]}
        />

        {withYear ? (
          <>
            <Chip label="−" selected={false} onPress={() => set(year - 1, month, day)} />
            <Text style={[styles.year, { color: colors.ink }]}>{year}</Text>
            <Chip label="+" selected={false} onPress={() => set(year + 1, month, day)} />
          </>
        ) : null}
      </View>
    </View>
  );
}

// ── actions ──────────────────────────────────────────────────────────────────

export function Primary({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touch affordance="brass"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      {...(testID === undefined ? {} : { testID })}
      // No paint of its own now: the arch inside is the button's face, and a
      // background here would show as a rectangle at the head's shoulders.
      style={({ pressed }) => [styles.primary, { opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
    >
      {/**
        * The doorway, on the one control every screen ends with.
        *
        * UX-SPEC §2 lists primary buttons among the things that are *"arched at
        * the top and squared at the base"*, and this was `RADII.softHead` — so
        * the motif that is supposed to make the app recognisable from across a
        * room appeared on the Tally and nowhere else.
        *
        * A wide button takes the full spring without becoming a dome: the head
        * is an ellipse `w / 2` across and `ARCH.spring` down, so at 300dp wide
        * it is a shallow curve rather than the half-circle a narrow one would
        * get. The label is centred, where the curve is at its highest, so it
        * needs no padding it did not already have.
        */}
      <Arch fill={colors.lantern} style={styles.primaryFace}>
        <Text style={[styles.primaryLabel, { color: colors.lanternOn }]}>{label}</Text>
      </Arch>
    </Touch>
  );
}

export function Secondary({
  label,
  icon,
  onPress,
  danger = false,
  disabled = false,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  danger?: boolean;
  /**
   * Dimmed and inert, like `Primary`.
   *
   * Added for the Google button, which exists before the auth request it
   * needs has finished being prepared — a button that silently does nothing
   * for the first half-second is one people tap twice.
   */
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touch affordance="border"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      {...(testID === undefined ? {} : { testID })}
      /**
       * Disabled dims the WORDS, not the frame — and the difference is the
       * whole of whether this still reads as a button.
       *
       * `Primary` fades to 0.4 and survives it, because underneath is a solid
       * `lantern` fill: at 40% over plaster that is still a pale gold shape you
       * can see is a button. This has no fill. Its only edge is a hairline
       * `border`, and a hairline at 40% over plaster is gone — so a disabled
       * Secondary stopped looking like a control at all and became a line of
       * grey text floating between two panels.
       *
       * Reported on the weighing screen, where "Add and weigh another" is
       * disabled until a number is typed: it read as a caption, so the farm
       * concluded the screen still took one measurement. A control that cannot
       * be seen to be a control cannot be seen to be waiting for you either.
       *
       * `danger` keeps the old treatment: it has a `rowan` fill, so it is in
       * `Primary`'s situation rather than this one.
       */
      style={({ pressed }) => [
        styles.secondary,
        {
          backgroundColor: danger ? colors.rowan : colors.ground,
          borderColor: danger ? colors.rowan : colors.border,
          opacity: danger && disabled ? 0.55 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon === undefined ? null : (
        <Icon
          name={icon}
          size={20}
          color={danger ? '#fff' : disabled ? colors.muted : colors.ink}
        />
      )}
      <Text
        style={[
          styles.secondaryLabel,
          { color: danger ? '#fff' : disabled ? colors.muted : colors.ink },
        ]}
      >
        {label}
      </Text>
    </Touch>
  );
}

/** A tappable list row that goes somewhere. */
export function Row({
  title,
  detail,
  icon,
  onPress,
  testID,
  mark = 'forward',
  tone = 'plain',
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  onPress: () => void;
  testID?: string;
  /**
   * The mark on the right, which is a promise about what pressing does.
   *
   * A chevron means "this opens something", and almost every row here does.
   * The Jobs list does not — pressing a job finishes it — and a chevron there
   * invites somebody to tap expecting a detail screen and tick the job off
   * instead. The affordance has to match the act.
   */
  mark?: IconName;
  /**
   * Whether the detail line is ordinary or a warning.
   *
   * `DueRow` tints an overdue row rowan, and the Jobs list needed the same
   * signal for the same rows: a job three weeks late in the same muted grey as
   * one due next month is a list that has stopped telling you anything. Only
   * the detail line moves — the title stays ink, because the job itself is not
   * an emergency, its date is.
   */
  tone?: 'plain' | 'alert';
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touch affordance="chevron"
      onPress={onPress}
      accessibilityRole="button"
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      {icon === undefined ? null : <Icon name={icon} size={24} color={colors.muted} />}
      <View style={styles.rowWords}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {detail === undefined ? null : (
          <Text
            style={[styles.rowDetail, { color: tone === 'alert' ? colors.rowan : colors.muted }]}
          >
            {detail}
          </Text>
        )}
      </View>
      <Icon name={mark} size={20} color={colors.muted} />
    </Touch>
  );
}

/** Two taps, and the second one says what it will do. For anything destructive. */
export function Confirm({
  label,
  armedLabel,
  onConfirm,
  testID,
}: {
  label: string;
  armedLabel: string;
  onConfirm: () => void;
  testID?: string;
}): React.ReactElement {
  const [armed, setArmed] = useState(false);

  return (
    <Secondary
      label={armed ? armedLabel : label}
      danger={armed}
      {...(testID === undefined ? {} : { testID })}
      onPress={() => {
        if (!armed) {
          setArmed(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        }
        onConfirm();
      }}
    />
  );
}

// ── the write path ───────────────────────────────────────────────────────────

export interface Saver {
  /** True while a save is in flight. Drives the primary button's disabled state. */
  saving: boolean;
  /** The last failure, in words, or null. Render it with `<Failure>`. */
  failure: string | null;
  /**
   * The last success sentence, or null. Render it with `<Confirmation>`.
   *
   * Null on every form that navigates away, because nothing passed one.
   */
  said: string | null;
  /**
   * Runs the writes, then `onDone` — or reports why it could not.
   *
   * `say` is the one sentence this form is allowed on success, from
   * `@homefarm/core/voice`. Omit it on any form that leaves: the screen
   * underneath changing is the confirmation, and a sentence rendered onto a
   * view that unmounts in the same frame is shown to nobody.
   */
  save: (run: () => Promise<void>, say?: string) => Promise<void>;
}

/** Long enough to be read at arm's length, short enough not to become furniture. */
const SAID_MS = 3_000;

/**
 * The save half of every form on this app, done once.
 *
 * The failure branch is the reason this exists rather than being three lines
 * per screen. `saving` must come back down — the guard reads it, so leaving it
 * true on a throw makes the button permanently dead with the typed-in work
 * still on screen and nothing said about why. That bug was written twice by
 * hand before it was extracted.
 *
 * ## The success branch used to say nothing at all
 *
 * It fired a haptic and called `onDone`. On the two-thirds of forms that
 * navigate away that is complete — the previous screen comes back with the new
 * row on it. On the third that stay, it meant a farmer pressed Save, felt a
 * buzz, and looked at a form that appeared not to have done anything. The
 * haptic is not available to somebody with the phone on a fence post, and it
 * is the only acknowledgement there was.
 */
export function useSaver(onDone: () => void): Saver {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  // Cleared on unmount, or a form that saves and then leaves would set state
  // on a view that is gone. `Tally` gets away without this because it is never
  // the thing being navigated off; a form is.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const save = useCallback(
    async (run: () => Promise<void>, say?: string) => {
      if (saving) return;
      setSaving(true);
      setFailure(null);
      setSaid(null);

      try {
        await run();
      } catch (error) {
        setSaving(false);
        setFailure(describeLogFailure(error));
        /**
         * Also to the banner, which carries the first stack frame that is not
         * node_modules. The sentence on the form tells a farmer what to do;
         * this tells whoever is fixing it where to look, and the two are not
         * the same audience.
         */
        reportTrouble('saving that', error);
        return;
      }

      /**
       * **Cleared on the way out as well as on the way in.**
       *
       * `setSaving(false)` lived only in the catch above, so a save that
       * succeeded left the flag true forever — and the guard at the top of this
       * function then refused every later press. One write per screen, silently.
       *
       * It hid because most forms save and leave: `useSaver(useLeave())`
       * unmounts the screen, the flag goes with it, and nothing is ever asked
       * again. The screens that stay put are the ones that show it, and a bed
       * is the obvious case — reported as *"the plant screen only allows for 1
       * interaction, if you select sow you have to leave the screen to select
       * plant it"*. Sowing and planting out are two presses on one visit by
       * design.
       *
       * Before `onDone`, because `onDone` is often a navigation and setting
       * state on a screen that has gone is the other half of this bug.
       */
      setSaving(false);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (say !== undefined) {
        setSaid(say);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setSaid(null), SAID_MS);
      }

      onDone();
    },
    [saving, onDone],
  );

  return { saving, failure, said, save };
}

export function Failure({ message }: { message: string | null }): React.ReactElement | null {
  if (message === null) return null;
  return (
    <Panel>
      <Body>{message}</Body>
    </Panel>
  );
}

/**
 * The one sentence a form is allowed after it saves (UX-SPEC §6).
 *
 * Set in the body face, not the data face: it is read as English rather than
 * scanned as a value, and in `inkQuiet` because it is the least urgent text on
 * the screen by construction — nothing depends on it being read at all.
 * `polite` so a screen reader finishes what it was saying first.
 *
 * ## Why it holds its space when it has nothing to say
 *
 * The obvious build returns `null` and lets the form collapse. That puts a
 * blank line into the layout on save and takes it out again three seconds
 * later — twice moving the primary button under a thumb that has just been on
 * it. One reserved line costs a few pixels on four forms; a control that
 * shifts under a finger costs a mis-tap in a barn.
 *
 * The same trick, for the same reason, as `Tally`'s confirmation line.
 */
export function Confirmation({ message }: { message: string | null }): React.ReactElement {
  const { colors } = useTheme();
  const opacity = useFade(message !== null);

  return (
    <Animated.Text
      style={[styles.said, { color: colors.inkQuiet, opacity }]}
      accessibilityLiveRegion="polite"
    >
      {/* A space rather than an empty string: an empty Text collapses to zero
          height and reintroduces the shift this is written to avoid. */}
      {message ?? ' '}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  said: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    lineHeight: TYPE.body * 1.4,
    // Holds the line whether or not there is anything on it.
    minHeight: TYPE.body * 1.4,
  },
  field: { gap: SPACE.sm },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
  },
  multiline: { minHeight: TAP.min * 2, paddingTop: SPACE.md, textAlignVertical: 'top' },
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
  toggle: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
  },
  toggleLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: TAP.gap, flexWrap: 'wrap' },
  stepperValue: { fontFamily: FONTS.display, fontSize: TYPE.title, fontVariant: ['tabular-nums'] },
  number: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  numberField: {
    minHeight: TAP.min,
    minWidth: 140,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.data,
    fontSize: TYPE.lede,
  },
  suffix: { fontFamily: FONTS.body, fontSize: TYPE.body },
  day: { gap: SPACE.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: TAP.gap, flexWrap: 'wrap' },
  year: { fontFamily: FONTS.data, fontSize: TYPE.lede, fontVariant: ['tabular-nums'] },
  dayField: {
    minHeight: TAP.min,
    width: 96,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.data,
    fontSize: TYPE.lede,
    textAlign: 'center',
  },
  primary: { minHeight: TAP.primary, marginTop: SPACE.sm },
  // The face fills the target, so the whole door is pressable rather than the
  // label's own box.
  primaryFace: {
    flex: 1,
    minHeight: TAP.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    minHeight: TAP.min,
    /**
     * **The words need room, and for a long time they only got it by accident.**
     *
     * There was no horizontal padding here at all. In a column that is
     * invisible: the button stretches to the panel and the centred label has
     * the whole width to sit in. Put two in a `flexDirection: 'row'` — which
     * `Photos` does — and each one shrinks to its content instead, so the
     * label ends up flat against a hairline border on both sides. Reported
     * from a handset as the ugliest thing in the app, and it was.
     *
     * `SPACE.md` rather than something smaller because this is a glove target
     * (R3): the padding is part of what the thumb is aiming at, not decoration
     * around it.
     */
    paddingHorizontal: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
  row: {
    // A row is a grid cell on the hubs — The farm, Settings, Log something —
    // and fills it rather than leaving the slack under a one-line row beside a
    // two-line one. See `Grid` for why this is `flexGrow` and why it is here.
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowWords: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: FONTS.body, fontSize: TYPE.body },
  /**
   * **The body face, because a detail line is a sentence.**
   *
   * This was the data face — `RecursiveMono` at label size with tracking — and
   * a `Row` is what The farm, Settings and Log something are built from. So
   * every door on the hub described itself in monospace: *"Groups,
   * individuals, health, and what they produce"*, set as though it were a
   * meter reading. A screen of that reads like a terminal, which is the one
   * thing UX-SPEC §2 says this app is not.
   *
   * The spec spends the data face on *"pantry-label typography — section
   * labels, small-caps, tracked... structural, not decorative"*, and `Screen`
   * makes the same argument about its own subtitle: setting a proper noun in
   * tracked caps *"is the same mistake as printing a species' collective noun
   * as telemetry"*. The rule was written down and this line was the one place
   * that broke it, on the screen a farm opens most.
   *
   * Body size rather than label size, too. It is a sentence, and a sentence
   * set two steps under its own title is a footnote.
   */
  rowDetail: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
});

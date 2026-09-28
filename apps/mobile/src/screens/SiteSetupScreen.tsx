import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  isValidMonthDay,
  monthDay,
  newId,
  normaliseZoneValue,
  splitMonthDay,
} from '@homefarm/contracts';
import { readSiteOrBlank } from '@homefarm/core/read/growing';
import { Chip, Failure, Field, NumberField, Primary, TextField, useSaver } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { SPACE } from '../theme/tokens';

/**
 * Where the farm is, in the two senses that matter.
 *
 * **Zone and frost dates are both asked for, because they answer different
 * questions.** The zone is the average annual minimum winter temperature and
 * decides what SURVIVES — fruit trees, asparagus, rhubarb, canes, perennial
 * herbs. The frost dates are the growing window and decide WHEN every annual
 * goes in. Neither can be computed from the other.
 *
 * The zone is optional and the frost dates are not, and that ordering is
 * deliberate: nothing on the Growing tab works without a growing window, and
 * plenty works without knowing whether a fig will survive.
 *
 * Typed rather than looked up, for now. The bundled US table and the online
 * lookup both exist to save someone typing on day one — they are conveniences
 * over this screen, not replacements for it, because a farmer knows their own
 * land better than a postcode does.
 *
 * ## Built from the form parts, like every other form
 *
 * This screen predated `Form.tsx` and kept its own `Field`, its own text
 * inputs, its own month chips and its own save button — so it was the one
 * form whose fields did not scroll clear of the keyboard (`useRevealOnFocus`
 * lives in `TextField`), whose chips were a different height from every other
 * chip, and whose save could be left dead by a throw. Same testIDs, same
 * words, the shared parts underneath.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function SiteSetupScreen(): React.ReactElement {
  const log = useLog();

  /**
   * The site this farm already has, if any.
   *
   * This screen used to `create` unconditionally. `readSite` returns the FIRST
   * site record, so a second create became a record nothing ever reads — and
   * the weather screen writes a position onto the same entity. A farm that set
   * its position and then its frost dates would have lost one of the two,
   * silently, with both writes reported as saved.
   */
  const site = useLive(readSiteOrBlank, 'the farm');

  /**
   * The defaults are a starting suggestion for a farm that has never answered,
   * and nothing more. They are overwritten by the record the moment one exists
   * — see the seeding effect below, without which re-opening this screen
   * silently proposed mid-May and early October to every farm on earth.
   */
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [lastMonth, setLastMonth] = useState(4); // May, zero-indexed
  const [lastDay, setLastDay] = useState('15');
  const [firstMonth, setFirstMonth] = useState(9); // October
  const [firstDay, setFirstDay] = useState('5');

  const { saving, failure, save } = useSaver(useLeave());

  /**
   * Fill the form from the site, once.
   *
   * **This screen edits as often as it creates**, and until this existed it
   * only ever created: the four date fields started at hardcoded constants and
   * were never told what the farm had already said. A keeper who set 20 April
   * re-opened the screen, was shown 15 May, and saving wrote that over the
   * real date — stamped `source: 'entered'`, so everything downstream treated
   * the app's suggestion as the farmer's own answer. Frost dates drive every
   * sow window, transplant date and autumn count-back in the app, so the wrong
   * number here is the wrong number everywhere, silently.
   *
   * Guarded on `loaded` rather than on the record's identity, for the reason
   * `TreatmentScreen` gives: `useLive` re-reads on every engine publish, and
   * re-seeding on each would discard whatever was being typed the moment
   * anything else in the app saved.
   *
   * A field the site does not carry keeps its default. That is why the
   * condition is per-field rather than one branch on `site.frost` — a farm
   * with a position and no frost dates is a real state, and it should meet the
   * suggestion rather than a blank.
   */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || site === null) return;
    if (site.name !== '') setName(site.name);
    if (site.zone !== undefined) setZone(site.zone.value);
    if (site.frost !== undefined) {
      const last = splitMonthDay(site.frost.lastSpring);
      const first = splitMonthDay(site.frost.firstAutumn);
      // `splitMonthDay` speaks the same 1-indexed months `monthDay` takes; the
      // picker's state is zero-indexed because it indexes MONTHS.
      setLastMonth(last.month - 1);
      setLastDay(String(last.day));
      setFirstMonth(first.month - 1);
      setFirstDay(String(first.day));
    }
    setLoaded(true);
  }, [loaded, site]);

  const lastSpring = monthDay(lastMonth + 1, Number(lastDay) || 0);
  const firstAutumn = monthDay(firstMonth + 1, Number(firstDay) || 0);
  const datesValid = isValidMonthDay(lastSpring) && isValidMonthDay(firstAutumn);

  const commit = (): void => {
    if (!datesValid || site === null) return;

    const known = site.id !== '';

    void save(async () => {
      await log({
        entity: 'site',
        op: known ? 'update' : 'create',
        targetId: known ? site.id : newId(),
        payload: {
          // An update carries only what this screen owns, so a position set on
          // the weather screen is not wiped by somebody re-entering frost dates.
          name: name.trim() || (known ? site.name : '') || 'The farm',
          frost: { lastSpring, firstAutumn, source: 'entered' as const },
          /**
           * USDA because that is what the bundled data speaks. Stored WITH its
           * system, never as a bare string — "7a" means nothing on its own,
           * and a bare column is a US-only column wearing a general name.
           *
           * **A blank box clears it, and it used to be indistinguishable from
           * not touching it.** An omitted key keeps its old value — that is the
           * whole of `contracts/clearing.ts` — so a farm that had typed the
           * wrong zone could not take it back out. The box emptied, the save
           * succeeded, and the old zone came straight back with every hardiness
           * warning it drives.
           *
           * `null` is the wire's word for "cleared", and it is legal only on an
           * update at the top level: a create with no zone simply has no zone,
           * and the schema refuses `null` there. Both halves are asserted.
           */
          ...(zone.trim() === ''
            ? known
              ? { zone: null }
              : {}
            : { zone: { system: 'usda' as const, value: normaliseZoneValue(zone) } }),
        },
      });
    });
  };

  return (
    <Screen title="Your ground" back>
      <Panel label="Why this matters">
        <Body>
          Frost dates decide when everything goes in — sow six weeks before the last one, count
          back from the first for autumn crops. Your zone is a different question: it decides
          what survives the winter.
        </Body>
      </Panel>

      <Field label="What do you call this place?">
        <TextField value={name} onChangeText={setName} placeholder="The farm" maxLength={80} />
      </Field>

      <Field label="Last spring frost">
        <DatePick
          month={lastMonth}
          day={lastDay}
          onMonth={setLastMonth}
          onDay={setLastDay}
          testID="frost-last-day"
        />
      </Field>

      <Field label="First autumn frost">
        <DatePick
          month={firstMonth}
          day={firstDay}
          onMonth={setFirstMonth}
          onDay={setFirstDay}
          testID="frost-first-day"
        />
      </Field>

      <Field
        label="Hardiness zone (optional)"
        hint="USDA. Leave it blank if you do not know — it only affects what the app says about perennials surviving winter, and it warns rather than stops you."
      >
        {/* `caps` because a zone is a code, not a word: "7a" and "7A" are the
            same zone, `normaliseZoneValue` lowercases on save, and a keyboard
            that autocorrects "7a" to something it likes better is the one
            thing this field must not have. Nothing could drive this field from
            a test, which is part of why a zone that could not be cleared went
            unnoticed. */}
        <TextField value={zone} onChangeText={setZone} placeholder="7a" maxLength={8} caps testID="site-zone" />
      </Field>

      <Failure message={datesValid ? null : 'Those dates are not both real days. Check the numbers.'} />
      <Failure message={failure} />

      <Primary label="Save" onPress={commit} disabled={saving || !datesValid} testID="save-site" />
    </Screen>
  );
}

/**
 * Month chips and a day field.
 *
 * Not a date picker: a native one opens a wheel showing a YEAR, and a frost
 * date is a fact about a place rather than about 2026. Asking for the year
 * would be asking a question with no right answer.
 */
function DatePick({
  month,
  day,
  onMonth,
  onDay,
  testID,
}: {
  month: number;
  day: string;
  onMonth: (m: number) => void;
  onDay: (d: string) => void;
  /**
   * On the day field, so a test can read what the picker is actually showing.
   *
   * The month is a row of chips whose selection is styling and an
   * `accessibilityState`, and every label renders whatever is chosen — so the
   * flattened text of this screen says "Jan Feb Mar…" in every state and can
   * prove nothing about which one is set. That is how a screen proposing the
   * wrong date to every farm went unnoticed.
   */
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.date}>
      <View style={styles.months}>
        {MONTHS.map((label, index) => (
          <Chip
            key={label}
            label={label}
            selected={month === index}
            onPress={() => {
              void Haptics.selectionAsync();
              onMonth(index);
            }}
          />
        ))}
      </View>

      <NumberField
        value={day}
        // Two digits is every day of every month; a third is a slip.
        onChangeText={(text) => onDay(text.slice(0, 2))}
        whole
        accessibilityLabel="Day of the month"
        {...(testID === undefined ? {} : { testID })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  date: { gap: SPACE.sm },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
});

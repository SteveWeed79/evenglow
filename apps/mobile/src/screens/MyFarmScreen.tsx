import { useState } from 'react';
import {
  type Currency,
  DEFAULT_CURRENCY,
  DEFAULT_UNIT_SYSTEM,
  ENTERPRISES,
  type Enterprise,
  formatMoney,
  newId,
  UNIT_SYSTEMS,
  type UnitSystem,
} from '@steading/contracts';
import { listGroups } from '@steading/core/read/groups';
import { readSiteOrBlank } from '@steading/core/read/growing';
import { listBeds, listPlantings } from '@steading/core/read/growing';
import { listMachines } from '@steading/core/read/iron';
import { FarmName } from '../components/FarmName';
import { Choice as Picker, Failure, Field, Primary, Toggle, useSaver } from '../components/Form';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';

/**
 * What this farm actually does, asked once.
 *
 * A market gardener has no stock. A poultry keeper on a suburban plot has no
 * tractor and no beds. Both used to get four tabs, two of them empty forever,
 * and every list of what-you-can-do offered things they would never want.
 *
 * ## Coarse on purpose
 *
 * This says whether a whole part of the farm exists. It does **not** say what
 * any individual animal is for — that is `purposes` on the group, and it
 * already decides per flock whether the processing clock runs and whether an
 * egg tally appears. Somebody keeping hens for eggs and never for the table
 * answers that where the hens are, not here. Two settings answering one
 * question is how they end up disagreeing.
 *
 * ## Hiding, never deleting
 *
 * Invariant 13, and it is the whole reason this is safe to offer. Switching
 * Growing off keeps every planting, bed and harvest exactly where it was; the
 * tab stops appearing and comes back with everything in it. So the screen says
 * what is in there before you turn it off, and then believes you.
 *
 * ## Why it lives on the site
 *
 * It syncs, so two hands on one farm are not looking at two different apps.
 * The site already carries `units` and `rotationYears`, which are farm-wide
 * preferences rather than facts about a place, so this is the established home
 * for exactly this kind of answer.
 *
 * ## Units and currency, because nothing could set them
 *
 * `units` had been on the site record since the site record existed and no
 * screen wrote it — a setting that could be read and never chosen, which is
 * the same as no setting at all. Six screens now honour it, so it needs a
 * switch. Currency arrives with cost tracking and belongs beside it: both are
 * how the farm READS, as against what it runs.
 */

interface Choice {
  key: Enterprise;
  title: string;
  detail: string;
}

const UNIT_LABELS: Record<UnitSystem, string> = {
  imperial: 'Pounds and °F',
  metric: 'Kilos and °C',
};

/**
 * The ones a smallholding is likely to keep books in.
 *
 * Short on purpose: a picker of the world's 180 currencies is a scroll nobody
 * finishes, and this is a question asked once. The schema takes any three
 * capital letters, so a farm outside this list is not locked out — it just has
 * nowhere to say so yet, which is a smaller gap than a list that long.
 */
const CURRENCIES: readonly Currency[] = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'];

const CHOICES: readonly Choice[] = [
  {
    key: 'stock',
    title: 'Animals',
    detail: 'Poultry, goats, sheep, cattle, pigs — anything you keep and log against',
  },
  {
    key: 'growing',
    title: 'Crops and beds',
    detail: 'Sowing, planting out, harvests, and the frost dates behind them',
  },
  {
    key: 'iron',
    title: 'Machines and kit',
    detail: 'Servicing, hours, and the parts shelf',
  },
];

export function MyFarmScreen(): React.ReactElement {
  const log = useLog();

  /**
   * `readSiteOrBlank`, not `readSite`.
   *
   * This screen is reachable from Settings before Growing has ever been
   * opened, so a farm that only keeps animals has no site record — and
   * `readSite`'s null for that is the same value `useLive` uses for "not read
   * yet". The screen waited on a read that had already answered, and showed a
   * title over an empty page. See the note on `readSiteOrBlank`.
   */
  const site = useLive(readSiteOrBlank, 'your farm');
  const groups = useLive(listGroups, 'your stock');
  const beds = useLive(listBeds, 'your beds');
  const plantings = useLive(listPlantings, 'your plantings');
  const machines = useLive(listMachines, 'your machines');

  const [edits, setEdits] = useState<Enterprise[] | null>(null);
  // Null is "not touched on this visit", so an unanswered setting keeps
  // showing the farm's default rather than committing that default as a
  // deliberate choice the moment somebody opens this screen for the beds.
  const [units, setUnits] = useState<UnitSystem | null>(null);
  const [currency, setCurrency] = useState<Currency | null>(null);

  const { saving, failure, save } = useSaver(useLeave());

  if (site === null) return <Loading title="My farm" />;

  const chosen = edits ?? site.enterprises;
  const reads = units ?? site.units ?? DEFAULT_UNIT_SYSTEM;
  const money = currency ?? site.currency ?? DEFAULT_CURRENCY;

  /** What is already recorded under each, so turning one off is informed. */
  const held: Record<Enterprise, number> = {
    stock: groups?.length ?? 0,
    growing: (beds?.length ?? 0) + (plantings?.length ?? 0),
    iron: machines?.length ?? 0,
  };

  const toggle = (key: Enterprise): void => {
    setEdits(chosen.includes(key) ? chosen.filter((e) => e !== key) : [...chosen, key]);
  };

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'site',
        // A farm that reached Growing without ever naming its site has no site
        // record yet, and this is as good a moment to make one as any.
        op: site.id === '' ? 'create' : 'update',
        targetId: site.id === '' ? newId() : site.id,
        payload: {
          ...(site.id === '' ? { name: 'My farm' } : {}),
          enterprises: ordered(chosen),
          // Written every save, including when untouched: `reads` and `money`
          // are what the screen was SHOWING, so saving records what somebody
          // just looked at and agreed with rather than leaving it unsaid.
          units: reads,
          currency: money,
        },
      });
    });
  };

  return (
    <Screen title="My farm" back>
      {/**
        * First, because it is the answer to "which farm is this?" and the rest
        * of the screen is the answer to "what does it do?".
        *
        * Renders nothing at all for a hand, or before the account has been
        * read — see `FarmName` for the four guards and for why it lives here
        * rather than on the screen about people or the screen about you.
        */}
      <FarmName />

      <Panel label="What do you run?">
        <Body>
          Turning something off only hides it. Everything you have logged stays where it is and
          comes back if you turn it on again.
        </Body>
      </Panel>

      {CHOICES.map((choice) => (
        <Field
          key={choice.key}
          label={choice.title}
          hint={
            // Named before it is hidden, so the decision is made knowing what
            // is behind it.
            !chosen.includes(choice.key) && held[choice.key] > 0
              ? `${choice.detail}. You have ${held[choice.key]} recorded — kept, just hidden.`
              : choice.detail
          }
        >
          <Toggle
            label={chosen.includes(choice.key) ? 'Yes' : 'No'}
            value={chosen.includes(choice.key)}
            onChange={() => toggle(choice.key)}
            testID={`enterprise-${choice.key}`}
          />
        </Field>
      ))}

      <Field
        label="Weights and temperatures"
        hint="Everything that shows a weight or a temperature reads in this — the scales, the forecast, the feed."
      >
        <Picker
          options={UNIT_SYSTEMS}
          value={reads}
          onChange={setUnits}
          labels={UNIT_LABELS}
        />
      </Field>

      <Field
        label="Money"
        hint={`Prices show as ${formatMoney(2250, money)}. What a sack cost is how cost per egg gets worked out.`}
      >
        <Picker
          options={CURRENCIES}
          value={money}
          onChange={setCurrency}
          labels={Object.fromEntries(CURRENCIES.map((code) => [code, code]))}
        />
      </Field>

      {chosen.length === 0 ? (
        <Panel label="Everything is off">
          <Body>
            Today still works — it is where the app says there is nothing to log yet. Turn
            something on above whenever you are ready.
          </Body>
        </Panel>
      ) : null}

      <Failure message={failure} />
      <Primary label="Save" disabled={saving} onPress={commit} testID="save-my-farm" />
    </Screen>
  );
}

/**
 * Stored in the order the app presents them, not the order they were tapped.
 *
 * Two devices that chose the same three should write the same array, or the
 * mutable-entity conflict rules will see a difference that is not one.
 */
function ordered(chosen: readonly Enterprise[]): Enterprise[] {
  return ENTERPRISES.filter((key) => chosen.includes(key));
}

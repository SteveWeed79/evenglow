import { useCallback, useState } from 'react';
import { cropDefaults, LIFECYCLES, newId, scheduleFor } from '@homefarm/contracts';

type Lifecycle = (typeof LIFECYCLES)[number];
import { listBeds, readSite } from '@homefarm/core/read/growing';
import { Choice, Failure, Field, Primary, Stepper, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive2 } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * Something to plant that the library has never heard of.
 *
 * ## Why this had to exist
 *
 * The bundled library is a few hundred varieties and there are tens of
 * thousands. The first real morning of use found one: *"my wife just planted
 * Black Pumpkins"* — a search with no result and no way forward, over a seed
 * already in the ground. Growing the library does not fix that; it only moves
 * where the edge is.
 *
 * A library will always lose that race. `DOMAIN-SCOPE.md` 2.4 settles what
 * happens when it does — *"an app that tells a grower no is an app that is
 * wrong about that grower"* — and a picker that only offers what shipped is
 * that refusal wearing a different hat.
 *
 * ## The data model was already waiting for this
 *
 * `variety` has carried `custom: z.boolean().optional()` since it was written,
 * documented as *"false for the bundled library, true for anything the farm
 * added itself"*, and `varietyPayload` has always stamped `custom: false`.
 * **Nothing anywhere set it true.** The flag was waiting for a screen.
 *
 * ## Two fields, and the rest is optional on purpose
 *
 * A name and a crop is all this asks for, because the alternative is a form
 * somebody abandons while holding a seed packet. Everything else — the family,
 * how long it takes, when to start it — refines what the app can say and none
 * of it is needed to record the fact.
 *
 * What that costs is stated rather than hidden: with no days to maturity there
 * is no harvest date, and the screen says so before the save rather than
 * leaving somebody to wonder where the row went.
 */

const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  annual: 'One season',
  biennial: 'Two seasons',
  perennial: 'Comes back',
};

export function AddVarietyScreen({ route }: ScreenProps<'AddVariety'>): React.ReactElement {
  const { bedId, crop: suggested } = route.params;
  const log = useLog();

  const loaded = useLive2(readSite, listBeds);
  const site = loaded?.[0] ?? null;
  const bed = loaded?.[1]?.find((b) => b.id === bedId) ?? null;

  const [name, setName] = useState('');
  const [crop, setCrop] = useState(suggested ?? '');
  /** Null until the grower touches it, so the crop's own answer can show through. */
  const [chosenLifecycle, setChosenLifecycle] = useState<Lifecycle | null>(null);
  const [days, setDays] = useState(0);

  /**
   * What the crop table knows about whatever was typed, if anything.
   *
   * `family` drives `rotationConflict` — brassicas after brassicas build club
   * root — so it is worth having, and it is also the one field on this form a
   * grower has no reason to know. Nobody planting a pumpkin thinks "cucurbit".
   *
   * `lifecycle` is a fair guess for the same reason: rosemary comes back and
   * basil does not, whatever the cultivar is called. It is a default rather
   * than a decision — the buttons stay live and a choice made there wins.
   *
   * An unrecognised crop falls to `other` and `annual`, which means no rotation
   * warning rather than a wrong one.
   *
   * Days to maturity is deliberately *not* pre-filled. That is the one number
   * that belongs to the cultivar rather than the crop, and this screen exists
   * precisely because the cultivar is one nothing here has heard of.
   */
  const known = cropDefaults(crop);
  const lifecycle: Lifecycle = chosenLifecycle ?? known?.lifecycle ?? 'annual';

  const { saving, failure, save } = useSaver(useLeave());

  const enough = name.trim() !== '' && crop.trim() !== '';

  const plant = useCallback(() => {
    if (!enough || bed === null) return;

    void save(async () => {
      const varietyId = newId();

      await log({
        entity: 'variety',
        op: 'create',
        targetId: varietyId,
        payload: {
          name: name.trim(),
          crop: crop.trim(),
          family: known?.family ?? 'other',
          lifecycle,
          // Zero is the stepper's way of saying "not filled in", and an
          // optional field is absent rather than nought.
          ...(days > 0 ? { daysToMaturity: days } : {}),
          custom: true,
        },
      });

      /**
       * Planted at the same moment, because that is why anybody is here.
       *
       * A farm's own variety has no library timing to schedule from, so the
       * only planned date available is a first harvest — and only when days to
       * maturity was given. The rest fill in from the buttons on the planting
       * itself, which is where the real dates come from anyway.
       */
      const schedule =
        site?.frost === undefined || days <= 0
          ? null
          : scheduleFor(
              {
                startIndoorsWeeksBefore: null,
                transplantWeeksAfter: null,
                directSowWeeksAfter: null,
                autumnSowWeeksBefore: null,
                daysToMaturity: days,
              },
              site.frost,
              new Date().getFullYear(),
            );

      await log({
        entity: 'planting',
        op: 'create',
        targetId: newId(),
        payload: {
          bedId: bed.id,
          varietyId,
          season: new Date().getFullYear(),
          status: 'planned' as const,
          ...(schedule?.firstHarvestAt == null ? {} : { plannedFirstHarvestAt: schedule.firstHarvestAt }),
        },
      });
    });
  }, [enough, bed, save, log, name, crop, known, lifecycle, days, site]);

  if (loaded === null) return <Loading title="Add a variety" />;
  if (bed === null) return <Missing title="Add a variety" what="That bed" />;

  return (
    <Screen title="Something of your own" back>
      <Panel label={`Planting in ${bed.name}`}>
        <Body>
          The list only knows a few hundred. Anything else you grow goes here, and it is yours —
          nothing that ships with a later version will overwrite it.
        </Body>
      </Panel>

      <Field label="What is it called?" hint="The variety. 'Black Futsu', 'Roma'.">
        <TextField value={name} onChangeText={setName} placeholder="Black Futsu" testID="variety-name" />
      </Field>

      <Field label="What kind of thing is it?" hint="The crop. 'Pumpkin', 'Tomato'.">
        <TextField value={crop} onChangeText={setCrop} placeholder="Pumpkin" testID="variety-crop" />
      </Field>

      <Field
        label="How long does it live?"
        {...(chosenLifecycle === null && known !== undefined
          ? { hint: `Most ${crop.trim().toLowerCase()} does this. Change it if yours is different.` }
          : {})}
      >
        <Choice
          options={LIFECYCLES}
          value={lifecycle}
          onChange={setChosenLifecycle}
          labels={LIFECYCLE_LABELS}
        />
      </Field>

      <Field
        label="Days to maturity"
        hint={
          days > 0
            ? 'Counted from the day it goes in the ground.'
            : 'Skip it if you do not know — you will just not get a "should be ready" reminder.'
        }
      >
        <Stepper value={days} onChange={setDays} steps={[5, 25]} min={0} suffix="days" testID="variety-days" />
      </Field>

      <Failure message={failure} />

      <Primary
        label={saving ? 'Planting…' : `Plant it in ${bed.name}`}
        onPress={plant}
        disabled={!enough || saving}
        testID="variety-save"
      />
    </Screen>
  );
}

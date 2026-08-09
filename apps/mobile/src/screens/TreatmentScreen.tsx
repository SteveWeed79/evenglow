import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  MEDICATION_ROUTES,
  newId,
  WITHDRAWAL_KINDS,
  type WithdrawalKind,
} from '@steading/contracts';
import { listGroups } from '@steading/core/read/groups';
import { type TreatmentDetail, treatmentById } from '@steading/core/read/withdrawals';
import {
  Chip,
  Confirm,
  Failure,
  Field,
  Primary,
  Stepper,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * Recording a treatment — and with it, the withdrawal window.
 *
 * The highest-value feature in the competitive analysis, and until this screen
 * existed it could not be reached: `activeWithdrawals` was written, tested and
 * wired into the banner and the Today list, and nothing in the app could
 * create the medication record it reads. The interlock that stops someone
 * selling eggs inside a withdrawal period was, in practice, never armed.
 *
 * **The withdrawal is asked for per produce kind, and defaults to nothing.**
 * A topical wound spray does not stop egg sales, and an app that assumed
 * otherwise would have people either lying to it or ignoring it. The number
 * comes off the bottle; it is not something this app can know.
 *
 * The clock counts from the LAST day of treatment, not the first. A five-day
 * course with a seven-day egg withdrawal clears twelve days after it started,
 * and getting that wrong is a compliance failure in the direction that
 * matters.
 */

const ROUTE_LABELS: Record<(typeof MEDICATION_ROUTES)[number], string> = {
  water: 'In the water',
  feed: 'In the feed',
  injection: 'Injected',
  topical: 'On the skin',
  oral: 'By mouth',
  other: 'Some other way',
};

const KIND_LABELS: Record<WithdrawalKind, string> = {
  egg: 'Eggs',
  meat: 'Meat',
  milk: 'Milk',
};

export function TreatmentScreen({ route }: ScreenProps<'Treatment'>): React.ReactElement {
  const { groupId, treatmentId } = route.params;
  const editing = treatmentId !== undefined;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const readTreatment = useCallback(
    async (): Promise<TreatmentDetail | null> => (treatmentId === undefined ? null : treatmentById(treatmentId)),
    [treatmentId],
  );
  const existing = useLive(readTreatment);

  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [medRoute, setMedRoute] = useState<(typeof MEDICATION_ROUTES)[number]>('water');
  const [dose, setDose] = useState('');
  const [stillGoing, setStillGoing] = useState(false);
  const [withdrawal, setWithdrawal] = useState<Record<WithdrawalKind, number>>({
    egg: 0,
    meat: 0,
    milk: 0,
  });

  /**
   * Fill the form from the record, once.
   *
   * Guarded on `loaded` rather than on the record's identity: `useLive`
   * re-reads on every engine publish, and re-seeding on each of those would
   * throw away whatever the person had typed the moment anything else in the
   * app saved. That is the bug this shape exists to avoid.
   */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || existing === null) return;
    setName(existing.name);
    setReason(existing.reason ?? '');
    setMedRoute(existing.route ?? 'water');
    setDose(existing.dose ?? '');
    setStillGoing(existing.treatmentEndsAt === undefined);
    setWithdrawal({
      egg: existing.withdrawalDays?.egg ?? 0,
      meat: existing.withdrawalDays?.meat ?? 0,
      milk: existing.withdrawalDays?.milk ?? 0,
    });
    setLoaded(true);
  }, [loaded, existing]);

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));
  const removed = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    const now = Date.now();
    const days = Object.fromEntries(
      // Zero means "no withdrawal on this kind", which is different from
      // "a withdrawal of zero days" only in that the second is noise on the
      // record. Absent is the honest encoding of the first.
      WITHDRAWAL_KINDS.filter((kind) => withdrawal[kind] > 0).map((kind) => [kind, withdrawal[kind]]),
    );

    void save(async () => {
      /**
       * An edit keeps the day it was given, and never silently re-dates it.
       *
       * `administeredAt` is what every withdrawal is counted from. Stamping it
       * with "now" on a correction would move the clock forward and hold
       * produce that had already cleared — or, worse, the other way round on a
       * backdated record.
       */
      const administeredAt = existing?.administeredAt ?? now;

      /**
       * Closing a running course dates it today; a course already closed keeps
       * the end date it had unless the toggle is switched back on.
       *
       * Closing is what makes the withdrawal correct. With no end date
       * `withdrawalClearsAt` counts from the first dose, so an open course
       * under-states the window by however long it ran — it clears produce
       * early, which is the one direction this must never err in. Recording
       * the real last day is the only thing that fixes it, and guessing one on
       * the farmer's behalf would err the same way.
       */
      const endsAt = stillGoing ? undefined : (existing?.treatmentEndsAt ?? now);

      const payload = {
        flockId: groupId,
        name: name.trim(),
        administeredAt,
        route: medRoute,
        ...(endsAt === undefined ? {} : { treatmentEndsAt: endsAt }),
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        ...(dose.trim() === '' ? {} : { dose: dose.trim() }),
        ...(Object.keys(days).length === 0 ? {} : { withdrawalDays: days }),
      };

      /**
       * An update MERGES on both sides (see db/project.ts), so a field the
       * person cleared would keep its old value — a withdrawal revised down to
       * nothing would go on holding the produce. Every optional field is
       * therefore named explicitly on an edit, with `undefined` where it is
       * now absent, rather than being left out of the object.
       */
      const cleared = editing
        ? {
            reason: reason.trim() === '' ? undefined : reason.trim(),
            dose: dose.trim() === '' ? undefined : dose.trim(),
            withdrawalDays: Object.keys(days).length === 0 ? undefined : days,
            treatmentEndsAt: endsAt,
          }
        : {};

      await log({
        entity: 'medication',
        op: editing ? 'update' : 'create',
        targetId: treatmentId ?? newId(),
        payload: { ...payload, ...cleared },
      });
    });
  }, [save, log, groupId, name, medRoute, stillGoing, reason, dose, withdrawal, editing, treatmentId, existing]);

  const remove = useCallback(() => {
    if (treatmentId === undefined) return;
    void removed.save(async () => {
      // Archived, never deleted (P13) — and the withdrawal it was holding
      // lifts, because every reader filters archived records.
      await log({ entity: 'medication', op: 'delete', targetId: treatmentId, payload: {} });
    });
  }, [removed, log, treatmentId]);

  if (groups === null) return <Loading title="Treatment" />;
  if (group === null) return <Missing title="Treatment" what="That group" />;
  if (editing && existing === null) return <Missing title="Treatment" what="That treatment" />;

  const anyWithdrawal = WITHDRAWAL_KINDS.some((kind) => withdrawal[kind] > 0);

  return (
    <Screen title={editing ? 'This treatment' : 'Record a treatment'} back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      <Field label="What did you give them?">
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="Baytril, Ivermectin, a wormer"
          maxLength={120}
          testID="treatment-name"
        />
      </Field>

      <Field label="What for? (optional)">
        <TextField value={reason} onChangeText={setReason} placeholder="Respiratory, mites" maxLength={200} />
      </Field>

      <Field label="How did it go in?">
        <View style={styles.chips}>
          {MEDICATION_ROUTES.map((option) => (
            <Chip
              key={option}
              label={ROUTE_LABELS[option]}
              selected={medRoute === option}
              onPress={() => setMedRoute(option)}
            />
          ))}
        </View>
      </Field>

      <Field label="Dose (optional)">
        <TextField value={dose} onChangeText={setDose} placeholder="10 ml per gallon" maxLength={80} />
      </Field>

      <Toggle
        label="The course is still running"
        value={stillGoing}
        onChange={setStillGoing}
      />

      <Panel label="Withdrawal">
        <Body>
          Off the bottle, in days. Leave a produce at zero if this medicine does not stop you
          selling it — a wound spray does not stop egg sales, and pretending it does is how
          people learn to work around the app.
        </Body>
        <Body>
          The clock starts on the last day of treatment, not the first.
        </Body>

        {WITHDRAWAL_KINDS.map((kind) => (
          <Field key={kind} label={KIND_LABELS[kind]}>
            <Stepper
              value={withdrawal[kind]}
              onChange={(next) => setWithdrawal((current) => ({ ...current, [kind]: next }))}
              steps={[1, 7, 14]}
              suffix="days"
            />
          </Field>
        ))}
      </Panel>

      {anyWithdrawal ? (
        <Panel label="What this will do">
          <Body>
            {WITHDRAWAL_KINDS.filter((k) => withdrawal[k] > 0)
              .map((k) => `${KIND_LABELS[k].toLowerCase()} for ${withdrawal[k]} days`)
              .join(', ')}
            . You will see a band on this group and a row on Today, and logging through it will
            take one extra deliberate tap.
          </Body>
        </Panel>
      ) : null}

      <Failure message={failure} />

      <Primary
        label={editing ? 'Save the change' : 'Record it'}
        disabled={saving || name.trim() === ''}
        onPress={commit}
        testID="save-treatment"
      />

      {editing ? (
        <Panel label="Logged in error?">
          <Body>
            Taking it back removes the treatment and lifts any withdrawal it was holding. If the
            course happened and you have the details wrong, change them above instead — the record
            is what a vet or an inspector reads.
          </Body>
          <Confirm
            label="Take this treatment back"
            armedLabel="Tap again to remove it"
            onConfirm={remove}
            testID="remove-treatment"
          />
          <Failure message={removed.failure} />
        </Panel>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});

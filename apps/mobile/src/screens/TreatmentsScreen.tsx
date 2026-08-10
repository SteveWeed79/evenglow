import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WITHDRAWAL_KINDS, type WithdrawalKind } from '@steading/contracts';
import { listGroups } from '@steading/core/read/groups';
import { type Treatment, treatmentsFor } from '@steading/core/read/withdrawals';
import { Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * What this group has been given, and the way back into any of it.
 *
 * ## Why this screen had to exist
 *
 * A treatment could be recorded and then never seen again. There was no list,
 * no detail, no edit and no removal — the only trace was a withdrawal banner
 * on produce, naming a medication with no way to reach it.
 *
 * That is worse than an inconvenience, because of the one field nothing could
 * change. A withdrawal is counted from the **last** day of treatment, and
 * `withdrawalClearsAt` takes `Math.max(administeredAt, treatmentEndsAt ?? 0)`
 * — so **a course logged as still running is counted from the first dose**. A
 * five-day course with a seven-day egg withdrawal, left open, says the eggs
 * are clear on day eight when the true date is day twelve.
 *
 * It clears produce early, which is the one direction this app says
 * everywhere it must never err in, and it did so with no way to correct it.
 * Not a stuck interlock — a quietly short one, which is worse, because a farm
 * has no reason to look at it.
 *
 * So the row that matters most here is a course that is still running, and it
 * is the one that says so in its own words.
 *
 * ## Why a list rather than an edit on the banner
 *
 * The banner is a warning and belongs to the produce. This belongs to the
 * group, beside the other things a keeper knows about it, and it answers the
 * question a vet asks — *what has this lot had, and when* — which is a
 * question about the group and not about today's eggs.
 */

const KIND_LABELS: Record<WithdrawalKind, string> = {
  egg: 'eggs',
  meat: 'meat',
  milk: 'milk',
};

const RECENT = 20;

export function TreatmentsScreen({ route }: ScreenProps<'Treatments'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const read = useCallback((): Promise<Treatment[]> => treatmentsFor(groupId), [groupId]);
  const treatments = useLive(read, 'this group’s treatments');

  if (groups === null || treatments === null) return <Loading title="Treatments" />;
  if (group === null) return <Missing title="Treatments" what="That group" />;

  return (
    <Screen title="What they have had" back>
      <Text style={[styles.subject, { color: colors.muted }]}>{group.name}</Text>

      {treatments.length === 0 ? (
        <Panel label="Nothing recorded yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Every wormer, jab and spray you record lands here with the day it was given and how
            long it holds the produce for. It is the answer to &ldquo;what has this lot had&rdquo;
            when a vet asks.
          </Body>
        </Panel>
      ) : null}

      <View style={styles.rows}>
        {treatments.slice(0, RECENT).map((treatment) => (
          <Row
            key={treatment.id}
            title={treatment.name}
            detail={detailFor(treatment)}
            testID={`treatment-${treatment.id}`}
            onPress={() => nav.navigate('Treatment', { groupId, treatmentId: treatment.id })}
          />
        ))}
      </View>

      <Row
        title="Record a treatment"
        detail="Starts the withdrawal clock on eggs, meat or milk"
        testID="go-record-treatment"
        onPress={() => nav.navigate('Treatment', { groupId })}
      />
    </Screen>
  );
}

/**
 * One line, and the running course says so first.
 *
 * A course with no end date is the state a person has to act on, because its
 * withdrawal is counted from the first dose and is therefore short by however
 * long the course actually ran. So it leads, ahead of the date and ahead of
 * what is being held — and it says what closing it buys, rather than just
 * asking for tidiness.
 */
function detailFor(treatment: Treatment): string {
  const given = new Date(treatment.administeredAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });

  if (treatment.running) {
    return `Still running since ${given} — close it, or the withdrawal is counted short`;
  }

  const holding = WITHDRAWAL_KINDS.filter((kind) => treatment.holding.includes(kind));
  if (holding.length === 0) return `Given ${given}`;

  return `Given ${given} — still holding ${holding.map((kind) => KIND_LABELS[kind]).join(' and ')}`;
}

const styles = StyleSheet.create({
  rows: { gap: SPACE.sm },
  subject: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

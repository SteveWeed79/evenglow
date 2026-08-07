import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { QueuedMutation } from '@steading/core/db/records';
import { discardRejected, listRejected, retryRejected } from '@steading/core/sync/inbox';
import { nudge, subscribe } from '@steading/core/sync/engine';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The rejected inbox — invariant 9.
 *
 * **A rejected mutation is never dropped, and it stays user-visible.** The
 * server refused it for a reason a human has to resolve: a role that is not
 * allowed to write that, a payload the schema will never accept, a conflict
 * nobody can settle automatically. Retrying forever would be a queue that
 * never drains; discarding silently would be a morning's work vanishing.
 *
 * So it sits here, in the farm's own words where possible, with exactly two
 * ways out — send it again, or throw it away on purpose.
 */

/** What each entity is called to the person who typed it, not on the wire. */
const NOUNS: Record<string, string> = {
  eggLog: 'egg count',
  productionLog: 'production',
  feedLog: 'feeding',
  mortality: 'a loss',
  predator: 'a predator sighting',
  hourReading: 'an hour reading',
  weight: 'a weight',
  shearing: 'a shearing',
  harvest: 'a harvest',
  careLog: 'a job done',
  flock: 'a group',
  animal: 'an animal',
  medication: 'a treatment',
  equipment: 'a machine',
  maintenance: 'a service',
  planting: 'a planting',
  bed: 'a bed',
  variety: 'a variety',
  site: 'your ground',
  breeding: 'a mating',
  incubation: 'a set of eggs',
  feedPlan: 'a ration',
  task: 'a job',
  inventory: 'stock on the shelf',
  photo: 'a photo',
};

export function InboxScreen(): React.ReactElement {
  const { colors } = useTheme();
  const [rejected, setRejected] = useState<QueuedMutation[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRejected(await listRejected());
  }, []);

  useEffect(() => subscribe(() => void refresh()), [refresh]);

  const retry = useCallback(
    async (id: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await retryRejected(id);
      // Nudged rather than waited on: the retry is durable the moment the row
      // is back to queued, and the flush is the engine's business.
      nudge();
      await refresh();
    },
    [refresh],
  );

  const discard = useCallback(
    async (id: string) => {
      // Two taps. This is the only place in the app that destroys work a
      // person entered, so it does not happen on one.
      if (armed !== id) {
        setArmed(id);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      await discardRejected(id);
      setArmed(null);
      await refresh();
    },
    [armed, refresh],
  );

  if (rejected === null) return <Screen title="Needs a look" back>{null}</Screen>;

  return (
    <Screen title="Needs a look" back>
      {rejected.length === 0 ? (
        <Panel label="Nothing to look at">
          <View style={styles.spot}>
            <Icon name="saved" size={56} color={colors.leaf} />
          </View>
          <Body>
            Everything you have logged has either been sent or is waiting to be. Nothing has
            been refused.
          </Body>
        </Panel>
      ) : (
        <Panel label="Why this is here">
          <Body>
            The server would not take these, and no amount of waiting will change that. Send
            one again if you have fixed the cause, or throw it away on purpose — nothing here
            disappears on its own.
          </Body>
        </Panel>
      )}

      {rejected.map((mutation) => (
        <View
          key={mutation.id}
          style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.rowan }]}
        >
          <View style={styles.head}>
            <Icon name="needs-a-look" size={24} color={colors.rowan} />
            <View style={styles.words}>
              <Text style={[styles.title, { color: colors.ink }]}>
                {NOUNS[mutation.entity] ?? mutation.entity}
              </Text>
              <Text style={[styles.when, { color: colors.muted }]}>
                {new Date(mutation.clientTs).toLocaleString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </View>

          {/**
           * The server's own words. Not translated, because a message a farmer
           * can read back to whoever can help is worth more than a tidier one
           * that loses the detail.
           *
           * `rejectedReason` first, and that ordering is the fix to a real
           * defect: this read `lastError` alone, which is where a *transport*
           * failure is recorded — the thing that gets retried. A refusal
           * writes `rejectedReason`, so every row in this inbox showed its
           * heading, its date, two buttons, and no reason at all. The one
           * screen whose entire job is explaining why explained nothing.
           */}
          {mutation.rejectedReason ?? mutation.lastError ? (
            <Text style={[styles.reason, { color: colors.ink }]}>
              {mutation.rejectedReason ?? mutation.lastError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Action
              icon="try-again"
              label="Send it again"
              testID={`retry-${mutation.id}`}
              onPress={() => void retry(mutation.id)}
            />
            <Action
              icon="discard"
              label={armed === mutation.id ? 'Tap again to throw away' : 'Throw away'}
              danger={armed === mutation.id}
              testID={`discard-${mutation.id}`}
              onPress={() => void discard(mutation.id)}
            />
          </View>
        </View>
      ))}
    </Screen>
  );
}

function Action({
  icon,
  label,
  onPress,
  danger = false,
  testID,
}: {
  icon: 'try-again' | 'discard';
  label: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();

  return (
    <Touch affordance="border"
      onPress={onPress}
      accessibilityRole="button"
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: danger ? colors.rowan : colors.ground,
          borderColor: danger ? colors.rowan : colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Icon name={icon} size={20} color={danger ? '#fff' : colors.ink} />
      <Text style={[styles.actionLabel, { color: danger ? '#fff' : colors.ink }]}>{label}</Text>
    </Touch>
  );
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderLeftWidth: 4,
    gap: SPACE.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  words: { flex: 1, gap: 2 },
  title: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  when: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  reason: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  actions: { gap: SPACE.sm, marginTop: SPACE.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
});

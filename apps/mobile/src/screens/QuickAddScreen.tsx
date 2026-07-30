import { useState } from 'react';
import { SPECIES_TRAITS } from '@steading/contracts';
import { Row } from '../components/Form';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useGroups } from '../hooks/useGroups';
import { useNav } from '../hooks/useNav';
import type { IconName } from '../components/Icon';

/**
 * Log something without starting from the animal.
 *
 * ## The tap budget this exists to fix
 *
 * Eggs reach the Tally on Today in one tap. Everything else — a treatment, a
 * job done, a feed, a loss — cost three before the form even opened: Stock,
 * then the group, then the act. R1 gives the log path three taps in total, so
 * every non-egg record has been outside its own budget since the day it was
 * written.
 *
 * That is also the wrong order for how the work happens. You are standing next
 * to an animal with a bottle in your hand; the thing you know is what you are
 * about to do, not which screen it lives behind. Verb first, subject second —
 * which is what every commercial app in this category does.
 *
 * ## Why a picker rather than four optional-parameter screens
 *
 * The obvious build is to make `groupId` optional on `Treatment`, `CareLog`,
 * `Feed` and `Loss` and put a group field at the top of each. That is four
 * forms to change, four sets of guards to loosen, and four places for the
 * no-group-chosen case to be got subtly wrong.
 *
 * This asks the two questions and then hands off to the screens exactly as
 * they already are. Nothing about the forms changes, the group is a route
 * param everywhere as before, and there is one place where "which group" is
 * answered rather than five.
 *
 * ## One group means one question
 *
 * A smallholding with a single flock should not be asked which flock. When
 * there is exactly one group the picker is skipped and the act opens against
 * it — two taps from anywhere, which is inside the budget.
 */

/**
 * Only routes that take a group, named individually.
 *
 * `keyof RootParamList` would compile here and let a route with different
 * params through — `nav.replace(route, { groupId })` would then be wrong at
 * runtime on a screen that never asked for one. Four names is the whole list.
 */
type GroupRoute = 'Treatment' | 'CareLog' | 'Feed' | 'Loss';

interface Act {
  key: string;
  title: string;
  detail: string;
  icon: IconName;
  route: GroupRoute;
}

/**
 * The four daily acts, and deliberately only those.
 *
 * The same four that lead the group hub. Weighing, produce and the breeding
 * book are occasional and stay where they are — a quick-add that offers
 * everything is a menu, and a menu is what this replaces.
 */
const ACTS: readonly Act[] = [
  {
    key: 'treatment',
    title: 'Record a treatment',
    detail: 'Starts the withdrawal clock',
    icon: 'medication',
    route: 'Treatment',
  },
  {
    key: 'care',
    title: 'Log a job done',
    detail: 'Worming, feet, minerals, a look-over',
    icon: 'check',
    route: 'CareLog',
  },
  { key: 'feed', title: 'Log a feed', detail: 'What went in, and how much', icon: 'feed', route: 'Feed' },
  {
    key: 'loss',
    title: 'Record a loss',
    detail: 'A death, a cull, or a predator',
    icon: 'mortality',
    route: 'Loss',
  },
];

export function QuickAddScreen(): React.ReactElement {
  const nav = useNav();
  const { groups, loading } = useGroups();
  const [act, setAct] = useState<Act | null>(null);

  /**
   * Replaces this screen rather than stacking on it.
   *
   * Going back from the form should reach whatever you were looking at, not
   * the picker you passed through. A back button that returns you to a
   * question you have already answered is a dead end people learn to avoid.
   */
  const open = (chosen: Act, groupId: string): void => {
    nav.replace(chosen.route, { groupId });
  };

  const choose = (chosen: Act): void => {
    if (groups.length === 1) {
      open(chosen, groups[0]!.id);
      return;
    }
    setAct(chosen);
  };

  if (loading) return <Loading title="Log something" />;

  if (groups.length === 0) {
    return (
      <Screen title="Log something" back>
        <Panel label="Nothing to log against yet">
          <Body>
            Add what you keep under Stock first. Everything here is recorded against a group.
          </Body>
        </Panel>
      </Screen>
    );
  }

  if (act === null) {
    return (
      <Screen title="Log something" back>
        {ACTS.map((option) => (
          <Row
            key={option.key}
            title={option.title}
            detail={option.detail}
            icon={option.icon}
            testID={`quick-${option.key}`}
            onPress={() => choose(option)}
          />
        ))}
      </Screen>
    );
  }

  return (
    <Screen title={act.title} back>
      {/* The act is already chosen, so this asks one thing and says which. */}
      {groups.map((group) => (
        <Row
          key={group.id}
          title={group.name}
          detail={`${group.count} ${SPECIES_TRAITS[group.species].label.toLowerCase()}`}
          icon="stock"
          testID={`quick-group-${group.id}`}
          onPress={() => open(act, group.id)}
        />
      ))}
    </Screen>
  );
}

import { type Enterprise } from '@steading/contracts';
import { Row } from '../components/Form';
import { Grid } from '../components/Grid';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useEnterprises } from '../hooks/useEnterprises';
import { useNav } from '../hooks/useNav';

/**
 * The farm itself: what you keep, what you grow, what you run it with.
 *
 * ## Why a hub rather than three tabs
 *
 * Stock, Growing and Iron were three of the four tabs, and the bar was full
 * before the record had anywhere to live. The choice looked like "amend the
 * four-tab rule or lose What happened" — and it was a false one.
 *
 * These three are the same kind of thing. Each is a **place on the farm you go
 * to set something up or look something over**, and none of them is where the
 * morning happens. Today is the morning; What happened is the record; this is
 * the farm. Three answers to three different questions, which is what a tab
 * bar is for.
 *
 * It costs a press to reach a flock. That press buys back a bar that stays at
 * three however many enterprises a farm adds, and it stops the bottom of the
 * screen being the place every new idea has to fight for room.
 *
 * ## What you run lives here too
 *
 * It was under Settings, which was never quite right — deciding you keep bees
 * now is not a preference, it is a fact about the farm. Putting it at the
 * bottom of this list also means a farm that has switched everything off has
 * somewhere obvious to switch it back on, rather than an empty hub and no
 * route out of it.
 *
 * It stays reachable from Settings as well. Two doors to a room somebody
 * visits twice a year is not clutter, it is not having to remember.
 */

/**
 * Named individually rather than as `keyof RootParamList`.
 *
 * That would compile and let a route needing params through, and
 * `nav.navigate(route)` would then be wrong at runtime on a screen expecting
 * one. Three names is the whole list — the same reasoning as `GroupRoute` in
 * QuickAddScreen.
 */
type PlaceRoute = 'Stock' | 'Growing' | 'Iron';

interface Place {
  key: Enterprise;
  route: PlaceRoute;
  title: string;
  detail: string;
}

const PLACES: readonly Place[] = [
  {
    key: 'stock',
    route: 'Stock',
    title: 'Animals',
    detail: 'Groups, individuals, health, and what they produce',
  },
  {
    key: 'growing',
    route: 'Growing',
    title: 'Crops and beds',
    detail: 'Beds, plantings, sowing dates and harvests',
  },
  {
    key: 'iron',
    route: 'Iron',
    title: 'Machines and kit',
    detail: 'Servicing, hours, and the parts shelf',
  },
];

export function FarmScreen(): React.ReactElement {
  const nav = useNav();
  const enterprises = useEnterprises();

  /**
   * The enterprise filter moved down here from the tab bar, and does the same
   * job: a market gardener has no stock, and a suburban poultry keeper has no
   * tractor. What changed is only which thing disappears — a row rather than a
   * tab — so the bar no longer grows and shrinks under somebody.
   */
  const places = PLACES.filter((place) => enterprises.includes(place.key));

  return (
    /**
     * `wide`, because this is the one screen in the app that is purely a list
     * of equivalent doors.
     *
     * Eight rows in a 600dp column with 600dp of nothing beside them is the
     * complaint in `docs/LANDSCAPE-PLAN.md` at its most literal. A hub is not
     * prose — the 600dp measure protects a line of body text, and there is no
     * line of body text here — so this takes the feed layout instead and
     * `<Grid>` keeps every cell above the width a `Row`'s detail line needs.
     *
     * Below the threshold it is exactly the column it always was.
     */
    <Screen title="The farm" wide>
      {places.length === 0 ? (
        <Panel label="Nothing switched on yet">
          <Body>
            Say what you run below and the parts of the app you need appear here. Nothing you
            have already logged has gone anywhere.
          </Body>
        </Panel>
      ) : null}

      <Grid testID="farm-grid">
      {places.map((place) => (
        <Row
          key={place.key}
          title={place.title}
          detail={place.detail}
          testID={`farm-${place.key}`}
          onPress={() => nav.navigate(place.route)}
        />
      ))}

      {/**
        * The shelf, and it belongs here rather than only under Iron.
        *
        * It was reachable from one place: the Iron hub. So a farm that keeps
        * chickens and owns no tractor had `iron` switched off, no Iron row,
        * and **no way to reach its feed at all** — while the shelf's five
        * kinds are feed, bedding, medicine, part and other, three of which are
        * nothing to do with equipment. Feed is tied to stock; it was filed
        * under machinery because parts happened to be filed there first.
        *
        * It stays on Iron as well. A part genuinely is only thought about
        * beside the machine it belongs to, and two doors to one room is the
        * arrangement this hub already uses for "What you run".
        */}
      {/* Always here, whatever the farm runs: a gate needs fixing on a market
          garden too, and this is the only list in the app somebody writes
          themselves and ticks off. */}
      <Row
        title="Jobs"
        detail="Fix the gate, ring the vet — the ones nothing else knows about"
        testID="farm-jobs"
        onPress={() => nav.navigate('Jobs')}
      />

      <Row
        title="The shelf"
        detail="Feed, bedding, medicine and parts — what is in and what is low"
        testID="farm-shelf"
        onPress={() => nav.navigate('Inventory')}
      />

      {/**
        * A row in the hub, which is where R2 puts it.
        *
        * *"Home is today, not a dashboard. Charts live one level down."* One
        * level down is exactly here — reached on purpose, never in the way of a
        * morning. It is the closest this app comes to a dashboard and the hub
        * is the right distance from the door for that.
        */}
      <Row
        title="The numbers"
        detail="What came off this season, beside what came off by now last year"
        testID="farm-numbers"
        onPress={() => nav.navigate('Numbers')}
      />

      {/**
        * Below the two year-round rows, and only for a farm that keeps stock.
        *
        * **It led them both, and it is the most seasonal row on the hub.** A
        * set is under for three weeks, once or twice in a spring, on a farm
        * that hatches at all — while the shelf is read whenever a sack runs
        * low and Jobs is written in continuously. Same fault as "Log a feed"
        * being fifth on the group hub, found in the same pass.
        *
        * **And it was drawn for everybody**, including a market gardener with
        * animals switched off — a row they can never use, above the two they
        * use every week, on every visit. The three hub rows above are gated on
        * `useEnterprises`; this one was not, because it is written here rather
        * than in `PLACES`.
        */}
      {enterprises.includes('stock') ? (
        <Row
          title="Eggs under"
          detail="Sets in the incubator or under a broody — candling and hatch dates"
          testID="go-incubations"
          onPress={() => nav.navigate('Incubations')}
        />
      ) : null}

      <Row
        title="What you run"
        detail="Animals, crops, machines — turn a part of the farm on or off"
        icon="settings"
        testID="farm-my-farm"
        onPress={() => nav.navigate('MyFarm')}
      />
      </Grid>
    </Screen>
  );
}

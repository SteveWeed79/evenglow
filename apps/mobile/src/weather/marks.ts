import type { Condition } from '@homefarm/contracts';
import type { IconName } from '../components/Icon';

/**
 * Which drawing stands for which sky.
 *
 * Its own module rather than a table beside the row that first used it, and
 * that is not tidiness. `WeatherRow` reaches the navigator, the navigator
 * declares every route, and one of those routes is `WeatherScreen` — so a
 * screen importing this table from the row closed a cycle, and TypeScript
 * answers a circular inference with `any`. The forecast then typechecked
 * perfectly while `SKY_MARKS[anything]` compiled, which is the sort of silence
 * that lets a wrong icon name ship.
 *
 * A leaf module both can import is the fix. It imports nothing that imports it.
 */
export const SKY_MARKS: Record<Condition, IconName> = {
  clear: 'sky-clear',
  cloud: 'sky-cloud',
  fog: 'sky-fog',
  drizzle: 'sky-drizzle',
  rain: 'sky-rain',
  snow: 'sky-snow',
  storm: 'sky-storm',
};

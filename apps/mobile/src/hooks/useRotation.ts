import { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';
import { rotationFor, type Rotation } from '../theme/rotation';

/**
 * Whether this device may turn, watched for the one case where it changes.
 *
 * The decision itself is in `theme/rotation.ts` — pure, and tested there. This
 * is only the part that has to ask React Native.
 *
 * `screen` rather than `window`: window is what the app currently occupies, so
 * it shrinks under a split-screen or a keyboard and would report a tablet as a
 * phone the moment somebody dragged the divider. `screen` is the display.
 *
 * The subscription looks redundant — a screen's dimensions do not change on
 * rotation, only swap, and the shorter edge is the same either way. It is there
 * for foldables, where unfolding genuinely turns a 370dp device into an 800dp
 * one while the app is running.
 */
export function useRotation(): Rotation {
  const [rotation, setRotation] = useState<Rotation>(current);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => setRotation(current()));
    return () => sub.remove();
  }, []);

  return rotation;
}

function current(): Rotation {
  const { width, height } = Dimensions.get('screen');
  return rotationFor(width, height);
}

import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '../../apps/mobile/src/theme/ThemeProvider';
import type { RootParamList, ScreenProps } from '../../apps/mobile/src/navigation/Root';
import { navigator, resetNav } from './native/navigation';

/**
 * Mounting one screen against the real store.
 *
 * Everything below the seam is genuine: the SQLite store from `freshStore()`,
 * the queue, the contracts, the due engine, the theme tokens. Only the drawing
 * layer is stubbed — see `native/react-native.tsx` for exactly what that costs.
 *
 * The two things this catches that nothing else in the suite can:
 *
 *  - **A screen that throws on mount.** Typecheck and the bundler both pass a
 *    component whose hooks run in an illegal order, whose `useLive` reader
 *    rejects, or which reads a field off a record that is null on first paint.
 *  - **A control that sends the wrong mutation.** The payload a button builds
 *    is only checked when something presses it, and `enqueue` validates
 *    against the same contract the server does — so a screen that would be
 *    refused at flush is refused here instead.
 */

export interface Mounted {
  tree: ReactTestRenderer;
  /** Every rendered string, flattened. What a person would read. */
  text(): string;
  /** The one element with this testID. Throws if absent — a missing control is a failure. */
  get(testID: string): ReactTestInstance;
  /** Whether a control is on screen at all. */
  has(testID: string): boolean;
  /** Presses it and lets every resulting write and re-read settle. */
  press(testID: string): Promise<void>;
  /**
   * Presses the control a person would find by reading it.
   *
   * Chips carry a label and not a testID, because the label is what makes them
   * scannable at arm's length (UX-SPEC §5) and a testID on each of fifty
   * species would be noise. Pressing by the words is also the closer analogue
   * of what a farmer does.
   */
  pressLabel(label: string): Promise<void>;
  /** The labels of every control on screen, for asserting what is offered. */
  labels(): string[];
  /** Types into it. */
  type(testID: string, value: string): Promise<void>;
  /**
   * What a field is currently showing.
   *
   * A TextInput's value is a prop, not rendered text, so `text()` cannot see
   * it and an assertion written against `text()` passes whatever the field
   * does. That is exactly how a date box that snapped its old digit back
   * survived a full screen suite.
   */
  shows(testID: string): string;
  /** Lets pending effects, reads and engine publishes settle. */
  settle(): Promise<void>;
  unmount(): void;
}

/**
 * Flushes the microtask queue several times over.
 *
 * One tick is not enough: a screen's effect subscribes, the engine publishes,
 * the subscriber awaits a store read, the read resolves and sets state, and
 * that state change can start another read. Four passes covers the deepest
 * chain any screen here has; more is harmless.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Everything a person can press.
 *
 * Both roles, because a toggle is a checkbox and a chip is a button — and a
 * harness that only knew about buttons reported "nothing on screen says that"
 * for every switch in the app, which is a lie about the screen rather than a
 * finding about it.
 */
function pressablesIn(root: ReactTestInstance): ReactTestInstance[] {
  return [
    ...root.findAllByProps({ accessibilityRole: 'button' }),
    ...root.findAllByProps({ accessibilityRole: 'checkbox' }),
  ];
}

/** Every string rendered anywhere under this node, joined. */
function textOf(node: ReactTestInstance): string {
  const parts: string[] = [];
  const walk = (children: unknown): void => {
    if (typeof children === 'string') parts.push(children);
    else if (typeof children === 'number') parts.push(String(children));
    else if (Array.isArray(children)) for (const child of children) walk(child);
    else if (children !== null && typeof children === 'object') {
      const instance = children as { children?: unknown; props?: { children?: unknown } };
      walk(instance.props?.children ?? instance.children);
    }
  };
  walk(node.props.children);
  return parts.join(' ').trim();
}

export interface MountOptions {
  /**
   * Whether to let the live reads finish before handing the screen back.
   *
   * Defaults to true, which is what almost every test wants. `false` returns
   * the screen mid-read — the only way to assert what it says **before** the
   * store has answered.
   *
   * That state has now shipped two defects: My Farm waited forever on a read
   * that had already answered, and the photo strip told somebody they had no
   * photos while it was still looking. Both are the same shape — `useLive`
   * returns `null` for "not read yet", and a component that flattens it into
   * "nothing there" promises something it does not know. Neither was testable
   * until this existed.
   */
  settle?: boolean;
}

export async function mount(
  element: ReactElement,
  options: MountOptions = {},
): Promise<Mounted> {
  resetNav();

  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(ThemeProvider, null, element));
  });
  if (options.settle !== false) await flush();

  const collect = (node: unknown, out: string[]): void => {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'number') out.push(String(node));
    else if (Array.isArray(node)) for (const child of node) collect(child, out);
  };

  const pressables = (): ReactTestInstance[] => pressablesIn(tree.root);

  const mounted: Mounted = {
    tree,
    text() {
      const out: string[] = [];
      collect(tree.toJSON(), out);
      // Walk the tree for text nodes too — toJSON only gives the host tree,
      // which is what we want, but children arrive nested.
      const walk = (node: unknown): void => {
        if (node === null || typeof node !== 'object') return;
        const json = node as { children?: unknown[] };
        if (Array.isArray(json.children)) {
          for (const child of json.children) {
            if (typeof child === 'string') out.push(child);
            else walk(child);
          }
        }
      };
      walk(tree.toJSON());
      return out.join(' ');
    },
    get(testID) {
      // Deepest match. A `<Primary testID="x">` and the host element it
      // renders both carry the prop, and only the host has the resolved
      // accessibility state — asserting against the wrapper reads its inputs
      // rather than what was drawn.
      const matches = tree.root.findAllByProps({ testID });
      const target = matches[matches.length - 1];
      if (target === undefined) throw new Error(`Nothing on screen has testID "${testID}".`);
      return target;
    },
    has(testID) {
      return tree.root.findAllByProps({ testID }).length > 0;
    },
    async press(testID) {
      const target = mounted.get(testID);
      const onPress = target.props.onPress as (() => void) | undefined;
      if (typeof onPress !== 'function') {
        throw new Error(`${testID} has no onPress — it is not something a person can act on.`);
      }
      await act(async () => {
        onPress();
      });
      await flush();
    },
    labels() {
      return pressables().map((node) => textOf(node)).filter((label) => label !== '');
    },
    async pressLabel(label) {
      const buttons = pressables();
      /**
       * Exact first, then the shortest control that merely contains the words.
       *
       * A variety row reads "Sungold Tomato · 57 days" — the name is what a
       * person looks for and the rest is what the row tells them about it.
       * Shortest-wins keeps that from matching a card that happens to contain
       * the same row.
       */
      const exact = buttons.filter((node) => textOf(node) === label);
      const loose = buttons
        .filter((node) => textOf(node).includes(label))
        .sort((a, b) => textOf(a).length - textOf(b).length);
      const matches = exact.length > 0 ? exact : loose;
      const target = matches[matches.length - 1] === undefined ? undefined : matches[exact.length > 0 ? matches.length - 1 : 0];
      if (target === undefined) {
        throw new Error(
          `Nothing on screen says "${label}". Offered: ${buttons.map((n) => textOf(n)).filter(Boolean).join(' | ')}`,
        );
      }
      const onPress = target.props.onPress as (() => void) | undefined;
      if (typeof onPress !== 'function') throw new Error(`"${label}" does nothing when pressed.`);
      await act(async () => {
        onPress();
      });
      await flush();
    },
    shows(testID) {
      const target = mounted.get(testID);
      const value = target.props.value as unknown;
      return typeof value === 'string' ? value : String(value ?? '');
    },
    async type(testID, value) {
      const target = mounted.get(testID);
      const onChangeText = target.props.onChangeText as ((next: string) => void) | undefined;
      if (typeof onChangeText !== 'function') {
        throw new Error(`${testID} is not a field anything can be typed into.`);
      }
      await act(async () => {
        onChangeText(value);
      });
      await flush();
    },
    async settle() {
      await flush();
    },
    unmount() {
      act(() => {
        tree.unmount();
      });
    },
  };

  return mounted;
}

/**
 * The props a routed screen receives.
 *
 * `params` stays fully typed against the real `RootParamList`, so a test that
 * passes `{ groupId }` to a screen expecting `{ machineId }` is a compile
 * error — which is most of the value. The navigator itself is the recorder
 * from `native/navigation.tsx`.
 *
 * One cast, in one place. React Navigation's prop type is a large structural
 * interface describing a running navigator, and nothing in this app reads more
 * than `route.params` off it — a fake that satisfied the whole shape would be
 * fiction with eighty more fields.
 */
export function routeProps<K extends keyof RootParamList>(
  params: RootParamList[K],
): ScreenProps<K> {
  return {
    route: { key: 'test', name: 'Test', params },
    navigation: navigator(),
  } as unknown as ScreenProps<K>;
}

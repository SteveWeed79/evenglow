import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Rebuilt off `eslint-config-next`, which went with the Next app.
 *
 * That config was doing two jobs: supplying the TypeScript rules, and
 * supplying Next-specific ones this repo no longer has a Next app for. Only
 * the first was ever load-bearing here, and it came at the cost of a config
 * that could not load without `next` installed.
 *
 * **Every guard below is carried over unchanged in force.** They are the ones
 * `tests/unit/guards.test.ts` asserts actually fire — which is what makes them
 * guarantees rather than intentions, and what makes a rewrite like this safe
 * to do at all.
 */
/**
 * Raw collection access, wherever it is written.
 *
 * Hoisted because `no-restricted-syntax` REPLACES its options when a later
 * config block sets it again — it does not merge. A second block that named
 * only its own selectors silently disarmed these for every file it covered,
 * which `tests/unit/guards.test.ts` caught within a minute of it happening.
 * Anything setting this rule composes from here.
 */
const NO_RAW_COLLECTIONS = [
  {
    selector: "CallExpression[callee.property.name='collection']",
    message: 'Raw collection access is forbidden. Use scoped(orgId).col().',
  },
  {
    selector: "CallExpression[callee.property.name='collections']",
    message: 'Raw collection access is forbidden. Use scoped(orgId).col().',
  },
];

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,

  /**
   * `no-undef` off for TypeScript, on typescript-eslint's own advice.
   *
   * The compiler already answers "does this name exist", and it answers it
   * correctly against the real lib and type declarations. The lint rule
   * answers it from a hardcoded globals list, so on TS it reports thousands of
   * false positives for things like `URL` and `console` while catching
   * nothing the compiler would miss.
   */
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    rules: { 'no-undef': 'off' },
  },

  globalIgnores([
    'coverage/**',
    '.next/**',
    // Expo's bundle output, and the native project it generates. Linting a
    // bundle produces a thousand warnings about machine-written code and
    // buries the ones that matter.
    'apps/*/.expo/**',
    'apps/*/.expo-export/**',
    'apps/*/android/**',
    'apps/*/ios/**',
    'apps/*/dist/**',
  ]),

  /**
   * D2 — tenancy scoping is a mechanism, not a policy.
   *
   * `apps/api/src/db/` is the only place allowed to hold a collection handle
   * or import MongoClient. Everything else goes through scoped(orgId).
   * Do not add an eslint-disable to get past these (CLAUDE.md invariant 1);
   * CI greps for disable comments naming these rules.
   */
  {
    files: [
      // First-party source lives in more than one place and will live in more
      // still. A guard listing only one directory stops covering anything that
      // moves out of it — precisely how the first attempt at the D8
      // restructure disarmed every check in this repo.
      'packages/*/src/**/*.ts',
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
      'apps/*/src/**/*.mts',
    ],
    ignores: ['apps/api/src/db/**'],
    rules: {
      /**
       * `MongoClient` by name, not the whole module.
       *
       * The rule is about who may hold a CONNECTION, not who may know Mongo
       * exists — `apply.ts` needs `MongoServerError` to tell a duplicate key
       * from a real failure, and banning that would push it toward matching on
       * an error string instead. Connections and collection handles stay in
       * db/; everything else goes through scoped(orgId).
       *
       * Shared and client code get the whole-module ban further down, because
       * for them any Mongo import at all pulls the driver toward a bundle that
       * ships inside an APK.
       */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              importNames: ['MongoClient'],
              message:
                'Only apps/api/src/db/ may open a Mongo connection. Everything else uses scoped(orgId).',
            },
          ],
        },
      ],
      /**
       * A selector, not `no-restricted-properties`, and the difference is the
       * whole guard.
       *
       * `no-restricted-properties` matches an object by NAME, so it catches
       * `db.collection(...)` and misses `client.db().collection(...)` — a call
       * on a call result, which is exactly how the driver is actually used.
       * The selector matches the call however it was reached.
       */
      'no-restricted-syntax': ['error', ...NO_RAW_COLLECTIONS],
    },
  },

  {
    files: [
      'tests/**/*.ts',
      'packages/*/src/**/*.ts',
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
      'scripts/**/*.mjs',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  /**
   * Contracts and core are shared, so they must stay free of server-only
   * imports — a Mongo type leaking into either pulls the driver toward the
   * client bundle, and that bundle ships inside an APK.
   */
  {
    files: ['packages/contracts/src/**/*.ts', 'packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              message: 'Shared code must not import the Mongo driver.',
            },
          ],
          patterns: [
            {
              group: ['@homefarm/api', '@homefarm/api/*'],
              message: 'Shared code must not import server modules.',
            },
          ],
        },
      ],
    },
  },

  /**
   * Invariant 6 — SQLite is the only client store, and tokens live in secure
   * storage.
   *
   * The exemption this used to carry — `apps/app/src/db/**`, where the
   * IndexedDB engine lived knowingly during the migration — is gone with the
   * web client. There is no longer any directory in this repo where browser
   * storage is allowed, which is what S7 was for.
   */
  {
    files: [
      'packages/core/src/**/*.ts',
      'apps/mobile/src/**/*.ts',
      'apps/mobile/src/**/*.tsx',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Use SQLite, or secure storage for tokens.' },
        { name: 'sessionStorage', message: 'Use SQLite, or secure storage for tokens.' },
        { name: 'indexedDB', message: 'SQLite is the only client store (D9, invariant 6).' },

        /**
         * ── Globals Node has and Hermes does not ──────────────────────────
         *
         * **This is the guard that cost two days.** `crypto.randomUUID()` sat
         * in `enqueue`, passed a thousand tests, and meant nothing could be
         * saved on a handset — because the test runtime is Node and the app
         * runtime is Hermes, and Node is more generous.
         *
         * The planned fix was a vitest project that reshaped `globalThis` to
         * what the device provides. This is better and it is why: a lint rule
         * fires on the *reference*, so it does not depend on a test happening
         * to exercise that line. `crypto.randomUUID` was on a path four suites
         * touched and none of them ran it against a missing global.
         *
         * It also runs on every `pnpm lint` rather than in a project somebody
         * has to remember to add a file to.
         *
         * Each of these is reachable through a module that does work on both:
         * `expo-crypto` for randomness, `decodeBase64Url` in `auth/session.ts`
         * for base64, `TextEncoder` via a small helper if one is ever needed.
         * The rule names the replacement rather than only the ban, because a
         * guard that says no without saying what instead gets disabled.
         */
        {
          name: 'crypto',
          message:
            'Hermes has no `crypto` global — this is the bug that stopped every save on device. Use expo-crypto, or newId() from @homefarm/contracts.',
        },
        {
          name: 'Buffer',
          message: 'Node only. Hermes has no Buffer; use a Uint8Array, or a helper that works on both.',
        },
        {
          name: 'TextEncoder',
          message: 'Not in Hermes. Encode by hand or through a helper — see decodeBase64Url in auth/session.ts.',
        },
        {
          name: 'TextDecoder',
          message: 'Not in Hermes. Decode by hand or through a helper — see decodeBase64Url in auth/session.ts.',
        },
        {
          name: 'structuredClone',
          message: 'Not in Hermes. Clone explicitly, or round-trip through JSON if the value is plain.',
        },
        {
          name: 'atob',
          message:
            'A global React Native happens to provide, which is a poor thing to put under the path that gates every screen. Use decodeBase64Url in auth/session.ts.',
        },
        { name: 'btoa', message: 'See atob — encode explicitly rather than relying on the global.' },
      ],

      /**
       * `window` and `navigator` EXIST on a handset, and that is the trap.
       *
       * React Native defines `window` as an alias for the global object, so
       * `typeof window !== 'undefined'` passes — and then
       * `window.addEventListener` is undefined and the next line throws the
       * `TypeError: undefined is not a function` that stopped the app booting.
       * `navigator` is the same: present, and without `onLine`.
       *
       * So these cannot be banned as globals. The rule has to name the
       * property, which is what a restricted-syntax selector does and
       * `no-restricted-globals` cannot.
       */
      'no-restricted-syntax': [
        'error',
        // Carried, because setting this rule again would otherwise replace
        // the tenancy selectors for every file this block covers.
        ...NO_RAW_COLLECTIONS,
        {
          selector:
            "MemberExpression[object.name='window'][property.name=/^(addEventListener|removeEventListener)$/]",
          message:
            'React Native defines `window` but gives it no addEventListener — guard on the METHOD, not the object. See sync/engine.ts.',
        },
        {
          selector: "MemberExpression[object.name='navigator'][property.name='onLine']",
          message:
            'React Native defines `navigator` without onLine. Connectivity comes from expo-network through setOnline() — see sync/triggers.ts.',
        },
      ],
    },
  },

  /**
   * The local store is reached through the port, never around it.
   *
   * The rule that caught the migration's worst bug: every read module imported
   * the IndexedDB implementation directly, so a group added on device was
   * written to SQLite and looked for in a database that had never been
   * touched. Adding stock did nothing at all, silently, and it survived every
   * test because in a browser both paths resolved to the same store.
   *
   * `db/store.ts` is the one file allowed to name an implementation, because
   * choosing one is its whole job.
   */
  {
    files: ['packages/core/src/**/*.ts', 'apps/mobile/src/**/*.ts', 'apps/mobile/src/**/*.tsx'],
    ignores: [
      'packages/core/src/db/**',
      'apps/mobile/src/db/**',
      // The one file allowed to name secure storage, for the same reason
      // db/open.ts is the one allowed to name SQLite.
      'apps/mobile/src/auth/store.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              message: 'Client code must not import the Mongo driver.',
            },
            {
              name: 'expo-sqlite',
              message: 'Only apps/mobile/src/db/open.ts may name the SQLite native module.',
            },
            {
              name: 'expo-secure-store',
              message: 'Only apps/mobile/src/auth/store.ts may name secure storage.',
            },
          ],
          patterns: [
            {
              group: ['**/db/sqlite-store', '**/db/expo-driver'],
              message:
                'Use localStore() from db/store — importing an implementation directly ' +
                'pins a caller to one backing and reads the wrong database on device.',
            },
          ],
        },
      ],
    },
  },

  /**
   * Every tappable thing in the app says what pressing it promises.
   *
   * The arch used to answer "you can act on this" by shape, which meant a
   * reviewer could say a screen looked wrong and nobody could say it *was*
   * wrong. Five signals replace it (see `components/Touch.tsx`), and this is
   * the layer that makes them exhaustive: a raw `Pressable` is the only way to
   * make something tappable without declaring anything, so it is available in
   * exactly one file.
   *
   * The alternative was to have the audit sniff the rendered tree for a
   * chevron, which breaks the day the icon set changes — and the icon set is
   * changing.
   */
  {
    files: ['apps/mobile/src/**/*.tsx'],
    ignores: ['apps/mobile/src/components/Touch.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Pressable', 'TouchableOpacity', 'TouchableHighlight'],
              message:
                'Use <Touch affordance="…"> from components/Touch. Every pressable element ' +
                'declares what pressing it promises, and tests/screens/affordance.test.tsx ' +
                'reads those declarations off the tree.',
            },
          ],
        },
      ],
    },
  },

  /**
   * Metro and Babel read their config with `require`, before any transform has
   * run. These two files are CommonJS because the tools that load them are,
   * not because anyone chose it — so the ban on `require()` does not apply.
   */
  {
    files: ['apps/mobile/metro.config.js', 'apps/mobile/babel.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  /** Scripts are Node, and say so. */
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        // Global in Node since 18, and the repo's floor is well above that.
        // Listed rather than pulled from `globals` because this whole block is
        // written out by hand and one honest list beats two sources.
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    // Vite's output. Linting a bundle produces a thousand warnings about
    // machine-written code and buries the ones that matter.
    'apps/*/dist/**',
    // The native project. `cap sync` copies that same bundle into
    // android/app/src/main/assets/public, so without this the bundle comes
    // back through a second door — and the Gradle wrapper and plugin sources
    // underneath it are nobody's code to lint either.
    'apps/*/android/**',
  ]),

  /**
   * D2 — tenancy scoping is a mechanism, not a policy.
   *
   * src/server/db/ is the only place allowed to hold a collection handle or
   * import MongoClient. Everything else goes through scoped(orgId).
   * Do not add an eslint-disable to get past these (CLAUDE.md invariant 1);
   * CI greps for disable comments naming these rules.
   */
  {
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'src/**/*.mts',
      // First-party source lives in more than one place now, and will live in
      // more still. A guard listing only src/ stops covering anything that
      // moves out of it — precisely how the first attempt at the D8
      // restructure disarmed every check in this repo.
      'packages/*/src/**/*.ts',
      // Pre-armed for the migration. These directories do not exist yet; the
      // globs are here so the guard is in force the moment the first file
      // lands in them, rather than being remembered afterwards. That they
      // actually fire is asserted in tests/unit/guards.test.ts, which is what
      // makes this a guarantee rather than an intention.
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
      'apps/*/src/**/*.mts',
    ],
    ignores: ['src/server/db/**', 'apps/api/src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              importNames: ['MongoClient'],
              message: 'Use server/db/client.ts — it is the only permitted MongoClient importer.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='collection']",
          message: 'Raw collection access is forbidden. Use scoped(orgId).col().',
        },
        {
          selector: "CallExpression[callee.property.name='collections']",
          message: 'Raw collection access is forbidden. Use scoped(orgId).col().',
        },
      ],
    },
  },

  /**
   * Destructuring to omit a field is the idiomatic way to drop it from an
   * object, and `_`-prefixed bindings are an explicit "unused on purpose".
   */
  {
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'tests/**/*.ts',
      'packages/*/src/**/*.ts',
      // apps/ too — the convention is repo-wide, and a rule scoped to the
      // directories code used to live in is the recurring failure here.
      'apps/*/src/**/*.ts',
      'apps/*/src/**/*.tsx',
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
   * Contracts are shared client/server, so they must stay free of server-only
   * imports — a Mongo type leaking into the contracts package pulls the driver
   * toward the client bundle, and that bundle ships inside an APK.
   */
  {
    files: [
      'packages/contracts/src/**/*.ts',
      'src/client/**/*.ts',
      'src/client/**/*.tsx',
      // Pre-armed for the migration, as above.
      'apps/app/src/**/*.ts',
      'apps/app/src/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              message: 'Shared and client code must not import the Mongo driver.',
            },
          ],
          patterns: [
            {
              group: ['@/server/*', '@/server'],
              message: 'Client and shared code must not import server modules.',
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
   * `apps/app/src/db/**` is exempt, and that exemption is doing real work
   * right now rather than being a formality: the IndexedDB engine lives there
   * during the migration, knowingly, until S7 deletes it (masterplan §0.1).
   * Everything ABOVE the storage layer — sync, reads, screens — is already
   * held to the ban, so a port cannot reintroduce browser storage by reaching
   * for a familiar API on the way past.
   *
   * PHASE-1-SPEC T6 puts this rule on apps/app/src/**; that is what this is.
   */
  {
    files: ['apps/app/src/**/*.ts', 'apps/app/src/**/*.tsx'],
    ignores: ['apps/app/src/db/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Use SQLite, or secure storage for tokens.' },
        { name: 'sessionStorage', message: 'Use SQLite, or secure storage for tokens.' },
        { name: 'indexedDB', message: 'SQLite is the only client store (D9, invariant 6).' },
      ],
    },
  },
]);

export default eslintConfig;

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
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'packages/*/src/**/*.ts'],
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
   * Scoped to apps/app deliberately. That directory does not exist yet, so
   * this bans nothing today: the working engine under src/client IS built on
   * IndexedDB, knowingly, until S4 replaces it (masterplan §0.1). Arming the
   * rule where the new client will live means the ban is already in force
   * when the first file arrives, and cannot be reintroduced by a port that
   * reaches for a familiar API.
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

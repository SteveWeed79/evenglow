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
    files: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.mts'],
    ignores: ['src/server/db/**'],
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
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
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
   * imports — a Mongo type leaking into lib/contracts pulls the driver toward
   * the client bundle.
   */
  {
    files: ['src/lib/**/*.ts', 'src/client/**/*.ts', 'src/client/**/*.tsx'],
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
]);

export default eslintConfig;

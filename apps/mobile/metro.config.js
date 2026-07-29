// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Metro only watches the project folder by default, so an edit inside
// packages/contracts would not trigger a reload. The contracts package is
// imported directly from source, which is the whole reason it is shared.
config.watchFolders = [workspaceRoot];

// pnpm's isolated layout puts real packages under node_modules/.pnpm and
// leaves symlinks behind. Metro follows symlinks natively, so hierarchical
// lookup is deliberately left ON here — disabling it (which the Expo monorepo
// guide suggests for npm and yarn) breaks transitive resolution under pnpm.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;

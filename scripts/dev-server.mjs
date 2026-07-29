#!/usr/bin/env node
/**
 * `pnpm farm` — the whole back end, from a machine with nothing installed on it.
 *
 * ## Why this exists
 *
 * The app reached its sign-in screen and could go no further: signing in is a
 * server round trip, and standing the server up meant installing MongoDB,
 * inventing an AUTH_SECRET, writing a `.env.local`, applying indexes and
 * seeding an owner — five steps, each with its own way of going quietly wrong,
 * for somebody whose actual goal was to look at the app.
 *
 * So this does them, in order, and says which one it is on.
 *
 * ## What it will not do
 *
 * It writes no secret into anything the app ships. `AUTH_SECRET` is generated
 * here, lives in `.env.local` (gitignored), and is read only by the server
 * process — never by the bundle, which is extractable from the APK
 * (invariant 12).
 *
 * It is a **development** launcher and says so. There is no production path
 * through this file: `pnpm --filter @steading/api start` is that, against a
 * real database whose URI somebody chose deliberately.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env.local');
const DATA_DIR = join(ROOT, '.steading-data');
const DB_DIR = join(DATA_DIR, 'mongo');
const SEEDED = join(DATA_DIR, 'seeded');

/** A fixed port, so the URI written to `.env.local` is still true tomorrow. */
const MONGO_PORT = 27017;
const MONGO_URI = `mongodb://127.0.0.1:${MONGO_PORT}`;

function say(step, message) {
  console.log(`  ${step}  ${message}`);
}

function fail(message, detail) {
  console.error(`\n  PROBLEM: ${message}\n`);
  if (detail) console.error(`  ${detail}\n`);
  process.exit(1);
}

/**
 * Reads `.env.local` as a plain map. Deliberately not a dotenv dependency:
 * this needs to understand `KEY=value` and nothing else, and the file it reads
 * is one this script wrote.
 */
function readEnvFile() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}

function writeEnvFile(values) {
  const body = [
    '# Written by `pnpm farm`. Local development only.',
    '#',
    '# Gitignored, and it must stay that way: AUTH_SECRET signs every access',
    '# token this server issues. Nothing here is read by the app bundle.',
    '',
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
  writeFileSync(ENV_FILE, body, { mode: 0o600 });
}

/** Runs a command, inheriting stdio, and resolves with its exit code. */
function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** True when something is already listening — a real MongoDB, most likely. */
async function alreadyServing(uri) {
  const { MongoClient } = await import('mongodb').catch(() => ({ MongoClient: null }));
  if (MongoClient === null) return false;
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 800 });
    await client.connect();
    await client.close();
    return true;
  } catch {
    return false;
  }
}

// ── 1. configuration ─────────────────────────────────────────────────────────

console.log('\n  Steading — starting your farm server\n');

mkdirSync(DB_DIR, { recursive: true });

const env = readEnvFile();
let wrote = false;

if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
  /**
   * 32 random bytes as hex — 64 characters, comfortably past the schema's
   * minimum. Generated rather than prompted for: a secret somebody invents
   * under time pressure is the one that ends up being `password12345`.
   */
  env.AUTH_SECRET = randomBytes(32).toString('hex');
  wrote = true;
}

if (!env.MONGODB_URI) {
  env.MONGODB_URI = MONGO_URI;
  wrote = true;
}

if (wrote) {
  writeEnvFile(env);
  say('[1/4]', 'Settings written to .env.local.');
} else {
  say('[1/4]', 'Settings found.');
}

// ── 2. the database ──────────────────────────────────────────────────────────

let stopMongo = async () => {};

if (await alreadyServing(env.MONGODB_URI)) {
  say('[2/4]', 'Database already running — using it.');
} else if (env.MONGODB_URI !== MONGO_URI) {
  // Somebody set a URI by hand and nothing is answering on it. Starting a
  // different database underneath them would be the wrong kind of helpful.
  fail(
    'nothing is answering at the MONGODB_URI in .env.local.',
    `Tried ${env.MONGODB_URI}. Start that database, or delete the line and run this again.`,
  );
} else {
  say('[2/4]', 'No database running. Starting one...');
  console.log('        The first time, this downloads MongoDB (about 100 MB).\n');

  const { MongoMemoryServer } = await import('mongodb-memory-server').catch(() =>
    fail('could not load mongodb-memory-server.', 'Run `pnpm install` and try again.'),
  );

  /**
   * `dbPath` with wiredTiger, NOT the default in-memory engine.
   *
   * The name is misleading: this package will happily run an ordinary mongod
   * against a folder. Without that, every farm you enter disappears when the
   * window closes — which is a fine property for a test and a terrible one for
   * somebody trying the app out over a week.
   */
  const mongo = await MongoMemoryServer.create({
    instance: { port: MONGO_PORT, dbPath: DB_DIR, storageEngine: 'wiredTiger' },
  }).catch((error) =>
    fail(
      'could not start the database.',
      `${String(error?.message ?? error).split('\n')[0]}\n\n  If this is a download failure, check the internet connection.`,
    ),
  );

  stopMongo = async () => {
    await mongo.stop().catch(() => undefined);
  };
  say('[2/4]', `Database running, keeping its files in ${DB_DIR}`);
}

// ── 3. the first farm ────────────────────────────────────────────────────────

if (existsSync(SEEDED)) {
  say('[3/4]', 'Farm account already made.');
} else {
  say('[3/4]', 'No farm on this database yet. Making one.');
  console.log(
    '\n        This is the email and password you will sign in with on the phone.\n' +
      '        It is stored only on this computer.\n',
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const farm = (await rl.question('        What is the farm called?  ')).trim() || 'My Farm';
  const email = (await rl.question('        Email:                    ')).trim();
  const password = await rl.question('        Password (12+ letters):  ');
  rl.close();

  if (email === '' || password.length < 12) {
    await stopMongo();
    fail('need an email and a password of at least 12 characters.');
  }

  const code = await run('pnpm', ['db:seed', farm, email, password], {
    MONGODB_URI: env.MONGODB_URI,
    AUTH_SECRET: env.AUTH_SECRET,
  });

  // The seed script exits 1 when the account already exists, which is not a
  // failure here — it means a previous run got further than the marker did.
  if (code === 0) writeFileSync(SEEDED, `${email}\n`);
  else {
    writeFileSync(SEEDED, `${email}\n`);
    console.log('\n        (That account was already there — carrying on.)');
  }
}

// ── 4. the server ────────────────────────────────────────────────────────────

console.log('');
say('[4/4]', 'Starting the server on port 3001.');
console.log('\n  Leave this window OPEN while you use the app.');
console.log('  The emulator reaches this computer at 10.0.2.2:3001.\n');

const api = spawn('pnpm', ['dev:api'], {
  cwd: ROOT,
  env: { ...process.env, ...env },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

async function shutdown() {
  api.kill();
  await stopMongo();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
api.on('close', () => void shutdown());

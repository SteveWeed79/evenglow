import { z } from 'zod';
import { type PlayConfig, readPlayConfig } from './billing/play';
import type { SupportConfig } from './support/github';

/**
 * Server configuration, parsed once at the boundary.
 *
 * Nothing here is read straight from `process.env` elsewhere: a missing secret
 * must fail at startup with a sentence naming it, not at the first request
 * with a stack trace — or, far worse, silently, by signing tokens with
 * `undefined`.
 */

const envSchema = z.object({
  /**
   * At least 32 bytes. HS256 keys shorter than the digest are weaker than the
   * algorithm implies, and a short secret is the most common way JWT signing
   * is quietly downgraded.
   */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters.'),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('steading'),
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Comma-separated. The Capacitor client is not a browser origin in the usual
   * sense, so this stays explicit rather than defaulting to `*` — a wildcard
   * with credentials is the mistake this field exists to prevent.
   */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /**
   * Comma-separated Google OAuth client ids (A2.4) — the Android one, and the
   * web one Expo's auth proxy uses in development.
   *
   * **Public by design**, so this is configuration rather than a secret;
   * invariant 12 is about what ships in an APK, and a client id ships in every
   * OAuth app there has ever been. What matters is that the list is *complete
   * and exact*: it is the audience check that stops a Google token minted for
   * somebody else's application being accepted as one of ours.
   *
   * Empty is a supported state. A server with no ids answers Google sign-in
   * with a 501 naming this variable, and email and password keep working —
   * which is what a farm running its own box gets until it makes a project.
   */
  GOOGLE_CLIENT_IDS: z.string().default(''),
  /**
   * The Play service-account JSON, verbatim (D13).
   *
   * **The one real secret in this file besides `AUTH_SECRET`.** Unlike an
   * OAuth client id, this holds a private key — server-side only, never in a
   * bundle, never in a log line. Absent is a supported state: the billing
   * routes answer 501 and every farm stays on the free tier, which is exactly
   * what the app does today.
   */
  GOOGLE_PLAY_SERVICE_ACCOUNT: z.string().default(''),
  /** The package the purchase must belong to. `com.steading.app`. */
  GOOGLE_PLAY_PACKAGE: z.string().default(''),

  /**
   * Where support tickets are filed (`docs/SUPPORT-LOOP.md`).
   *
   * A GitHub token with issue write on the repository below. Absent, `/support`
   * answers 501 and the app offers its share sheet instead — which is a
   * supported state rather than a broken one, and the only state a farm
   * running its own box will ever be in.
   */
  /**
   * Farms that sync free, whatever the payment rail says (D13).
   *
   * Comma-separated org ULIDs. For testers, for the people who build this, and
   * for anyone who should not be charged — a grant, and the honest word for it
   * is a comp.
   *
   * **Configuration rather than a route, deliberately.** A grant that can be
   * requested is a grant that can be requested by anybody, and a new
   * authenticated endpoint whose whole job is to disable a paywall is the
   * worst possible thing to get wrong (invariant 10). Nothing a client sends
   * can influence this; it is read from the server's own environment at
   * startup and a farm cannot ask to be in it.
   *
   * It grants sync and nothing else. There is nothing else to grant — the free
   * tier is already the whole app on one device, so this is the only line
   * money has ever been on.
   */
  FREE_SYNC_ORGS: z.string().default(''),
  SUPPORT_GITHUB_TOKEN: z.string().default(''),
  /** `owner/repo`. */
  SUPPORT_REPO: z.string().default(''),
  /**
   * Whether a farm's own records may be accepted alongside a report (S5).
   *
   * **Off until the repository is private.** An issue on a public repository
   * is world-readable, and a farm cannot meaningfully consent to that on a
   * prompt in a barn. The gate is here rather than in the app because the app
   * cannot know a repository's visibility, and a build shipped today would be
   * wrong about it forever.
   */
  SUPPORT_ACCEPT_RECORDS: z
    .string()
    .default('')
    .transform((value) => value === '1' || value.toLowerCase() === 'true'),
});

export type Env = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  googleClientIds: string[];
  /** Null when this server takes no payments, which is a supported state. */
  playConfig: PlayConfig | null;
  /** Null when this server has nowhere to file a support ticket. */
  supportConfig: SupportConfig | null;
  /** Farms that sync free regardless of subscription. Usually empty. */
  freeSyncOrgs: ReadonlySet<string>;
};

/**
 * Takes a plain record rather than `NodeJS.ProcessEnv`, which additionally
 * requires `NODE_ENV`. Nothing here reads it, and demanding it would force
 * every caller — tests included — to supply a value that changes no outcome.
 */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Server configuration is invalid:\n${detail}`);
  }

  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    googleClientIds: parsed.data.GOOGLE_CLIENT_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    playConfig: readPlayConfig(
      parsed.data.GOOGLE_PLAY_SERVICE_ACCOUNT || undefined,
      parsed.data.GOOGLE_PLAY_PACKAGE || undefined,
    ),
    freeSyncOrgs: readFreeSyncOrgs(parsed.data.FREE_SYNC_ORGS),
    supportConfig: readSupportConfig(
      parsed.data.SUPPORT_GITHUB_TOKEN,
      parsed.data.SUPPORT_REPO,
      parsed.data.SUPPORT_ACCEPT_RECORDS,
    ),
  };
}

/**
 * Parses the comp list, and refuses anything that is not an org id.
 *
 * A typo here would be a farm that quietly kept getting 402s while somebody
 * was certain they had been granted access — so a malformed entry fails at
 * startup with the value in the message, rather than being skipped.
 */
function readFreeSyncOrgs(raw: string): ReadonlySet<string> {
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);

  for (const id of ids) {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
      throw new Error(`FREE_SYNC_ORGS must be a comma-separated list of farm ids. Got: ${id}`);
    }
  }

  return new Set(ids);
}

/**
 * Splits `owner/repo` and refuses anything else.
 *
 * Null when either half is missing, which is the state a self-hosted server
 * stays in: `/support` answers 501 and the app offers its share sheet, which
 * needs no server at all.
 */
function readSupportConfig(
  token: string,
  repo: string,
  acceptRecords: boolean,
): SupportConfig | null {
  if (token === '' || repo === '') return null;

  const [owner, name] = repo.split('/');
  if (owner === undefined || name === undefined || owner === '' || name === '') {
    throw new Error('SUPPORT_REPO must be owner/repo.');
  }

  return { token, owner, repo: name, acceptRecords };
}

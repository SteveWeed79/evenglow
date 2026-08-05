import { z } from 'zod';
import { type PlayConfig, readPlayConfig } from './billing/play';

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
});

export type Env = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  googleClientIds: string[];
  /** Null when this server takes no payments, which is a supported state. */
  playConfig: PlayConfig | null;
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
  };
}

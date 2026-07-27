import { z } from 'zod';

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
});

export type Env = z.infer<typeof envSchema> & { corsOrigins: string[] };

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
  };
}

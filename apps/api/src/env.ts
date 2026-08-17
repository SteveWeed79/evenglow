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
  /**
   * Empty is treated as absent, matching `db/client.ts`.
   *
   * `.default()` fires only when the key is missing, and an env file line
   * reading `MONGODB_DB=` supplies an empty string instead — which would
   * satisfy `z.string()` and pass through. See `databaseName()` for what the
   * driver then does with it, which is not what anybody wants.
   */
  MONGODB_DB: z
    .string()
    .default('steading')
    .transform((value) => (value.trim() === '' ? 'steading' : value.trim())),
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Where the operations board listens, and it is a **different port on
   * purpose**.
   *
   * The board is the one thing on this box that reads every farm. Serving it
   * beside the app's own traffic would mean it shares a hostname and a CORS
   * policy with the surface every handset talks to, and that taking it off the
   * internet is a code change rather than a line of Caddy. On its own port it
   * is its own site block, and the safe deployment — bound to loopback, or
   * behind a `remote_ip` matcher, or on a tailnet — is a decision made in the
   * proxy where such decisions belong.
   *
   * Nothing listens on it unless `ops.ts` is started, so a box that never runs
   * the board has no board.
   */
  OPS_PORT: z.coerce.number().int().positive().default(3002),
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
  /**
   * The oldest client build this server will take a batch from, or empty.
   *
   * `[24]`. Empty is the default and means no floor at all — nothing is
   * refused, which is the state every server is in until somebody deliberately
   * decides otherwise. Setting it is a decision taken once the fleet reports
   * versions and once there is a build worth insisting on: the wire has
   * widened its entity list before and now has a `null` that means *clear this
   * field*, and a build old enough to misread either one disagrees with the
   * farm's other devices silently.
   *
   * A refused batch is **held, never dropped** — the mutations are valid and
   * the client is old, so they stay queued and go up when the app is updated.
   * See `isClientTooOld` and the `appTooOld` refusal.
   */
  MINIMUM_CLIENT_VERSION: z.string().default(''),
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

  /**
   * Whether a server that takes no payments syncs for anybody who asks.
   *
   * **Off, so it does not — and the default is the whole point.** `syncAccess`
   * used to read "no Play configuration" as *there is no such thing as paid
   * here* and let everyone through, which is right for a box on somebody's
   * desk and wrong for one whose install page is on the open internet.
   * Reported from exactly that box: *"our site for download is online all the
   * time — if someone finds it they get a free account?"* They did, and the
   * hostname is in Certificate Transparency logs from the moment a certificate
   * is issued, so *if* somebody finds it is a matter of when.
   *
   * This was a `SYNC_REQUIRES_GRANT` flag that defaulted OFF, which made the
   * gate possible rather than actual — a hole stays open when closing it is a
   * step somebody has to remember. It is inverted, so the safe state is the one
   * you get by doing nothing, and opening the door is the deliberate act.
   *
   * **The app stays free either way**, and that is why the gate is here and not
   * in front of the download. Anyone may install it and keep a farm's whole
   * records on their own handset for nothing (D14); what needs granting is a
   * copy on somebody else's disk, which is the part that costs. D13 already
   * says sync is the only thing sold — this makes that true before Play exists
   * rather than after.
   *
   * A farm gets through by being named in `FREE_SYNC_ORGS`, by `pnpm
   * farm:grant`, or by redeeming a promotion code itself (A2.6). `pnpm db:seed`
   * grants the farm it creates, so a fresh self-hosted box syncs its own farm
   * out of the box and nobody else's.
   *
   * Set this only to deliberately run an open server.
   */
  SYNC_OPEN_TO_ALL: z
    .string()
    .default('')
    .transform((value) => value === '1' || value.toLowerCase() === 'true'),

  /**
   * How many proxies sit in front of this service, or empty for none.
   *
   * **Off by default, and this used to be `trustProxy: true` unconditionally.**
   * That tells Fastify to believe `X-Forwarded-For` from whoever connected, so
   * `request.ip` becomes a value the caller chose — and every rate limiter in
   * the service keys on `request.ip`. One header per attempt and the auth
   * limiter, the thing standing between a password and an unlimited number of
   * guesses, counts each one against a different address and never fires. That
   * is invariant 10: authorization must not fail open.
   *
   * The comment beside it was right about the failure it prevented — behind a
   * proxy with no trust, every request rate-limits against the proxy's own
   * address and legitimate traffic is throttled as one client. Both states are
   * bad, they are opposites, and which one is correct is a fact about the
   * deployment that the code cannot guess. So it is configuration, and the
   * default is the one that fails closed.
   *
   * Set it to the number of proxies you control — `1` behind a single nginx or
   * a load balancer — and Fastify takes the address that many hops from the
   * right, which a caller cannot forge past. Direct-to-internet: leave it
   * unset.
   */
  TRUSTED_PROXY_HOPS: z
    .string()
    .default('')
    .refine((value) => value === '' || /^\d+$/.test(value), {
      message: 'TRUSTED_PROXY_HOPS must be a whole number of proxies, or unset.',
    })
    .transform((value) => (value === '' ? 0 : Number(value))),
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
  /** Null when this server takes a batch from any build, which is the default. */
  minimumClientVersion: string | null;
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
    // Null rather than empty string, so "no floor" is a value the type carries
    // rather than a convention every caller has to remember.
    minimumClientVersion: parsed.data.MINIMUM_CLIENT_VERSION || null,
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

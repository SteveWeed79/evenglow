# syntax=docker/dockerfile:1
#
# The API, as an image.
#
# `DESIGN-BRIEF.md` gap 7 was "no deployment target: no container image, no
# process supervisor, no TLS, no reverse-proxy config". This is the first of
# those; a host (Fly, Render, or the box in ACCESS-AND-BILLING §4.1a) supplies
# the other three, which is most of the argument for using one.
#
# ## Why the source ships and TypeScript runs in production
#
# There is no compile step, and that is a decision rather than an omission.
# The codebase imports extensionless — `from './env'`, not `'./env.ts'` —
# under `moduleResolution: bundler`. Node's own type stripping cannot load
# that (verified: `Cannot find module '/…/apps/api/src/env'`), and neither can
# `tsc` output, because the emitted JavaScript keeps the extensionless
# specifier that Node's ESM resolver rejects. Either of *those two* routes
# means rewriting every import in the service.
#
# **This paragraph used to end "either route means rewriting every import",
# full stop, and that sentence is true of the two options examined and false in
# general.** A bundler built for Node — esbuild, tsup — resolves extensionless
# specifiers as a matter of course, strips the types, and emits plain
# JavaScript with no import rewritten by hand. It was never evaluated, and a
# comment that forecloses an option it did not test is worse than silence,
# because it stops the next person looking. Untested, here too: nobody has run
# it against this tree.
#
# The decision stands anyway, on its own argument rather than on a false
# dichotomy. `tsx` runs the source, exactly as `pnpm dev:api` and `pnpm farm`
# always have. It moved from devDependencies to dependencies for this and
# nothing else. It is not a new dependency, and the thing it buys is that the
# deployed process and the local one are **the same code path** — worth more
# here than a build step, in a repo whose expensive failures have all been
# environment drift. A bundler would put a transform between the two and hand
# back some startup time and image size; that is the trade to weigh if anyone
# reopens this, and it is a preference call rather than a forced one.

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /repo

# Corepack takes the pnpm version from package.json's `packageManager`, so the
# image cannot drift from the lockfile's resolver.
RUN corepack enable

# Manifests before source, so the install layer is cached against dependency
# changes rather than invalidated by every edit.
#
# `.npmrc` is not optional here even though its reasoning is about Windows
# path lengths: it sets `node-linker=hoisted`, and `pnpm deploy` below refuses
# to run against a workspace that is neither hoisted nor injected.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.json ./

# **All four manifests, including the two this service does not use.**
#
# The install below is filtered and touches two of them. `pnpm deploy` is not:
# it re-resolves the whole workspace, and the ROOT package.json declares
# `@homefarm/mobile` and `@homefarm/core` as workspace dependencies. Leave
# either manifest out of the context and the deploy step fails with
#
#   ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  "@homefarm/mobile@workspace:*" is in the
#   dependencies but no package named "@homefarm/mobile" is present
#
# after the install has already succeeded, which is a confusing place to land.
# They are manifests only — no Expo source enters the image.
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/

# `@homefarm/api...` — the trailing dots mean "and everything it depends on",
# which is `@homefarm/contracts` and nothing else. Without the filter this
# installs Expo and React Native to build a server that imports neither.
RUN pnpm install --frozen-lockfile --filter "@homefarm/api..."

COPY apps/api apps/api
COPY packages/contracts packages/contracts

# One self-contained tree: the service, its production dependencies, and the
# workspace packages copied in rather than symlinked out of a store that will
# not exist in the next stage.
#
# `--legacy` because pnpm 10 otherwise requires `inject-workspace-packages`,
# which this workspace does not set. `--prod` drops devDependencies — which is
# why `tsx` had to stop being one.
RUN pnpm deploy --legacy --filter @homefarm/api --prod /app

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS run
WORKDIR /app

ENV NODE_ENV=production
# `env.ts` defaults to 3001 and every profile below matches; this only has to
# agree with the host's forwarding.
ENV PORT=3001

# ── Every interface, and only inside a container ────────────────────────────
#
# `server.ts` binds `127.0.0.1` unless told otherwise, which is right on the box
# this repository deploys to: Caddy reverse-proxies to loopback on the same
# machine, and a public bind there is a second door past the proxy.
#
# **In a container it is the opposite.** Loopback is the container's own network
# namespace, so a published port reaches nothing and the process answers only
# itself. The exposure argument does not carry across either: what makes an
# image reachable is `docker run -p`, which is already the deliberate act.
#
# The comment this replaces said *"Fastify binds 0.0.0.0 already"*, which was
# true when it was written and stopped being true one commit before this line
# existed. CI caught it — the container check published :3001, the API logged
# `listening on 127.0.0.1:3001`, and `/health` was never answered.
ENV API_HOST=0.0.0.0

# Owned by the user that runs it, so the process needs no write access to its
# own code to start.
COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 3001

# Called directly rather than through `pnpm serve`, so there is no package
# manager between the supervisor and the process it is meant to restart.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]

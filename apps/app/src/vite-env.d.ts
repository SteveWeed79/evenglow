/**
 * Vite's build-time env, narrowed to what this app reads.
 *
 * Declared here rather than pulled in with `vite/client` because these types
 * must not leak into the Next build, which compiles the same `src/` with
 * webpack and has no `import.meta.env` at all. Only `main.tsx` reads it.
 */
interface ImportMetaEnv {
  /**
   * Absolute origin of the Fastify API, for the native build only.
   *
   * Not a secret — it ships in the APK by design, and there is nothing to
   * extract from a hostname. Required on device: the WebView serves the app
   * from its own origin, so a relative `/sync` resolves to the bundle.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

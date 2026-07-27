import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The contracts package ships TypeScript source rather than a build step —
   * it is consumed only inside this workspace, and compiling between the
   * schemas and the code importing them would buy nothing and cost a stale
   * artifact. Next has to be told to transpile it.
   *
   * This survives the migration: Vite will resolve the same source through the
   * workspace link, with no build output to keep in sync.
   */
  transpilePackages: ["@steading/contracts"],
};

export default nextConfig;

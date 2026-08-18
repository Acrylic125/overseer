import type { NextConfig } from "next";

// Validate env at build time (relative import — path aliases aren't available here)
import "./env.ts";

const nextConfig: NextConfig = {
  // Do not set turbopack.root here — explicit values break Next 16.2.12 module
  // resolution for this app. Turbopack may warn about ~/pnpm-lock.yaml; remove
  // that stray home-directory lockfile if the warning bothers you.
};

export default nextConfig;

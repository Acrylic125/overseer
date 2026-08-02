import type { NextConfig } from "next";

// Validate env at build time (relative import — path aliases aren't available here)
import "./env.ts";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

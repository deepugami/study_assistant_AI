import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure standalone output for Docker runtime image
  output: "standalone",
  eslint: {
    // Do not fail production builds on ESLint rule violations
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

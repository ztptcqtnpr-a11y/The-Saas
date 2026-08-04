import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // Disable Module Federation (microfrontends)
    // This is a standard monolithic Next.js app, not a microfrontends setup
    esmExternals: true,
  },
};

export default nextConfig;

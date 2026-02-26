import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16
  turbopack: {},
  webpack: (config) => {
    // react-pdf uses canvas — alias it to false for SSR
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;

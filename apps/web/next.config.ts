import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  instrumentationHook: true,
  serverExternalPackages: ["dockerode", "bullmq", "ioredis", "socket.io"],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;

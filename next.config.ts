import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Career Vault accepts source files up to 10 MB. The extra megabyte covers
  // multipart framing while the application-level parser enforces the exact
  // file limit before any persistent write.
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

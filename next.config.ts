import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // One id per deploy (`npm run deploy` sets it). A tab left open across a
  // deploy then reloads on its next navigation instead of requesting code
  // files the new deploy no longer serves.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  outputFileTracingIncludes: { "/*": ["./policies/application-writing/**/*", "./assets/fonts/**/*"] },
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

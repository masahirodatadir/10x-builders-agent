import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const extraAllowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean) ?? [];

const allowedDevOrigins = [
  "*.ngrok-free.app",
  "*.ngrok-free.dev",
  ...extraAllowedDevOrigins,
];

const nextConfig: NextConfig = {
  transpilePackages: ["@agents/agent", "@agents/db", "@agents/types"],
  serverExternalPackages: ["@langchain/core", "@langchain/langgraph", "@langchain/openai"],
  allowedDevOrigins,
};

export default withSentryConfig(nextConfig, {
  org: "ricardo-masahiro-solis",
  project: "lab10-agent",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Route browser requests to Sentry through Next.js to reduce ad-blocker issues.
  tunnelRoute: "/monitoring",

  automaticVercelMonitors: true,

  bundleSizeOptimizations: {
    excludeDebugStatements: true,
  },
});

import type { NextConfig } from "next";
import path from "node:path";

// The build this tab runs, compared with the deployed one by components/AutoReload.tsx.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Lead and board reads are never cached anywhere: a tab must see the lead as it is now.
  async headers() {
    const h = [{ key: "Cache-Control", value: "no-store, max-age=0" }];
    return ["/api/leads", "/api/leads/:path*", "/api/autopilot/:path*", "/api/version", "/api/health"].map((source) => ({ source, headers: h }));
  },
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: { "/api/insights": ["../docs/data-insights.md"] },
};

export default config;

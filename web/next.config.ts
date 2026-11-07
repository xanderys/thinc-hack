import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: { "/api/insights": ["../docs/data-insights.md"] },
};

export default config;

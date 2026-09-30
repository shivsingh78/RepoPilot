import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Web may import only browser-safe subpaths (env, errors, schemas); never the DB/queue barrel.
  transpilePackages: ["@repopilot/shared"],
  // The API key stays server-side; browser code only talks to /api/* route handlers.
  output: "standalone",
};

export default nextConfig;
